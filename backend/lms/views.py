from django.db import transaction
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed, NotFound, PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import AccessToken

from lms import serializers as ser
from lms.enums import ApplicationStatus, LoanStatus, StaffRole
from lms.exceptions import Conflict, UnprocessableEntity
from lms.models import (
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
    Repayment,
    Staff,
)
from lms.permissions import (
    IsAdmin,
    IsProductManager,
    can_approve_application,
    has_section,
    is_supervisor,
    section_editor,
)
from lms.services import applications as application_service
from lms.services import audit, loans as loan_service
from lms.tenancy import ensure_branch, ensure_staff_member


def _token_for(staff: Staff) -> str:
    return str(AccessToken.for_user(staff))


def _validated(serializer_cls, data):
    s = serializer_cls(data=data)
    s.is_valid(raise_exception=True)
    return s.validated_data




# ------------------------------------------------------------------------- auth

class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        data = _validated(ser.RegisterSerializer, request.data)
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
        return Response({"access_token": _token_for(admin)}, status=status.HTTP_201_CREATED)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        data = _validated(ser.LoginSerializer, request.data)
        staff = Staff.objects.filter(email=data["email"].lower()).first()
        if staff is None or not staff.check_password(data["password"]):
            raise AuthenticationFailed("Incorrect email or password")
        if not staff.is_active:
            raise PermissionDenied("This account has been suspended")
        return Response({"access_token": _token_for(staff)})


class MeView(APIView):
    def get(self, request):
        return Response(ser.CurrentStaffSerializer(request.user).data)


# ----------------------------------------------------------------------- lender

class LenderView(APIView):
    def get(self, request):
        return Response(ser.LenderSerializer(request.user.lender).data)

    def patch(self, request):
        if not IsAdmin().has_permission(request, self):
            raise PermissionDenied(IsAdmin.message)
        lender = request.user.lender
        data = _validated(ser.LenderUpdateSerializer, request.data)
        for field, value in data.items():
            setattr(lender, field, value)
        lender.save()
        audit.record(request.user, "updated", "lender", lender.id, "Lender profile updated")
        return Response(ser.LenderSerializer(lender).data)


# --------------------------------------------------------------------- branches

class BranchesView(APIView):
    def get(self, request):
        rows = Branch.objects.filter(lender=request.user.lender)
        return Response(ser.BranchSerializer(rows, many=True).data)

    def post(self, request):
        self._require_admin(request)
        data = _validated(ser.BranchCreateSerializer, request.data)
        branch = Branch.objects.create(lender=request.user.lender, **data)
        audit.record(request.user, "created", "branch", branch.id, f'Branch "{branch.name}" added')
        return Response(ser.BranchSerializer(branch).data, status=status.HTTP_201_CREATED)

    def _require_admin(self, request):
        if not IsAdmin().has_permission(request, self):
            raise PermissionDenied(IsAdmin.message)


# ------------------------------------------------------------------------ staff

class StaffListView(APIView):
    def get(self, request):
        rows = Staff.objects.filter(lender=request.user.lender)
        return Response(ser.StaffSerializer(rows, many=True).data)

    def post(self, request):
        if not IsAdmin().has_permission(request, self):
            raise PermissionDenied(IsAdmin.message)
        data = _validated(ser.StaffCreateSerializer, request.data)
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


class StaffDetailView(APIView):
    def patch(self, request, staff_id):
        if not IsAdmin().has_permission(request, self):
            raise PermissionDenied(IsAdmin.message)
        member = Staff.objects.filter(pk=staff_id, lender=request.user.lender).first()
        if member is None:
            raise NotFound("Staff member not found")
        data = _validated(ser.StaffUpdateSerializer, request.data)
        if data.get("branch_id") is not None:
            ensure_branch(request.user.lender, data["branch_id"])
        mapping = {
            "name": "name", "role": "role", "phone": "phone",
            "branch_id": "branch_id", "active": "is_active",
        }
        for src, dest in mapping.items():
            if src in data:
                setattr(member, dest, data[src])
        if "approval_limit" in data:
            member.approval_limit = int(data["approval_limit"])
        member.save()
        audit.record(request.user, "updated", "staff", member.id, "Staff account updated")
        return Response(ser.StaffSerializer(member).data)


# --------------------------------------------------------------------- holidays

class HolidaysView(APIView):
    def get(self, request):
        rows = Holiday.objects.filter(lender=request.user.lender)
        return Response(ser.HolidaySerializer(rows, many=True).data)

    def post(self, request):
        if not IsAdmin().has_permission(request, self):
            raise PermissionDenied(IsAdmin.message)
        data = _validated(ser.HolidayCreateSerializer, request.data)
        holiday = Holiday.objects.create(lender=request.user.lender, **data)
        audit.record(request.user, "created", "holiday", holiday.id, f'Holiday "{holiday.name}" added')
        return Response(ser.HolidaySerializer(holiday).data, status=status.HTTP_201_CREATED)


