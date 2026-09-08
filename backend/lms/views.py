from django.db import transaction
from django.http import HttpResponse
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed, NotFound, PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import AccessToken

from lms import serializers as ser
from lms.enums import ApplicationStatus, LoanStatus, RepaymentChannel, StaffRole
from lms.exceptions import Conflict, UnprocessableEntity
from lms.models import (
    ApprovalLevel,
    Application,
    ApprovalDecision,
    Borrower,
    BorrowerDocument,
    BorrowerHistoryEvent,
    Branch,
    CollectionActivity,
    Guarantor,
    Holiday,
    Lender,
    Loan,
    LoanProduct,
    ProductFee,
    Repayment,
    SavingsAccount,
    SavingsTransaction,
    Staff,
    TillReconciliation,
)
from lms.permissions import (
    IsAdmin,
    IsProductManager,
    IsSupervisor,
    can_approve_application,
    has_section,
    section_editor,
)
from lms.models import Notification
from lms.services import applications as application_service
from lms.services import (
    audit,
    collections as collections_service,
    loans as loan_service,
    notify,
    restructure as restructure_service,
    savings as savings_service,
    till as till_service,
)
from lms.tenancy import ensure_branch, ensure_staff_member

WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")


def token_for(staff: Staff) -> str:
    return str(AccessToken.for_user(staff))


