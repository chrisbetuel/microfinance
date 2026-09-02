from django.db import transaction
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
    BorrowerHistoryEvent,
    Branch,
    Guarantor,
    Holiday,
    Lender,
    Loan,
    LoanProduct,
    ProductFee,
    Repayment,
    Staff,
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
from lms.services import audit, loans as loan_service, notify
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


class ApplicationDisburseView(APIView):
    permission_classes = [IsAuthenticated, section_editor("disbursement")]

    def post(self, request, application_id):
        lender = request.user.lender
        application = application_qs(lender).filter(pk=application_id).first()
        if application is None:
            raise NotFound("Application not found")
        if application.status != ApplicationStatus.APPROVED:
            raise Conflict("Only an approved application can be disbursed")
        if Loan.objects.filter(application=application).exists():
            raise Conflict("This application has already been disbursed")

        product = product_qs(lender).filter(pk=application.product_id).first()
        data = validated(ser.DisburseSerializer, request.data)
        last = application.approvals.all().last()
        approver = last.approver_name if last else "Unknown"
        if approver == request.user.name:
            raise PermissionDenied("The approver and the person releasing funds must be different people")

        with transaction.atomic():
            loan = loan_service.create_loan_from_application(
                application=application,
                product=product,
                channel=data["channel"],
                reference=data["reference"],
                approved_by=approver,
                disbursed_by=request.user.name,
            )
            application.status = ApplicationStatus.DISBURSED
            application.save(update_fields=["status"])
            audit.record(
                request.user, "disbursed", "loan", loan.id,
                f"{loan.net_disbursed:,.0f} disbursed via {data['channel']} (ref {data['reference']})",
            )
        notify.disbursed(lender, application.borrower, loan)
        return Response(
            ser.LoanSerializer(Loan.objects.prefetch_related("schedule").get(pk=loan.pk)).data,
            status=status.HTTP_201_CREATED,
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


# ---------------------------------------------------------------- notifications

class NotificationsView(APIView):
    def get(self, request):
        limit = min(int(request.query_params.get("limit", 200)), 1000)
        rows = Notification.objects.filter(lender=request.user.lender)[:limit]
        return Response(ser.NotificationSerializer(rows, many=True).data)