class HolidayDetailView(APIView):
    def delete(self, request, holiday_id):
        if not IsAdmin().has_permission(request, self):
            raise PermissionDenied(IsAdmin.message)
        holiday = Holiday.objects.filter(pk=holiday_id, lender=request.user.lender).first()
        if holiday is None:
            raise NotFound("Holiday not found")
        holiday.delete()
        audit.record(request.user, "deleted", "holiday", holiday_id, "Holiday removed")
        return Response(status=status.HTTP_204_NO_CONTENT)


# -------------------------------------------------------------------- borrowers

_BORROWER_PREFETCH = ("guarantors", "documents", "history")


def _borrower_qs(lender):
    return Borrower.objects.filter(lender=lender).prefetch_related(*_BORROWER_PREFETCH)


class BorrowersView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def get(self, request):
        return Response(ser.BorrowerSerializer(_borrower_qs(request.user.lender), many=True).data)

    def post(self, request):
        data = _validated(ser.BorrowerCreateSerializer, request.data)
        lender = request.user.lender
        officer_id = data.get("officer_id") or request.user.id
        ensure_branch(lender, data["branch_id"])
        ensure_staff_member(lender, officer_id)

        guarantors = data.pop("guarantors", [])
        data.pop("officer_id", None)
        with transaction.atomic():
            borrower = Borrower.objects.create(
                lender=lender, officer_id=officer_id, blacklisted=False, **data
            )
            Guarantor.objects.bulk_create(Guarantor(borrower=borrower, **g) for g in guarantors)
            BorrowerHistoryEvent.objects.create(
                borrower=borrower, label="File opened",
                detail=f"Borrower registered by {request.user.name}",
            )
            audit.record(request.user, "created", "borrower", borrower.id,
                         f'Borrower "{borrower.full_name}" registered')
        borrower = _borrower_qs(lender).get(pk=borrower.pk)
        return Response(ser.BorrowerSerializer(borrower).data, status=status.HTTP_201_CREATED)


class BorrowerDetailView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def get(self, request, borrower_id):
        borrower = _borrower_qs(request.user.lender).filter(pk=borrower_id).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        return Response(ser.BorrowerSerializer(borrower).data)


class BorrowerBlacklistView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def post(self, request, borrower_id):
        borrower = _borrower_qs(request.user.lender).filter(pk=borrower_id).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        data = _validated(ser.BlacklistSerializer, request.data)
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
        borrower = _borrower_qs(request.user.lender).get(pk=borrower_id)
        return Response(ser.BorrowerSerializer(borrower).data)


# --------------------------------------------------------------------- products

_PRODUCT_PREFETCH = ("fees", "approval_levels")


def _product_qs(lender):
    return LoanProduct.objects.filter(lender=lender).prefetch_related(*_PRODUCT_PREFETCH)


def _apply_product_write(product, data):
    from lms.models import ApprovalLevel, ProductFee

    scalar = {k: v for k, v in data.items() if k not in ("fees", "approval_levels")}
    for field, value in scalar.items():
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
    def get(self, request):
        return Response(ser.LoanProductSerializer(_product_qs(request.user.lender), many=True).data)

    def post(self, request):
        if not IsProductManager().has_permission(request, self):
            raise PermissionDenied(IsProductManager.message)
        data = _validated(ser.LoanProductWriteSerializer, request.data)
        with transaction.atomic():
            product = LoanProduct(lender=request.user.lender)
            _apply_product_write(product, data)
            audit.record(request.user, "saved", "product", product.id, f'Loan product "{product.name}" saved')
        product = _product_qs(request.user.lender).get(pk=product.pk)
        return Response(ser.LoanProductSerializer(product).data, status=status.HTTP_201_CREATED)


class ProductDetailView(APIView):
    def _get(self, request, product_id):
        product = _product_qs(request.user.lender).filter(pk=product_id).first()
        if product is None:
            raise NotFound("Loan product not found")
        return product

    def get(self, request, product_id):
        return Response(ser.LoanProductSerializer(self._get(request, product_id)).data)

    def put(self, request, product_id):
        if not IsProductManager().has_permission(request, self):
            raise PermissionDenied(IsProductManager.message)
        product = self._get(request, product_id)
        data = _validated(ser.LoanProductWriteSerializer, request.data)
        with transaction.atomic():
            _apply_product_write(product, data)
            audit.record(request.user, "saved", "product", product.id, f'Loan product "{product.name}" saved')
        return Response(ser.LoanProductSerializer(_product_qs(request.user.lender).get(pk=product_id)).data)

    def patch(self, request, product_id):
        if not IsProductManager().has_permission(request, self):
            raise PermissionDenied(IsProductManager.message)
        product = self._get(request, product_id)
        data = _validated(ser.ProductActiveSerializer, request.data)
        product.active = data["active"]
        product.save(update_fields=["active"])
        audit.record(request.user, "updated", "product", product.id, "Product active status toggled")
        return Response(ser.LoanProductSerializer(_product_qs(request.user.lender).get(pk=product_id)).data)