def validated(serializer_cls, data):
    serializer = serializer_cls(data=data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


class AdminWriteView(APIView):
    """Reads open to any authenticated user, writes limited to lender admins."""

    def get_permissions(self):
        if self.request.method in WRITE_METHODS:
            return [IsAuthenticated(), IsAdmin()]
        return [IsAuthenticated()]


# ------------------------------------------------------------------------- auth

class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        data = validated(ser.RegisterSerializer, request.data)
        email = data["admin_email"].lower()
        if Staff.objects.filter(email=email).exists():
            raise Conflict("That email is already registered")

        lender = Lender.objects.create(
            name=data["lender_name"],
            currency=data["currency"],
            language=data["language"],
            logo_initials="".join(w[0] for w in data["lender_name"].split()[:2]).upper(),
        )
        admin = Staff.objects.create_user(
            email=email,
            password=data["admin_password"],
            lender=lender,
            name=data["admin_name"],
            role=StaffRole.LENDER_ADMIN,
        )
        return Response({"access_token": token_for(admin)}, status=status.HTTP_201_CREATED)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        data = validated(ser.LoginSerializer, request.data)
        staff = Staff.objects.filter(email=data["email"].lower()).first()
        if staff is None or not staff.check_password(data["password"]):
            raise AuthenticationFailed("Incorrect email or password")
        if not staff.is_active:
            raise PermissionDenied("This account has been suspended")
        return Response({"access_token": token_for(staff)})


class MeView(APIView):
    def get(self, request):
        return Response(ser.CurrentStaffSerializer(request.user).data)


# ----------------------------------------------------------------------- lender

class LenderView(AdminWriteView):
    def get(self, request):
        return Response(ser.LenderSerializer(request.user.lender).data)

    def patch(self, request):
        lender = request.user.lender
        for field, value in validated(ser.LenderUpdateSerializer, request.data).items():
            setattr(lender, field, value)
        lender.save()
        audit.record(request.user, "updated", "lender", lender.id, "Lender profile updated")
        return Response(ser.LenderSerializer(lender).data)


# --------------------------------------------------------------------- branches

class BranchesView(AdminWriteView):
    def get(self, request):
        rows = Branch.objects.filter(lender=request.user.lender)
        return Response(ser.BranchSerializer(rows, many=True).data)

    def post(self, request):
        data = validated(ser.BranchCreateSerializer, request.data)
        branch = Branch.objects.create(lender=request.user.lender, **data)
        audit.record(request.user, "created", "branch", branch.id, f'Branch "{branch.name}" added')
        return Response(ser.BranchSerializer(branch).data, status=status.HTTP_201_CREATED)


# ------------------------------------------------------------------------ staff

class StaffListView(AdminWriteView):
    def get(self, request):
        rows = Staff.objects.filter(lender=request.user.lender)
        return Response(ser.StaffSerializer(rows, many=True).data)

    def post(self, request):
        data = validated(ser.StaffCreateSerializer, request.data)
        email = data["email"].lower()
        if Staff.objects.filter(email=email).exists():
            raise Conflict("That email is already registered")
        ensure_branch(request.user.lender, data.get("branch_id"))
        member = Staff.objects.create_user(
            email=email,
            password=data["password"],
            lender=request.user.lender,
            name=data["name"],
            role=data["role"],
            branch_id=data.get("branch_id"),
            approval_limit=int(data.get("approval_limit") or 0),
            phone=data.get("phone", ""),
        )
        audit.record(
            request.user, "created", "staff", member.id,
            f'Staff member "{member.name}" added with role {member.role}',
        )
        return Response(ser.StaffSerializer(member).data, status=status.HTTP_201_CREATED)


class StaffDetailView(AdminWriteView):
    def patch(self, request, staff_id):
        member = Staff.objects.filter(pk=staff_id, lender=request.user.lender).first()
        if member is None:
            raise NotFound("Staff member not found")
        data = validated(ser.StaffUpdateSerializer, request.data)
        if data.get("branch_id") is not None:
            ensure_branch(request.user.lender, data["branch_id"])

        field_map = {"name": "name", "role": "role", "phone": "phone", "branch_id": "branch_id", "active": "is_active"}
        for src, dest in field_map.items():
            if src in data:
                setattr(member, dest, data[src])
        if "approval_limit" in data:
            member.approval_limit = int(data["approval_limit"])
        member.save()
        audit.record(request.user, "updated", "staff", member.id, "Staff account updated")
        return Response(ser.StaffSerializer(member).data)


# --------------------------------------------------------------------- holidays

class HolidaysView(AdminWriteView):
    def get(self, request):
        rows = Holiday.objects.filter(lender=request.user.lender)
        return Response(ser.HolidaySerializer(rows, many=True).data)

    def post(self, request):
        data = validated(ser.HolidayCreateSerializer, request.data)
        holiday = Holiday.objects.create(lender=request.user.lender, **data)
        audit.record(request.user, "created", "holiday", holiday.id, f'Holiday "{holiday.name}" added')
        return Response(ser.HolidaySerializer(holiday).data, status=status.HTTP_201_CREATED)


class HolidayDetailView(AdminWriteView):
    def delete(self, request, holiday_id):
        holiday = Holiday.objects.filter(pk=holiday_id, lender=request.user.lender).first()
        if holiday is None:
            raise NotFound("Holiday not found")
        holiday.delete()
        audit.record(request.user, "deleted", "holiday", holiday_id, "Holiday removed")
        return Response(status=status.HTTP_204_NO_CONTENT)


# -------------------------------------------------------------------- borrowers

_BORROWER_PREFETCH = ("guarantors", "documents", "history")


def borrower_qs(lender):
    return Borrower.objects.filter(lender=lender).prefetch_related(*_BORROWER_PREFETCH)


class BorrowersView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def get(self, request):
        return Response(ser.BorrowerSerializer(borrower_qs(request.user.lender), many=True).data)

    def post(self, request):
        data = validated(ser.BorrowerCreateSerializer, request.data)
        lender = request.user.lender
        officer_id = data.pop("officer_id", None) or request.user.id
        guarantors = data.pop("guarantors", [])
        ensure_branch(lender, data["branch_id"])
        ensure_staff_member(lender, officer_id)

        with transaction.atomic():
            borrower = Borrower.objects.create(lender=lender, officer_id=officer_id, blacklisted=False, **data)
            Guarantor.objects.bulk_create(Guarantor(borrower=borrower, **g) for g in guarantors)
            BorrowerHistoryEvent.objects.create(
                borrower=borrower, label="File opened",
                detail=f"Borrower registered by {request.user.name}",
            )
            audit.record(
                request.user, "created", "borrower", borrower.id,
                f'Borrower "{borrower.full_name}" registered',
            )
        return Response(
            ser.BorrowerSerializer(borrower_qs(lender).get(pk=borrower.pk)).data,
            status=status.HTTP_201_CREATED,
        )


class BorrowerDetailView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def get(self, request, borrower_id):
        borrower = borrower_qs(request.user.lender).filter(pk=borrower_id).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        return Response(ser.BorrowerSerializer(borrower).data)

    def patch(self, request, borrower_id):
        lender = request.user.lender
        borrower = Borrower.objects.filter(pk=borrower_id, lender=lender).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        data = validated(ser.BorrowerUpdateSerializer, request.data)
        if "branch_id" in data:
            ensure_branch(lender, data["branch_id"])
        if "officer_id" in data and data["officer_id"] is not None:
            ensure_staff_member(lender, data["officer_id"])

        field_map = {
            "type": "type", "branch_id": "branch_id", "officer_id": "officer_id",
            "full_name": "full_name", "business_name": "business_name",
            "registration_number": "registration_number", "tax_id": "tax_id",
            "sector": "sector", "years_trading": "years_trading",
            "national_id": "national_id", "phone": "phone", "residence": "residence",
            "occupation": "occupation", "monthly_income": "monthly_income",
            "next_of_kin": "next_of_kin",
        }
        changes = []
        for src, dest in field_map.items():
            if src in data:
                old_val = getattr(borrower, dest)
                new_val = data[src]
                if str(old_val) != str(new_val):
                    changes.append(f"{src}: {old_val} → {new_val}")
                setattr(borrower, dest, new_val)
        borrower.save()

        if changes:
            with transaction.atomic():
                BorrowerHistoryEvent.objects.create(
                    borrower=borrower, label="Profile updated",
                    detail="; ".join(changes),
                )
                audit.record(
                    request.user, "updated", "borrower", borrower.id,
                    f'Borrower "{borrower.full_name}" profile updated',
                )
        return Response(ser.BorrowerSerializer(borrower_qs(lender).get(pk=borrower.pk)).data)


class BorrowerBlacklistView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def post(self, request, borrower_id):
        borrower = borrower_qs(request.user.lender).filter(pk=borrower_id).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        data = validated(ser.BlacklistSerializer, request.data)
        with transaction.atomic():
            borrower.blacklisted = data["blacklisted"]
            borrower.blacklist_reason = data.get("reason") if data["blacklisted"] else None
            borrower.save(update_fields=["blacklisted", "blacklist_reason"])
            BorrowerHistoryEvent.objects.create(
                borrower=borrower,
                label="Blacklisted" if data["blacklisted"] else "Removed from blacklist",
                detail=data.get("reason") or "Reason not recorded",
            )
            audit.record(
                request.user,
                "blacklisted" if data["blacklisted"] else "unblacklisted",
                "borrower", borrower.id, data.get("reason") or "",
            )
        return Response(ser.BorrowerSerializer(borrower_qs(request.user.lender).get(pk=borrower_id)).data)


class BorrowerDocumentUploadView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def post(self, request, borrower_id):
        lender = request.user.lender
        borrower = Borrower.objects.filter(pk=borrower_id, lender=lender).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        data = validated(ser.BorrowerDocumentUploadSerializer, request.data)
        doc = BorrowerDocument.objects.create(
            borrower=borrower, name=data["name"], type=data["type"],
        )
        BorrowerHistoryEvent.objects.create(
            borrower=borrower, label="Document uploaded",
            detail=f"{data['name']} ({data['type']})",
        )
        audit.record(
            request.user, "uploaded", "borrower_document", doc.id,
            f'Document "{data["name"]}" added to {borrower.full_name}',
        )
        return Response(ser.BorrowerDocumentSerializer(doc).data, status=status.HTTP_201_CREATED)


# --------------------------------------------------------------------- products

_PRODUCT_PREFETCH = ("fees", "approval_levels")


def product_qs(lender):
    return LoanProduct.objects.filter(lender=lender).prefetch_related(*_PRODUCT_PREFETCH)


def apply_product_write(product, data):
    for field, value in data.items():
        if field not in ("fees", "approval_levels"):
            setattr(product, field, value)
    product.save()
    product.fees.all().delete()
    product.approval_levels.all().delete()
    ProductFee.objects.bulk_create(
        ProductFee(product=product, name=f["name"], kind=f["kind"], value=f["value"], timing=f["timing"])
        for f in data.get("fees", [])
    )
    ApprovalLevel.objects.bulk_create(
        ApprovalLevel(
            product=product, min_amount=a["min_amount"],
            max_amount=a.get("max_amount"), required_role=a["required_role"],
        )
        for a in data.get("approval_levels", [])
    )


class ProductsView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), IsProductManager()]
        return [IsAuthenticated()]

    def get(self, request):
        return Response(ser.LoanProductSerializer(product_qs(request.user.lender), many=True).data)

    def post(self, request):
        data = validated(ser.LoanProductWriteSerializer, request.data)
        with transaction.atomic():
            product = LoanProduct(lender=request.user.lender)
            apply_product_write(product, data)
            audit.record(request.user, "saved", "product", product.id, f'Loan product "{product.name}" saved')
        return Response(
            ser.LoanProductSerializer(product_qs(request.user.lender).get(pk=product.pk)).data,
            status=status.HTTP_201_CREATED,
        )


class ProductDetailView(APIView):
    def get_permissions(self):
        if self.request.method in ("PUT", "PATCH"):
            return [IsAuthenticated(), IsProductManager()]
        return [IsAuthenticated()]

    def get_object(self, request, product_id):
        product = product_qs(request.user.lender).filter(pk=product_id).first()
        if product is None:
            raise NotFound("Loan product not found")
        return product

    def get(self, request, product_id):
        return Response(ser.LoanProductSerializer(self.get_object(request, product_id)).data)

    def put(self, request, product_id):
        product = self.get_object(request, product_id)
        data = validated(ser.LoanProductWriteSerializer, request.data)
        with transaction.atomic():
            apply_product_write(product, data)
            audit.record(request.user, "saved", "product", product.id, f'Loan product "{product.name}" saved')
        return Response(ser.LoanProductSerializer(product_qs(request.user.lender).get(pk=product_id)).data)

    def patch(self, request, product_id):
        product = self.get_object(request, product_id)
        product.active = validated(ser.ProductActiveSerializer, request.data)["active"]
        product.save(update_fields=["active"])
        audit.record(request.user, "updated", "product", product.id, "Product active status toggled")
        return Response(ser.LoanProductSerializer(product_qs(request.user.lender).get(pk=product_id)).data)


# ----------------------------------------------------------------- applications

def application_qs(lender):
    return Application.objects.filter(lender=lender).prefetch_related("approvals")