# ----------------------------------------------------------------- applications

def _application_qs(lender):
    return Application.objects.filter(lender=lender).prefetch_related("approvals")


class ApplicationsView(APIView):
    permission_classes = [IsAuthenticated, section_editor("applications")]

    def get(self, request):
        return Response(ser.ApplicationSerializer(_application_qs(request.user.lender), many=True).data)

    def post(self, request):
        data = _validated(ser.ApplicationCreateSerializer, request.data)
        lender = request.user.lender
        ensure_branch(lender, data.get("branch_id"))

        borrower = Borrower.objects.filter(pk=data["borrower_id"], lender=lender).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        if borrower.blacklisted:
            raise UnprocessableEntity("Borrower is blacklisted")

        product = _product_qs(lender).filter(pk=data["product_id"]).first()
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
        application = _application_qs(lender).get(pk=application.pk)
        return Response(ser.ApplicationSerializer(application).data, status=status.HTTP_201_CREATED)


class ApplicationDetailView(APIView):
    permission_classes = [IsAuthenticated, section_editor("applications")]

    def get(self, request, application_id):
        application = _application_qs(request.user.lender).filter(pk=application_id).first()
        if application is None:
            raise NotFound("Application not found")
        return Response(ser.ApplicationSerializer(application).data)


class ApplicationDecisionView(APIView):
    permission_classes = [IsAuthenticated, section_editor("applications")]

    def post(self, request, application_id):
        application = _application_qs(request.user.lender).filter(pk=application_id).first()
        if application is None:
            raise NotFound("Application not found")
        data = _validated(ser.ApplicationDecisionSerializer, request.data)

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
        application = _application_qs(request.user.lender).get(pk=application_id)
        return Response(ser.ApplicationSerializer(application).data)


class ApplicationDisburseView(APIView):
    permission_classes = [IsAuthenticated, section_editor("disbursement")]

    def post(self, request, application_id):
        lender = request.user.lender
        application = _application_qs(lender).filter(pk=application_id).first()
        if application is None:
            raise NotFound("Application not found")
        if application.status != ApplicationStatus.APPROVED:
            raise Conflict("Only an approved application can be disbursed")
        if Loan.objects.filter(application=application).exists():
            raise Conflict("This application has already been disbursed")

        product = _product_qs(lender).filter(pk=application.product_id).first()
        data = _validated(ser.DisburseSerializer, request.data)
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
        loan = Loan.objects.prefetch_related("schedule").get(pk=loan.pk)
        return Response(ser.LoanSerializer(loan).data, status=status.HTTP_201_CREATED)


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


# -------------------------------------------------------------------- repayments

class RepaymentsView(APIView):
    permission_classes = [IsAuthenticated, section_editor("repayments")]

    def get(self, request):
        rows = Repayment.objects.filter(lender=request.user.lender)
        return Response(ser.RepaymentSerializer(rows, many=True).data)

    def post(self, request):
        data = _validated(ser.RepaymentCreateSerializer, request.data)
        if data["amount"] <= 0:
            raise UnprocessableEntity("Amount must be positive")
        lender = request.user.lender
        loan = Loan.objects.filter(pk=data["loan_id"], lender=lender).prefetch_related("schedule").first()
        if loan is None:
            raise NotFound("Loan not found")
        if loan.status != LoanStatus.ACTIVE:
            raise Conflict("This loan is not active")
        product = _product_qs(lender).filter(pk=loan.product_id).first()

        with transaction.atomic():
            repayment = loan_service.post_repayment(
                loan=loan, product=product, amount=data["amount"],
                channel=data["channel"], recorded_by=request.user.name,
            )
            audit.record(
                request.user, "recorded", "repayment", repayment.id,
                f"{data['amount']:,.0f} received via {data['channel']}, receipt {repayment.receipt_number}",
            )
        return Response(ser.RepaymentSerializer(repayment).data, status=status.HTTP_201_CREATED)


class RepaymentReverseView(APIView):
    permission_classes = [IsAuthenticated, section_editor("repayments")]

    def post(self, request, repayment_id):
        if not is_supervisor(request.user.role):
            raise PermissionDenied("Only a supervisor can reverse a posted payment")
        lender = request.user.lender
        repayment = Repayment.objects.filter(pk=repayment_id, lender=lender).first()
        if repayment is None:
            raise NotFound("Repayment not found")
        if repayment.reversed:
            raise Conflict("This payment has already been reversed")
        data = _validated(ser.RepaymentReverseSerializer, request.data)

        loan = Loan.objects.filter(pk=repayment.loan_id, lender=lender).prefetch_related("schedule").first()
        product = _product_qs(lender).filter(pk=loan.product_id).first()
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