class ApplicationsView(APIView):
    permission_classes = [IsAuthenticated, section_editor("applications")]

    def get(self, request):
        return Response(ser.ApplicationSerializer(application_qs(request.user.lender), many=True).data)

    def post(self, request):
        data = validated(ser.ApplicationCreateSerializer, request.data)
        lender = request.user.lender
        ensure_branch(lender, data.get("branch_id"))

        borrower = Borrower.objects.filter(pk=data["borrower_id"], lender=lender).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        if borrower.blacklisted:
            raise UnprocessableEntity("Borrower is blacklisted")

        product = product_qs(lender).filter(pk=data["product_id"]).first()
        if product is None:
            raise NotFound("Loan product not found")
        if not product.active:
            raise UnprocessableEntity("Loan product is not active")
        if not (float(product.min_amount) <= data["amount"] <= float(product.max_amount)):
            raise UnprocessableEntity("Amount is outside the product range")
        if not (product.min_term_instalments <= data["term_instalments"] <= product.max_term_instalments):
            raise UnprocessableEntity("Term is outside the product range")

        duplicates = Borrower.objects.filter(lender=lender, national_id=borrower.national_id).count()
        assessment = application_service.assess(
            product=product,
            borrower=borrower,
            amount=data["amount"],
            term_instalments=data["term_instalments"],
            declared_income=data["declared_income"],
            declared_expenses=data["declared_expenses"],
            has_duplicate_national_id=duplicates > 1,
        )
        with transaction.atomic():
            application = Application.objects.create(
                lender=lender,
                branch_id=data.get("branch_id") or borrower.branch_id,
                reference=application_service.next_reference(lender),
                borrower=borrower,
                product=product,
                amount=data["amount"],
                term_instalments=data["term_instalments"],
                purpose=data["purpose"],
                status=ApplicationStatus.PENDING_APPROVAL,
                declared_income=data["declared_income"],
                declared_expenses=data["declared_expenses"],
                affordability_pass=assessment.affordability_pass,
                duplicate_check_pass=assessment.duplicate_check_pass,
                blacklist_check_pass=assessment.blacklist_check_pass,
                credit_bureau_consent=data["credit_bureau_consent"],
                score=assessment.score,
                score_recommendation=assessment.score_recommendation,
                required_approver_role=assessment.required_approver_role,
                created_by=request.user,
            )
            audit.record(
                request.user, "created", "application", application.id,
                f"Application {application.reference} submitted for {borrower.full_name}",
            )
        return Response(
            ser.ApplicationSerializer(application_qs(lender).get(pk=application.pk)).data,
            status=status.HTTP_201_CREATED,
        )


class ApplicationDetailView(APIView):
    permission_classes = [IsAuthenticated, section_editor("applications")]

    def get(self, request, application_id):
        application = application_qs(request.user.lender).filter(pk=application_id).first()
        if application is None:
            raise NotFound("Application not found")
        return Response(ser.ApplicationSerializer(application).data)


class ApplicationDecisionView(APIView):
    permission_classes = [IsAuthenticated, section_editor("applications")]

    def post(self, request, application_id):
        application = application_qs(request.user.lender).filter(pk=application_id).first()
        if application is None:
            raise NotFound("Application not found")
        data = validated(ser.ApplicationDecisionSerializer, request.data)

        if application.status not in (ApplicationStatus.PENDING_APPROVAL, ApplicationStatus.SUBMITTED):
            raise Conflict("This application is no longer open for a decision")
        if application.created_by_id == request.user.id:
            raise PermissionDenied("You created this application — a different approver must decide it")
        if not can_approve_application(request.user.role, application.required_approver_role):
            raise PermissionDenied(f"This amount requires a {application.required_approver_role} decision")
        if (
            request.user.approval_limit > 0
            and float(application.amount) > request.user.approval_limit
            and request.user.role != StaffRole.LENDER_ADMIN
        ):
            raise PermissionDenied(
                f"Your approval limit ({request.user.approval_limit:,.0f}) is below this application amount ({float(application.amount):,.0f})"
            )

        approved = data["decision"] == "approved"
        with transaction.atomic():
            application.status = ApplicationStatus.APPROVED if approved else ApplicationStatus.DECLINED
            application.decline_reason = None if approved else data["comment"]
            application.save(update_fields=["status", "decline_reason"])
            ApprovalDecision.objects.create(
                application=application,
                approver=request.user,
                approver_name=request.user.name,
                role=request.user.role,
                decision=data["decision"],
                comment=data["comment"],
            )
            audit.record(
                request.user, data["decision"], "application", application.id,
                data["comment"] or f"Application {data['decision']} by {request.user.name}",
            )
        notify.decision(request.user.lender, application.borrower, application)
        return Response(ser.ApplicationSerializer(application_qs(request.user.lender).get(pk=application_id)).data)


class DisburseError(Exception):
    """Raised by _disburse_one when an application can't be released."""


def _disburse_one(request_user, application, channel, reference):
    lender = request_user.lender
    if application.status != ApplicationStatus.APPROVED:
        raise DisburseError("Only an approved application can be disbursed")
    if Loan.objects.filter(application=application).exists():
        raise DisburseError("This application has already been disbursed")

    product = product_qs(lender).filter(pk=application.product_id).first()
    last = application.approvals.all().last()
    approver = last.approver_name if last else "Unknown"
    if approver == request_user.name:
        raise DisburseError("The approver and the person releasing funds must be different people")

    with transaction.atomic():
        loan = loan_service.create_loan_from_application(
            application=application, product=product, channel=channel, reference=reference,
            approved_by=approver, disbursed_by=request_user.name,
        )
        application.status = ApplicationStatus.DISBURSED
        application.save(update_fields=["status"])
        audit.record(
            request_user, "disbursed", "loan", loan.id,
            f"{loan.net_disbursed:,.0f} disbursed via {channel} (ref {reference})",
        )
    notify.disbursed(lender, application.borrower, loan)
    return loan


class ApplicationDisburseView(APIView):
    permission_classes = [IsAuthenticated, section_editor("disbursement")]

    def post(self, request, application_id):
        lender = request.user.lender
        application = application_qs(lender).filter(pk=application_id).first()
        if application is None:
            raise NotFound("Application not found")
        data = validated(ser.DisburseSerializer, request.data)
        try:
            loan = _disburse_one(request.user, application, data["channel"], data["reference"])
        except DisburseError as exc:
            msg = str(exc)
            raise PermissionDenied(msg) if "different people" in msg else Conflict(msg)
        return Response(
            ser.LoanSerializer(Loan.objects.prefetch_related("schedule").get(pk=loan.pk)).data,
            status=status.HTTP_201_CREATED,
        )


class DisbursementBatchView(APIView):
    """Release several approved loans in one go — the finance team's daily run."""

    permission_classes = [IsAuthenticated, section_editor("disbursement")]

    def post(self, request):
        lender = request.user.lender
        data = validated(ser.BatchDisburseSerializer, request.data)
        disbursed, skipped = [], []
        for item in data["items"]:
            application = application_qs(lender).filter(pk=item["application_id"]).first()
            if application is None:
                skipped.append({"applicationId": str(item["application_id"]), "reason": "Application not found"})
                continue
            try:
                loan = _disburse_one(request.user, application, item["channel"], item["reference"])
                disbursed.append(loan)
            except DisburseError as exc:
                skipped.append({"applicationId": str(application.id), "reason": str(exc)})
        return Response(
            {
                "disbursed": ser.LoanSerializer(
                    Loan.objects.prefetch_related("schedule").filter(pk__in=[l.pk for l in disbursed]), many=True
                ).data,
                "skipped": skipped,
            },
            status=status.HTTP_201_CREATED if disbursed else status.HTTP_200_OK,
        )


# ------------------------------------------------------------------------ loans

class LoansView(APIView):
    def get(self, request):
        rows = Loan.objects.filter(lender=request.user.lender).prefetch_related("schedule")
        return Response(ser.LoanSerializer(rows, many=True).data)


class LoanDetailView(APIView):
    def get(self, request, loan_id):
        loan = Loan.objects.filter(pk=loan_id, lender=request.user.lender).prefetch_related("schedule").first()
        if loan is None:
            raise NotFound("Loan not found")
        return Response(ser.LoanSerializer(loan).data)


def _active_loan_or_404(lender, loan_id):
    loan = Loan.objects.filter(pk=loan_id, lender=lender).prefetch_related("schedule").first()
    if loan is None:
        raise NotFound("Loan not found")
    if loan.status != LoanStatus.ACTIVE:
        raise Conflict("This loan is not active")
    return loan


class LoanSettleView(APIView):
    """Record a single payment for the full outstanding balance and close the loan."""

    permission_classes = [IsAuthenticated, section_editor("repayments")]

    def post(self, request, loan_id):
        lender = request.user.lender
        loan = _active_loan_or_404(lender, loan_id)
        amount = float(loan.outstanding_balance)
        if amount <= 0:
            raise Conflict("Nothing outstanding to settle")
        channel = request.data.get("channel", "cash")
        if channel not in {c for c, _ in RepaymentChannel.choices}:
            channel = "cash"
        product = product_qs(lender).filter(pk=loan.product_id).first()
        with transaction.atomic():
            repayment = loan_service.post_repayment(
                loan=loan, product=product, amount=amount, channel=channel, recorded_by=request.user.name,
            )
            loan.refresh_from_db()
            if loan.status != LoanStatus.ACTIVE:
                loan.closure_reason = "Early settlement"
                loan.save(update_fields=["closure_reason"])
            audit.record(
                request.user, "settled", "loan", loan.id,
                f"Early settlement of {amount:,.0f}, receipt {repayment.receipt_number}",
            )
        notify.receipt(lender, loan.borrower, repayment)
        return Response(ser.LoanSerializer(Loan.objects.prefetch_related("schedule").get(pk=loan.pk)).data)


class LoanRestructureView(APIView):
    """Reschedule the remaining balance of an active loan — a supervisor concession."""

    permission_classes = [IsAuthenticated, section_editor("collections"), IsSupervisor]

    def get(self, request, loan_id):
        loan = _active_loan_or_404(request.user.lender, loan_id)
        waive = request.query_params.get("waivePenalties", "").lower() in ("1", "true", "yes")
        return Response(restructure_service.preview(loan=loan, waive_penalties=waive))

    def post(self, request, loan_id):
        lender = request.user.lender
        loan = _active_loan_or_404(lender, loan_id)
        data = validated(ser.RestructureSerializer, request.data)
        product = product_qs(lender).filter(pk=loan.product_id).first()
        try:
            with transaction.atomic():
                loan, figures = restructure_service.restructure_loan(
                    loan=loan,
                    product=product,
                    new_term=data["new_term"],
                    first_due_date=data.get("first_due_date"),
                    waive_penalties=data["waive_penalties"],
                    by_name=request.user.name,
                )
                detail = (
                    f"Rescheduled over {data['new_term']} instalments — "
                    f"new principal {figures['new_principal']:,.0f}"
                )
                if figures["penalty_waived"]:
                    detail += f", {figures['penalty_waived']:,.0f} penalty waived"
                if data["reason"]:
                    detail += f" ({data['reason']})"
                audit.record(request.user, "restructured", "loan", loan.id, detail)
                BorrowerHistoryEvent.objects.create(
                    borrower=loan.borrower, label="Loan restructured", detail=detail,
                )
        except ValueError as exc:
            raise Conflict(str(exc))
        return Response(
            ser.LoanSerializer(Loan.objects.prefetch_related("schedule").get(pk=loan.pk)).data
        )


class LoanWriteOffView(APIView):
    permission_classes = [IsAuthenticated, section_editor("repayments"), IsSupervisor]

    def post(self, request, loan_id):
        lender = request.user.lender
        loan = _active_loan_or_404(lender, loan_id)
        reason = validated(ser.WriteOffSerializer, request.data)["reason"]
        with transaction.atomic():
            loan_service.write_off(loan=loan, reason=reason, by_name=request.user.name)
            borrower = loan.borrower
            borrower.blacklisted = True
            borrower.blacklist_reason = f"Loan written off: {reason}"
            borrower.save(update_fields=["blacklisted", "blacklist_reason"])
            BorrowerHistoryEvent.objects.create(
                borrower=borrower, label="Loan written off",
                detail=f"{loan.outstanding_balance:,.0f} written off — {reason}",
            )
            audit.record(request.user, "written_off", "loan", loan.id,
                         f"{loan.outstanding_balance:,.0f} written off: {reason}")
        return Response(ser.LoanSerializer(Loan.objects.prefetch_related("schedule").get(pk=loan.pk)).data)


# -------------------------------------------------------------------- repayments

class RepaymentsView(APIView):
    permission_classes = [IsAuthenticated, section_editor("repayments")]

    def get(self, request):
        rows = Repayment.objects.filter(lender=request.user.lender)
        return Response(ser.RepaymentSerializer(rows, many=True).data)

    def post(self, request):
        data = validated(ser.RepaymentCreateSerializer, request.data)
        if data["amount"] <= 0:
            raise UnprocessableEntity("Amount must be positive")
        lender = request.user.lender
        loan = Loan.objects.filter(pk=data["loan_id"], lender=lender).prefetch_related("schedule").first()
        if loan is None:
            raise NotFound("Loan not found")
        if loan.status != LoanStatus.ACTIVE:
            raise Conflict("This loan is not active")
        product = product_qs(lender).filter(pk=loan.product_id).first()

        with transaction.atomic():
            repayment = loan_service.post_repayment(
                loan=loan, product=product, amount=data["amount"],
                channel=data["channel"], recorded_by=request.user.name,
            )
            audit.record(
                request.user, "recorded", "repayment", repayment.id,
                f"{data['amount']:,.0f} received via {data['channel']}, receipt {repayment.receipt_number}",
            )
        notify.receipt(lender, loan.borrower, repayment)
        return Response(ser.RepaymentSerializer(repayment).data, status=status.HTTP_201_CREATED)


class RepaymentReverseView(APIView):
    permission_classes = [IsAuthenticated, section_editor("repayments"), IsSupervisor]

    def post(self, request, repayment_id):
        lender = request.user.lender
        repayment = Repayment.objects.filter(pk=repayment_id, lender=lender).first()
        if repayment is None:
            raise NotFound("Repayment not found")
        if repayment.reversed:
            raise Conflict("This payment has already been reversed")
        data = validated(ser.RepaymentReverseSerializer, request.data)

        loan = Loan.objects.filter(pk=repayment.loan_id, lender=lender).prefetch_related("schedule").first()
        product = product_qs(lender).filter(pk=loan.product_id).first()
        loan_repayments = list(Repayment.objects.filter(loan=loan))

        with transaction.atomic():
            loan_service.reverse_repayment(
                repayment=repayment, loan=loan, product=product,
                loan_repayments=loan_repayments, reason=data["reason"],
            )
            audit.record(request.user, "reversed", "repayment", repayment.id, f"Reversal reason: {data['reason']}")
        repayment.refresh_from_db()
        return Response(ser.RepaymentSerializer(repayment).data)


# ------------------------------------------------------------------------ audit

class AuditView(APIView):
    permission_classes = [IsAuthenticated, has_section("audit")]

    def get(self, request):
        limit = min(int(request.query_params.get("limit", 500)), 1000)
        rows = request.user.lender.audit_entries.all()[:limit]
        return Response(ser.AuditLogEntrySerializer(rows, many=True).data)


# ------------------------------------------------------------------ collections

def _attach_promise_status(activities, lender):
    """Resolve promise-to-pay status for each activity in bulk."""
    loan_ids = {a.loan_id for a in activities}
    reps_by_loan: dict = {}
    for r in Repayment.objects.filter(lender=lender, loan_id__in=loan_ids):
        reps_by_loan.setdefault(r.loan_id, []).append(r)
    for a in activities:
        a._promise_status = collections_service.promise_status(a, reps_by_loan.get(a.loan_id, []))
    return activities


class CollectionActivitiesView(APIView):
    """Every collection activity for the workspace — the workbench joins these
    onto the loans it already has client-side."""

    def get(self, request):
        rows = list(CollectionActivity.objects.filter(lender=request.user.lender))
        _attach_promise_status(rows, request.user.lender)
        return Response(ser.CollectionActivitySerializer(rows, many=True).data)


class LoanCollectionActivityView(APIView):
    permission_classes = [IsAuthenticated, section_editor("collections")]

    def post(self, request, loan_id):
        lender = request.user.lender
        loan = Loan.objects.filter(pk=loan_id, lender=lender).select_related("borrower").first()
        if loan is None:
            raise NotFound("Loan not found")
        data = validated(ser.CollectionActivityCreateSerializer, request.data)
        with transaction.atomic():
            activity = CollectionActivity.objects.create(
                lender=lender,
                loan=loan,
                borrower=loan.borrower,
                kind=data["kind"],
                outcome=data.get("outcome") or "",
                note=data.get("note") or "",
                promised_amount=data.get("promised_amount"),
                promised_date=data.get("promised_date"),
                created_by=request.user.name,
            )
            label = "Promise to pay" if data["kind"] == "promise" else data["kind"].title()
            audit.record(
                request.user, "logged", "collection_activity", activity.id,
                f"{label} on {loan.borrower.full_name}'s loan",
            )
        _attach_promise_status([activity], lender)
        return Response(ser.CollectionActivitySerializer(activity).data, status=status.HTTP_201_CREATED)


class LoanReminderView(APIView):
    permission_classes = [IsAuthenticated, section_editor("collections")]

    def post(self, request, loan_id):
        lender = request.user.lender
        loan = Loan.objects.filter(pk=loan_id, lender=lender).select_related("borrower").first()
        if loan is None:
            raise NotFound("Loan not found")
        if loan.status != LoanStatus.ACTIVE or loan.days_in_arrears <= 0:
            raise Conflict("This loan is not in arrears")
        note = notify.arrears_reminder(lender, loan.borrower, loan)
        with transaction.atomic():
            CollectionActivity.objects.create(
                lender=lender, loan=loan, borrower=loan.borrower, kind="message",
                outcome="reached" if note.status == "sent" else "other",
                note=f"Arrears reminder SMS ({note.status})", created_by=request.user.name,
            )
            audit.record(
                request.user, "reminded", "loan", loan.id,
                f"Arrears reminder sent to {loan.borrower.full_name} ({note.status})",
            )
        return Response(ser.NotificationSerializer(note).data, status=status.HTTP_201_CREATED)


# --------------------------------------------------------------------- savings

class SavingsListView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def get(self, request):
        rows = SavingsAccount.objects.filter(lender=request.user.lender).select_related("borrower")
        return Response(ser.SavingsAccountListSerializer(rows, many=True).data)


class BorrowerSavingsView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def get(self, request, borrower_id):
        borrower = Borrower.objects.filter(pk=borrower_id, lender=request.user.lender).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        account = savings_service.account_for(request.user.lender, borrower)
        account = SavingsAccount.objects.prefetch_related("transactions").get(pk=account.pk)
        return Response(ser.SavingsAccountSerializer(account).data)

    def post(self, request, borrower_id):
        borrower = Borrower.objects.filter(pk=borrower_id, lender=request.user.lender).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        data = validated(ser.SavingsTransactionCreateSerializer, request.data)
        account = savings_service.account_for(request.user.lender, borrower)
        try:
            with transaction.atomic():
                txn = savings_service.post(
                    account, kind=data["kind"], amount=data["amount"],
                    by_name=request.user.name, note=data.get("note") or "",
                )
                audit.record(
                    request.user, data["kind"], "savings", account.id,
                    f"{data['kind'].title()} {data['amount']:,.0f} — {borrower.full_name} (balance {account.balance:,.0f})",
                )
        except ValueError as exc:
            raise UnprocessableEntity(str(exc))
        _ = txn
        account = SavingsAccount.objects.prefetch_related("transactions").get(pk=account.pk)
        return Response(ser.SavingsAccountSerializer(account).data, status=status.HTTP_201_CREATED)


# ------------------------------------------------------------------- cash drawer

class TillTodayView(APIView):
    permission_classes = [IsAuthenticated, section_editor("repayments")]

    def get(self, request):
        from django.utils import timezone as _tz

        as_of = request.query_params.get("date")
        business_date = _tz.datetime.fromisoformat(as_of).date() if as_of else _tz.localdate()
        return Response(till_service.position(request.user.lender, request.user.name, business_date))


class TillView(APIView):
    permission_classes = [IsAuthenticated, section_editor("repayments")]

    def get(self, request):
        rows = TillReconciliation.objects.filter(lender=request.user.lender)[:100]
        return Response(ser.TillReconciliationSerializer(rows, many=True).data)

    def post(self, request):
        from django.utils import timezone as _tz

        data = validated(ser.TillCloseSerializer, request.data)
        business_date = data.get("business_date") or _tz.localdate()
        pos = till_service.position(request.user.lender, request.user.name, business_date)
        if pos["closed"]:
            raise Conflict("The drawer is already closed for this date")

        counted = round(float(data["counted_close"]), 2)
        variance = round(counted - pos["expected_close"], 2)
        with transaction.atomic():
            rec = TillReconciliation.objects.create(
                lender=request.user.lender,
                branch_id=request.user.branch_id,
                cashier_name=request.user.name,
                business_date=business_date,
                opening_float=pos["opening_float"],
                cash_in=pos["cash_in"],
                cash_out=pos["cash_out"],
                expected_close=pos["expected_close"],
                counted_close=counted,
                variance=variance,
                note=data.get("note") or "",
            )
            audit.record(
                request.user, "closed", "till", rec.id,
                f"Drawer closed for {business_date}: counted {counted:,.0f}, variance {variance:+,.0f}",
            )
        return Response(ser.TillReconciliationSerializer(rec).data, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------- notifications

class NotificationsView(APIView):
    def get(self, request):
        limit = min(int(request.query_params.get("limit", 200)), 1000)
        rows = Notification.objects.filter(lender=request.user.lender)[:limit]
        return Response(ser.NotificationSerializer(rows, many=True).data)


# --------------------------------------------------------------- password change

class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = validated(ser.ChangePasswordSerializer, request.data)
        if not request.user.check_password(data["current_password"]):
            raise AuthenticationFailed("Current password is incorrect")
        request.user.set_password(data["new_password"])
        request.user.save()
        audit.record(request.user, "changed_password", "staff", request.user.id, "Password changed")
        return Response({"detail": "Password updated"})


# ----------------------------------------------------------------------- export

class BorrowersExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        import csv as csv_mod

        rows = Borrower.objects.filter(lender=request.user.lender)
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = "attachment; filename=borrowers.csv"
        writer = csv_mod.writer(response)
        writer.writerow([
            "ID", "Full Name", "Type", "National ID", "Phone", "Branch", "Officer",
            "Residence", "Occupation", "Monthly Income", "Next of Kin", "Blacklisted", "Created At",
        ])
        branch_map = {b.id: b.name for b in Branch.objects.filter(lender=request.user.lender)}
        staff_map = {s.id: s.name for s in Staff.objects.filter(lender=request.user.lender)}
        for b in rows:
            writer.writerow([
                str(b.id), b.full_name, b.type, b.national_id, b.phone,
                branch_map.get(b.branch_id, ""), staff_map.get(b.officer_id, ""),
                b.residence, b.occupation, float(b.monthly_income), b.next_of_kin,
                "Yes" if b.blacklisted else "No", b.created_at.isoformat(),
            ])
        return response


class LoansExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        import csv as csv_mod

        rows = Loan.objects.filter(lender=request.user.lender).select_related("borrower", "product")
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = "attachment; filename=loans.csv"
        writer = csv_mod.writer(response)
        writer.writerow([
            "ID", "Borrower", "Product", "Principal", "Net Disbursed", "Fees Deducted",
            "Status", "Outstanding", "Days in Arrears", "Arrears Amount",
            "Disbursement Date", "Closed At", "Closure Reason", "Created At",
        ])
        for l in rows:
            writer.writerow([
                str(l.id), l.borrower.full_name, l.product.name,
                float(l.principal), float(l.net_disbursed), float(l.fees_deducted),
                l.status, float(l.outstanding_balance), l.days_in_arrears,
                float(l.arrears_amount), l.disbursement_date.isoformat() if l.disbursement_date else "",
                l.closed_at.isoformat() if l.closed_at else "", l.closure_reason,
                l.created_at.isoformat(),
            ])
        return response


class RepaymentsExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        import csv as csv_mod

        rows = Repayment.objects.filter(lender=request.user.lender).select_related("loan")
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = "attachment; filename=repayments.csv"
        writer = csv_mod.writer(response)
        writer.writerow([
            "ID", "Loan ID", "Amount", "Date", "Channel", "Receipt Number",
            "Penalty", "Fees", "Interest", "Principal", "Recorded By", "Reversed",
        ])
        for r in rows:
            writer.writerow([
                str(r.id), str(r.loan_id), float(r.amount), r.date.isoformat(),
                r.channel, r.receipt_number, float(r.allocation_penalty),
                float(r.allocation_fees), float(r.allocation_interest),
                float(r.allocation_principal), r.recorded_by,
                "Yes" if r.reversed else "No",
            ])
        return response


# -------------------------------------------------------------------- step-up

class BorrowerStepUpView(APIView):
    """Check if a borrower qualifies for a step-up (higher ceiling) based on
    clean repayment history across all their loans."""

    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def get(self, request, borrower_id):
        lender = request.user.lender
        borrower = Borrower.objects.filter(pk=borrower_id, lender=lender).first()
        if borrower is None:
            raise NotFound("Borrower not found")

        loans = Loan.objects.filter(borrower=borrower, lender=lender)
        active_loans = loans.filter(status=LoanStatus.ACTIVE)

        if not active_loans.exists():
            return Response({"qualified": False, "reason": "No active loans"})

        has_arrears = active_loans.filter(days_in_arrears__gt=0).exists()
        max_principal = max(float(l.principal) for l in loans)
        clean_count = loans.filter(days_in_arrears=0, status=LoanStatus.CLOSED).count()

        qualified = not has_arrears and clean_count >= 2
        suggested_limit = max_principal * 1.5 if qualified else max_principal

        return Response({
            "qualified": qualified,
            "cleanLoans": clean_count,
            "currentMaxPrincipal": max_principal,
            "suggestedLimit": round(suggested_limit),
            "reason": (
                "Borrower has a clean repayment history and qualifies for a higher ceiling"
                if qualified
                else "Borrower has active arrears or insufficient clean loan history"
            ),
        })
