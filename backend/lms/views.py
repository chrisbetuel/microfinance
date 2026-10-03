from datetime import timedelta

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
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
    ApplicationDocument,
    ApplicationEvent,
    ApprovalDecision,
    Borrower,
    BorrowerDocument,
    BorrowerGroup,
    BorrowerHistoryEvent,
    Branch,
    Collateral,
    CollectionActivity,
    CollectionCase,
    Disbursement,
    LedgerEntry,
    GroupAttendance,
    GroupDocument,
    GroupHistoryEvent,
    GroupMeeting,
    GroupMembership,
    Guarantor,
    Holiday,
    Lender,
    Loan,
    LoanProduct,
    PaymentTransaction,
    ProductFee,
    Repayment,
    SavingsAccount,
    SavingsTransaction,
    Staff,
    StatementLine,
    TillReconciliation,
)
from lms.permissions import (
    IsAdmin,
    IsProductManager,
    IsSupervisor,
    can_approve_application,
    is_supervisor,
    has_section,
    has_section_access,
    section_editor,
)
from lms.models import Notification
from lms.services import applications as application_service
from lms.services import (
    audit,
    collections as collections_service,
    disbursements as disbursement_service,
    collection_cases as case_service,
    ledger as ledger_service,
    products as product_service,
    repayments as repayment_service,
    gateway as gateway_service,
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

    def patch(self, request):
        data = validated(ser.ProfileUpdateSerializer, request.data)
        fields = []
        for f in ("name", "phone"):
            if f in data:
                setattr(request.user, f, data[f])
                fields.append(f)
        if fields:
            request.user.save(update_fields=fields)
            audit.record(request.user, "updated", "staff", request.user.id, "Updated own profile")
        return Response(ser.CurrentStaffSerializer(request.user).data)


# ----------------------------------------------------------------------- lender

class LenderView(AdminWriteView):
    def get(self, request):
        return Response(ser.LenderSerializer(request.user.lender).data)

    def patch(self, request):
        lender = request.user.lender
        data = validated(ser.LenderUpdateSerializer, request.data)
        diff = audit.diff(lender, data)
        for field, value in data.items():
            setattr(lender, field, value)
        lender.save()
        if diff:
            audit.record(request.user, "updated", "lender", lender.id, "Lender profile updated", changes=diff)
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
        diff = audit.diff(member, {dest: data[src] for src, dest in field_map.items() if src in data})
        if "approval_limit" in data:
            diff.update(audit.diff(member, {"approval_limit": int(data["approval_limit"])}))
        for src, dest in field_map.items():
            if src in data:
                setattr(member, dest, data[src])
        if "approval_limit" in data:
            member.approval_limit = int(data["approval_limit"])
        member.save()
        audit.record(request.user, "updated", "staff", member.id, f"Staff account updated: {member.name}", changes=diff)
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
        data = _clean_profile(validated(ser.BorrowerCreateSerializer, request.data))
        lender = request.user.lender
        officer_id = data.pop("officer_id", None) or request.user.id
        guarantors = data.pop("guarantors", None) or []
        ensure_branch(lender, data["branch_id"])
        ensure_staff_member(lender, officer_id)
        _reject_duplicates(lender, data)
        if not data.get("next_of_kin") and data.get("emergency_name"):
            data["next_of_kin"] = data["emergency_name"]

        with transaction.atomic():
            borrower = Borrower.objects.create(
                lender=lender, officer_id=officer_id, blacklisted=False,
                customer_number=_next_customer_number(lender), **data,
            )
            Guarantor.objects.bulk_create(
                Guarantor(borrower=borrower, **{k: v for k, v in g.items() if k != "id"}) for g in guarantors
            )
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
        data = _clean_profile(validated(ser.BorrowerUpdateSerializer, request.data))
        if "branch_id" in data:
            ensure_branch(lender, data["branch_id"])
        if "officer_id" in data and data["officer_id"] is not None:
            ensure_staff_member(lender, data["officer_id"])
        guarantors = data.pop("guarantors", None)
        _reject_duplicates(lender, data, exclude_id=borrower.id)
        diff = audit.diff(borrower, {k: v for k, v in data.items() if not (k == "officer_id" and v is None)})

        changes = []
        for field, new_val in data.items():
            if field == "officer_id" and new_val is None:
                continue
            old_val = getattr(borrower, field)
            if str(old_val if old_val is not None else "") != str(new_val if new_val is not None else ""):
                changes.append(field.replace("_", " "))
            setattr(borrower, field, new_val)
        if guarantors is not None:
            # update guarantors by id so applications that name them keep their links
            existing = {g.id: g for g in borrower.guarantors.all()}
            kept = set()
            for g in guarantors:
                gid = g.pop("id", None)
                if gid in existing:
                    for field, value in g.items():
                        setattr(existing[gid], field, value)
                    existing[gid].save()
                    kept.add(gid)
                else:
                    Guarantor.objects.create(borrower=borrower, **g)
            borrower.guarantors.exclude(pk__in=kept).filter(pk__in=list(existing)).delete()
            changes.append("guarantors")
        borrower.save()

        if changes:
            with transaction.atomic():
                BorrowerHistoryEvent.objects.create(
                    borrower=borrower, label="Profile updated",
                    detail="Changed: " + ", ".join(changes),
                )
                audit.record(
                    request.user, "updated", "borrower", borrower.id,
                    f'Borrower "{borrower.full_name}" profile updated', changes=diff,
                )
        return Response(ser.BorrowerSerializer(borrower_qs(lender).get(pk=borrower.pk)).data)


_NON_NULL_TEXT = set(ser.BORROWER_TEXT_FIELDS) - {"business_name", "registration_number", "tax_id", "sector"}


def _clean_profile(data: dict) -> dict:
    """Blank-able text columns aren't nullable — store None as an empty string."""
    for name in _NON_NULL_TEXT:
        if name in data and data[name] is None:
            data[name] = ""
    return data


def _next_customer_number(lender) -> str:
    n = Borrower.objects.filter(lender=lender).count() + 1
    while Borrower.objects.filter(lender=lender, customer_number=f"CUS-{n:05d}").exists():
        n += 1
    return f"CUS-{n:05d}"


def _reject_duplicates(lender, data, exclude_id=None):
    """NIDA and phone numbers identify a borrower — refuse a second record."""
    qs = Borrower.objects.filter(lender=lender)
    if exclude_id is not None:
        qs = qs.exclude(pk=exclude_id)
    nid = (data.get("national_id") or "").strip()
    if nid:
        other = qs.filter(national_id__iexact=nid).first()
        if other:
            raise Conflict(f"NIDA number already registered to {other.full_name} ({other.customer_number})")
    phone = "".join(ch for ch in (data.get("phone") or "") if ch.isdigit())
    if phone:
        for other in qs.only("id", "full_name", "customer_number", "phone"):
            if "".join(ch for ch in other.phone if ch.isdigit()) == phone:
                raise Conflict(f"Phone number already belongs to {other.full_name} ({other.customer_number})")


class BorrowerVerifyView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def post(self, request, borrower_id):
        borrower = borrower_qs(request.user.lender).filter(pk=borrower_id).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        data = validated(ser.BorrowerVerifySerializer, request.data)
        with transaction.atomic():
            borrower.verified = data["verified"]
            if "phone_verified" in data:
                borrower.phone_verified = data["phone_verified"]
            borrower.verified_by = request.user.name if borrower.verified else ""
            borrower.verified_at = timezone.now() if borrower.verified else None
            borrower.save(update_fields=["verified", "phone_verified", "verified_by", "verified_at"])
            label = "Profile verified" if borrower.verified else "Verification removed"
            BorrowerHistoryEvent.objects.create(borrower=borrower, label=label, detail=f"By {request.user.name}")
            audit.record(request.user, "verified" if borrower.verified else "unverified", "borrower", borrower.id,
                         f"{label}: {borrower.full_name}")
        return Response(ser.BorrowerSerializer(borrower_qs(request.user.lender).get(pk=borrower_id)).data)


class CollateralListView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def get(self, request):
        rows = Collateral.objects.filter(lender=request.user.lender)
        return Response(ser.CollateralSerializer(rows, many=True).data)


class BorrowerGuarantorsView(APIView):
    """Add one guarantor — used while capturing a loan application."""

    permission_classes = [IsAuthenticated, section_editor("applications")]

    def post(self, request, borrower_id):
        borrower = Borrower.objects.filter(pk=borrower_id, lender=request.user.lender).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        data = validated(ser.GuarantorWriteSerializer, request.data)
        data.pop("id", None)
        with transaction.atomic():
            g = Guarantor.objects.create(borrower=borrower, **data)
            BorrowerHistoryEvent.objects.create(borrower=borrower, label="Guarantor added", detail=g.name)
            audit.record(request.user, "created", "guarantor", g.id, f"Guarantor {g.name} added for {borrower.full_name}")
        return Response(ser.GuarantorSerializer(g).data, status=status.HTTP_201_CREATED)


class BorrowerCollateralView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def post(self, request, borrower_id):
        lender = request.user.lender
        borrower = Borrower.objects.filter(pk=borrower_id, lender=lender).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        data = validated(ser.CollateralWriteSerializer, request.data)
        loan = None
        if data.get("loan_id"):
            loan = Loan.objects.filter(pk=data["loan_id"], lender=lender, borrower=borrower).first()
            if loan is None:
                raise NotFound("Loan not found for this borrower")
        with transaction.atomic():
            item = Collateral.objects.create(
                lender=lender, borrower=borrower, loan=loan,
                asset_type=data["asset_type"], description=data["description"],
                estimated_value=data["estimated_value"], owner_name=data.get("owner_name") or borrower.full_name,
                ownership_document=data.get("ownership_document") or "", valuation_date=data.get("valuation_date"),
                valued_by=data["valued_by"], existing_claims=data["existing_claims"], documents=data["documents"],
                status=Collateral.Status.ACTIVE if loan and loan.status == LoanStatus.ACTIVE else Collateral.Status.PLEDGED,
                created_by=request.user.name,
            )
            BorrowerHistoryEvent.objects.create(
                borrower=borrower, label="Collateral recorded",
                detail=f"{item.asset_type}: {item.description} ({float(item.estimated_value):,.0f})",
            )
            audit.record(request.user, "created", "collateral", item.id,
                         f"{item.asset_type} worth {float(item.estimated_value):,.0f} pledged by {borrower.full_name}")
        return Response(ser.CollateralSerializer(item).data, status=status.HTTP_201_CREATED)


class CollateralDetailView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def patch(self, request, collateral_id):
        lender = request.user.lender
        item = Collateral.objects.filter(pk=collateral_id, lender=lender).first()
        if item is None:
            raise NotFound("Collateral not found")
        data = validated(ser.CollateralUpdateSerializer, request.data)
        if "loan_id" in data and data["loan_id"] is not None:
            if not Loan.objects.filter(pk=data["loan_id"], lender=lender, borrower_id=item.borrower_id).exists():
                raise NotFound("Loan not found for this borrower")
        diff = audit.diff(item, data)
        for field, value in data.items():
            setattr(item, field, value)
        item.save()
        audit.record(request.user, "updated", "collateral", item.id, f"{item.asset_type} updated", changes=diff)
        return Response(ser.CollateralSerializer(item).data)


class BorrowerStatusView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def post(self, request, borrower_id):
        borrower = borrower_qs(request.user.lender).filter(pk=borrower_id).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        data = validated(ser.BorrowerStatusSerializer, request.data)
        new = data["status"]
        reason = data.get("reason") or ""
        if new == Borrower.Status.BLACKLISTED and not reason:
            raise UnprocessableEntity("A reason is required to blacklist a borrower")
        with transaction.atomic():
            borrower.status = new
            borrower.blacklisted = new == Borrower.Status.BLACKLISTED
            borrower.blacklist_reason = reason if borrower.blacklisted else None
            borrower.save(update_fields=["status", "blacklisted", "blacklist_reason"])
            BorrowerHistoryEvent.objects.create(
                borrower=borrower, label=f"Status set to {new}", detail=reason or "No reason recorded",
            )
            audit.record(request.user, "status", "borrower", borrower.id, f"{borrower.full_name} → {new}. {reason}".strip())
        return Response(ser.BorrowerSerializer(borrower_qs(request.user.lender).get(pk=borrower_id)).data)


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
            borrower.status = Borrower.Status.BLACKLISTED if data["blacklisted"] else Borrower.Status.ACTIVE
            borrower.save(update_fields=["blacklisted", "blacklist_reason", "status"])
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
        ProductFee(product=product, name=f["name"], kind=f["kind"], value=f["value"], timing=f["timing"],
                   fee_type=f.get("fee_type", "other"))
        for f in data.get("fees", [])
    )
    ApprovalLevel.objects.bulk_create(
        ApprovalLevel(
            product=product, min_amount=a["min_amount"], max_amount=a.get("max_amount"),
            required_role=a["required_role"], required_roles=a["required_roles"],
        )
        for a in data.get("approval_levels", [])
    )


class ProductEligibilityView(APIView):
    """GET /products/<id>/eligibility?borrowerId=&amount=&term=&groupId= — rule checks for the wizard."""

    def get(self, request, product_id):
        lender = request.user.lender
        product = product_qs(lender).filter(pk=product_id).first()
        borrower = Borrower.objects.filter(pk=request.query_params.get("borrowerId"), lender=lender).first()
        if product is None or borrower is None:
            raise NotFound("Product or borrower not found")
        group = BorrowerGroup.objects.filter(pk=request.query_params.get("groupId") or None, lender=lender).first() \
            if request.query_params.get("groupId") else None
        try:
            amount = float(request.query_params.get("amount") or product.min_amount)
            term = int(request.query_params.get("term") or product.min_term_instalments)
            income = float(request.query_params["income"]) if request.query_params.get("income") else None
        except ValueError:
            raise UnprocessableEntity("amount, term and income must be numbers")
        return Response(product_service.intake_checks(product, borrower, amount=amount, term=term, group=group, income=income))


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
        product.status = "active" if product.active else ("archived" if product.status == "archived" else "inactive")
        product.save(update_fields=["active", "status"])
        audit.record(request.user, "updated", "product", product.id, "Product active status toggled")
        return Response(ser.LoanProductSerializer(product_qs(request.user.lender).get(pk=product_id)).data)


# ----------------------------------------------------------------- applications
#
# Workflow: draft → submitted → under_assessment → pending_approval → approved
# (or declined) → disbursed. An approver can return an application to
# under_assessment for further review. Every move is an ApplicationEvent.

EDITABLE_STAGES = (ApplicationStatus.DRAFT, ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_ASSESSMENT)
ASSESSMENT_LABELS = {
    "recommended": "Recommended",
    "further_review": "Requires further review",
    "not_recommended": "Not recommended",
}


def application_qs(lender):
    return Application.objects.filter(lender=lender).prefetch_related(
        "approvals", "documents", "events", "group_members", "guarantors", "collateral",
    )


def _application_or_404(request, application_id):
    application = application_qs(request.user.lender).filter(pk=application_id).first()
    if application is None:
        raise NotFound("Application not found")
    return application


def _application_response(lender, application_id, code=status.HTTP_200_OK):
    return Response(ser.ApplicationSerializer(application_qs(lender).get(pk=application_id)).data, status=code)


def _app_event(application, stage, label, user=None, note=""):
    ApplicationEvent.objects.create(
        application=application, stage=stage, label=label, note=note or "", by=user.name if user else "",
    )


def _check_terms(product, amount, term):
    if not (float(product.min_amount) <= amount <= float(product.max_amount)):
        raise UnprocessableEntity("Amount is outside the product range")
    if not (product.min_term_instalments <= term <= product.max_term_instalments):
        raise UnprocessableEntity("Term is outside the product range")


def _check_group(lender, borrower, group_id):
    if group_id is None:
        return None
    group = BorrowerGroup.objects.filter(pk=group_id, lender=lender).first()
    if group is None:
        raise NotFound("Group not found")
    if not GroupMembership.objects.filter(group=group, borrower=borrower, active=True).exists():
        raise UnprocessableEntity("Borrower is not an active member of that group")
    return group


def _link_parties(application, data):
    """Attach the guarantors, collateral and (for group loans) members named in `data`."""
    borrower = application.borrower
    if "guarantor_ids" in data:
        ids = set(data["guarantor_ids"])
        found = list(Guarantor.objects.filter(pk__in=ids, borrower=borrower))
        if len(found) != len(ids):
            raise UnprocessableEntity("Guarantors must be recorded on the applicant's profile")
        application.guarantors.set(found)
    if "collateral_ids" in data:
        ids = set(data["collateral_ids"])
        found = list(
            Collateral.objects.filter(pk__in=ids, lender=application.lender, borrower=borrower)
            .exclude(status__in=[Collateral.Status.RELEASED, Collateral.Status.SEIZED])
        )
        if len(found) != len(ids):
            raise UnprocessableEntity("Collateral must belong to the applicant and not be released or seized")
        claimed = [c for c in found if c.loan_id is not None]
        if claimed:
            raise UnprocessableEntity(f"{claimed[0].asset_type} already secures another loan")
        application.collateral.set(found)
    if application.group_id is None:
        application.group_members.clear()
    elif "group_member_ids" in data or not application.group_members.exists():
        wanted = set(data.get("group_member_ids") or []) | {application.borrower_id}
        members = list(
            Borrower.objects.filter(
                pk__in=wanted, group_memberships__group_id=application.group_id, group_memberships__active=True,
            ).distinct()
        )
        if len(members) != len(wanted):
            raise UnprocessableEntity("Every member on a group application must be an active member of the group")
        application.group_members.set(members)


def _reassess(application):
    """Recompute the automatic checks and risk indicators from the current figures."""
    duplicates = Borrower.objects.filter(lender=application.lender, national_id=application.borrower.national_id).count()
    capacity = application_service.repayment_capacity(
        monthly_income=application.declared_income, other_income=application.other_income,
        business_income=application.business_income, business_expenses=application.business_expenses,
    )
    a = application_service.assess(
        product=application.product, borrower=application.borrower, amount=float(application.amount),
        term_instalments=application.term_instalments, declared_income=capacity["total_income"],
        declared_expenses=float(application.declared_expenses), has_duplicate_national_id=duplicates > 1,
        external_repayments=float(application.existing_repayments), dependents=application.dependents,
        application=application,
    )
    application.affordability_pass = a.affordability_pass
    application.duplicate_check_pass = a.duplicate_check_pass
    application.blacklist_check_pass = a.blacklist_check_pass
    application.score = a.score
    application.score_recommendation = a.score_recommendation
    application.required_approver_role = a.required_approver_role
    application.required_approvals = application_service.required_roles(application.product, float(application.requested_amount or application.amount))
    application.eligibility = product_service.intake_checks(
        application.product, application.borrower, amount=float(application.amount), term=application.term_instalments,
        group=application.group, income=capacity["total_income"], exclude_application=application,
    ) + product_service.security_checks(application.product, application)
    application.risk = a.risk
    application.needs_review = a.needs_review
    application.save()


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
        if borrower.status == Borrower.Status.SUSPENDED:
            raise UnprocessableEntity("Borrower is suspended")
        if Loan.objects.filter(borrower=borrower, status=LoanStatus.WRITTEN_OFF).exists():
            raise UnprocessableEntity("Borrower has an unresolved default (a written-off loan)")

        product = product_qs(lender).filter(pk=data["product_id"]).first()
        if product is None:
            raise NotFound("Loan product not found")
        if not product.active:
            raise UnprocessableEntity("Loan product is not active")
        group = _check_group(lender, borrower, data.get("group_id"))
        _check_terms(product, data["amount"], data["term_instalments"])
        income_total = application_service.repayment_capacity(
            monthly_income=data["declared_income"], other_income=data["other_income"],
            business_income=data["business_income"], business_expenses=data["business_expenses"],
        )["total_income"]
        intake = product_service.intake_checks(product, borrower, amount=data["amount"], term=data["term_instalments"],
                                               group=group, income=income_total)
        failing = product_service.failures(intake)
        if failing:
            raise UnprocessableEntity("Not eligible for this product — " + "; ".join(failing))

        officer = request.user
        if data.get("loan_officer_id"):
            officer = ensure_staff_member(lender, data["loan_officer_id"])
        application_date = data.get("application_date") or timezone.localdate()
        if not data.get("first_repayment_date"):
            data["first_repayment_date"] = product_service.first_repayment_date(product, application_date)
        if data.get("first_repayment_date") and data["first_repayment_date"] <= application_date:
            raise UnprocessableEntity("The first repayment date must be after the application date")
        existing_repayments = data.get("existing_repayments")
        if existing_repayments is None:
            existing_repayments = float(borrower.existing_loan_payments or 0)

        draft = data["draft"]
        with transaction.atomic():
            application = Application.objects.create(
                lender=lender,
                branch_id=data.get("branch_id") or borrower.branch_id,
                reference=application_service.next_reference(lender),
                borrower=borrower,
                product=product,
                group=group,
                amount=data["amount"],
                term_instalments=data["term_instalments"],
                requested_amount=data["amount"],
                requested_term=data["term_instalments"],
                purpose=data["purpose"],
                status=ApplicationStatus.DRAFT if draft else ApplicationStatus.SUBMITTED,
                declared_income=data["declared_income"],
                declared_expenses=data["declared_expenses"],
                credit_bureau_consent=data["credit_bureau_consent"],
                required_approver_role=StaffRole.BRANCH_MANAGER,
                created_by=request.user,
                loan_officer=officer,
                application_date=application_date,
                disbursement_method=data.get("disbursement_method") or "",
                first_repayment_date=data.get("first_repayment_date"),
                other_income=data["other_income"],
                business_income=data["business_income"],
                business_expenses=data["business_expenses"],
                existing_loans_count=data["existing_loans_count"],
                existing_repayments=existing_repayments,
                dependents=data["dependents"],
            )
            _link_parties(application, data)
            for doc in data["documents"]:
                if doc.get("name") and doc.get("type"):
                    ApplicationDocument.objects.create(
                        application=application, type=str(doc["type"])[:60], name=str(doc["name"])[:200],
                        uploaded_by=request.user.name,
                    )
            _reassess(application)
            _app_event(application, application.status, "Draft saved" if draft else "Application submitted", request.user)
            audit.record(
                request.user, "created", "application", application.id,
                f"Application {application.reference} {'drafted' if draft else 'submitted'} for {borrower.full_name}",
            )
        return _application_response(lender, application.pk, status.HTTP_201_CREATED)


class ApplicationDetailView(APIView):
    permission_classes = [IsAuthenticated, section_editor("applications")]

    def get(self, request, application_id):
        return Response(ser.ApplicationSerializer(_application_or_404(request, application_id)).data)

    def patch(self, request, application_id):
        application = _application_or_404(request, application_id)
        if application.status not in EDITABLE_STAGES:
            raise Conflict("The application can only be edited before it goes for approval")
        data = validated(ser.ApplicationUpdateSerializer, request.data)
        lender = request.user.lender

        if "product_id" in data:
            product = product_qs(lender).filter(pk=data["product_id"], active=True).first()
            if product is None:
                raise NotFound("Active loan product not found")
            application.product = product
        if "group_id" in data:
            application.group = _check_group(lender, application.borrower, data["group_id"])
        if "loan_officer_id" in data:
            application.loan_officer = ensure_staff_member(lender, data["loan_officer_id"]) if data["loan_officer_id"] else None
        if "amount" in data:
            application.requested_amount = data["amount"]
        if "term_instalments" in data:
            application.requested_term = data["term_instalments"]
        simple = [
            "amount", "term_instalments", "purpose", "declared_income", "declared_expenses", "credit_bureau_consent",
            "disbursement_method", "first_repayment_date", "other_income", "business_income", "business_expenses",
            "existing_loans_count", "existing_repayments", "dependents",
        ]
        changes = audit.diff(application, {k: data[k] for k in simple if k in data})
        for k in simple:
            if k in data:
                setattr(application, k, data[k])
        _check_terms(application.product, float(application.amount), application.term_instalments)
        if application.first_repayment_date and application.first_repayment_date <= application.application_date:
            raise UnprocessableEntity("The first repayment date must be after the application date")

        with transaction.atomic():
            application.save()
            _link_parties(application, data)
            _reassess(application)
            audit.record(request.user, "updated", "application", application.id,
                         f"Application {application.reference} updated", changes=changes)
        return _application_response(lender, application.pk)


class ApplicationSubmitView(APIView):
    """Draft → submitted."""

    permission_classes = [IsAuthenticated, section_editor("applications")]

    def post(self, request, application_id):
        application = _application_or_404(request, application_id)
        if application.status != ApplicationStatus.DRAFT:
            raise Conflict("Only a draft can be submitted")
        with transaction.atomic():
            application.status = ApplicationStatus.SUBMITTED
            application.save(update_fields=["status"])
            _app_event(application, application.status, "Application submitted", request.user)
            audit.record(request.user, "submitted", "application", application.id,
                         f"Application {application.reference} submitted")
        return _application_response(request.user.lender, application.pk)


class ApplicationStartAssessmentView(APIView):
    """Submitted → under assessment: a loan officer picks the application up."""

    permission_classes = [IsAuthenticated, section_editor("applications")]

    def post(self, request, application_id):
        application = _application_or_404(request, application_id)
        if application.status != ApplicationStatus.SUBMITTED:
            raise Conflict("Only a submitted application can be taken for assessment")
        with transaction.atomic():
            application.status = ApplicationStatus.UNDER_ASSESSMENT
            application.save(update_fields=["status"])
            _app_event(application, application.status, "Assessment started", request.user)
        return _application_response(request.user.lender, application.pk)


class ApplicationAssessmentView(APIView):
    """The loan officer's assessment. With `forward`, it goes to the approver."""

    permission_classes = [IsAuthenticated, section_editor("applications")]

    def post(self, request, application_id):
        application = _application_or_404(request, application_id)
        if application.status not in (ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_ASSESSMENT):
            raise Conflict("This application is not open for assessment")
        data = validated(ser.ApplicationAssessmentSerializer, request.data)
        if data["assessed_amount"] > float(application.requested_amount or application.amount):
            raise UnprocessableEntity("The assessed amount can't exceed the requested amount")
        _check_terms(application.product, data["assessed_amount"], data["recommended_term"])
        forward = data["forward"]
        if forward and data["result"] == "further_review":
            raise UnprocessableEntity("Resolve the further review before forwarding for approval")
        if forward and data["result"] == "recommended":
            missing = product_service.failures(product_service.security_checks(application.product, application))
            if missing:
                raise UnprocessableEntity("The product's security requirements aren't met — " + "; ".join(missing))

        label = ASSESSMENT_LABELS[data["result"]]
        with transaction.atomic():
            application.assessment_result = data["result"]
            application.assessed_amount = data["assessed_amount"]
            application.recommended_term = data["recommended_term"]
            application.assessment_notes = data["notes"]
            application.assessed_by = request.user
            application.assessed_at = timezone.now()
            application.status = ApplicationStatus.PENDING_APPROVAL if forward else ApplicationStatus.UNDER_ASSESSMENT
            application.save()
            _reassess(application)
            _app_event(
                application, application.status,
                f"Assessed: {label}" + (" — forwarded for approval" if forward else ""),
                request.user, data["notes"],
            )
            audit.record(request.user, "assessed", "application", application.id,
                         f"Application {application.reference} assessed: {label}")
        return _application_response(request.user.lender, application.pk)


class ApplicationDecisionView(APIView):
    permission_classes = [IsAuthenticated, section_editor("applications")]

    def post(self, request, application_id):
        application = _application_or_404(request, application_id)
        data = validated(ser.ApplicationDecisionSerializer, request.data)

        if application.status != ApplicationStatus.PENDING_APPROVAL:
            raise Conflict("This application is not awaiting an approval decision")
        if application.created_by_id == request.user.id:
            raise PermissionDenied("You created this application — a different approver must decide it")
        if application.assessed_by_id == request.user.id:
            raise PermissionDenied("You assessed this application — a different approver must decide it")
        decision = data["decision"]
        # approvals already given in this round (since the application was last returned)
        rounds = list(application.approvals.all())
        last_return = max((i for i, d in enumerate(rounds) if d.decision == "returned"), default=-1)
        given = [d for d in rounds[last_return + 1:] if d.decision == "approved"]
        required = list(application.required_approvals or [application.required_approver_role])
        remaining = list(required)
        for d in given:
            match = next((r for r in remaining if can_approve_application(d.role, r)), None)
            if match:
                remaining.remove(match)
        if any(d.approver_id == request.user.id for d in given):
            raise PermissionDenied("You have already approved this application — another approver must sign")
        satisfies = next((r for r in remaining if can_approve_application(request.user.role, r)), None)
        if satisfies is None:
            roles = ", ".join(r.replace("_", " ") for r in remaining) or application.required_approver_role
            raise PermissionDenied(f"This application needs approval from: {roles}")
        final_approval = decision == "approved" and len(remaining) == 1
        amount = float(application.amount)
        term = application.term_instalments
        if decision == "approved":
            amount = data.get("approved_amount") or float(application.assessed_amount or application.amount)
            term = data.get("approved_term") or application.recommended_term or application.term_instalments
            if amount > float(application.requested_amount or application.amount):
                raise UnprocessableEntity("The approved amount can't exceed the requested amount")
            _check_terms(application.product, amount, term)
        if (
            request.user.approval_limit > 0
            and amount > request.user.approval_limit
            and request.user.role != StaffRole.LENDER_ADMIN
        ):
            raise PermissionDenied(
                f"Your approval limit ({request.user.approval_limit:,.0f}) is below this application amount ({amount:,.0f})"
            )
        if decision != "approved" and not data["comment"].strip():
            raise UnprocessableEntity("Give a reason when declining or returning an application")

        with transaction.atomic():
            if decision == "approved" and not final_approval:
                ApprovalDecision.objects.create(
                    application=application, approver=request.user, approver_name=request.user.name,
                    role=request.user.role, decision=decision, comment=data["comment"],
                )
                done = len(required) - len(remaining) + 1
                _app_event(application, application.status,
                           f"Approved by {request.user.name} ({done} of {len(required)})", request.user, data["comment"])
                audit.record(request.user, "approved", "application", application.id,
                             f"Partial approval {done}/{len(required)} by {request.user.name}")
                return _application_response(request.user.lender, application.pk)
            if decision == "approved":
                application.status = ApplicationStatus.APPROVED
                application.amount = amount
                application.term_instalments = term
                application.decline_reason = None
                label = f"Approved — {amount:,.0f} over {term} instalments"
            elif decision == "declined":
                application.status = ApplicationStatus.DECLINED
                application.decline_reason = data["comment"]
                label = "Declined"
            else:
                application.status = ApplicationStatus.UNDER_ASSESSMENT
                label = "Returned for further review"
            application.save(update_fields=["status", "amount", "term_instalments", "decline_reason"])
            ApprovalDecision.objects.create(
                application=application,
                approver=request.user,
                approver_name=request.user.name,
                role=request.user.role,
                decision=decision,
                comment=data["comment"],
            )
            _app_event(application, application.status, label, request.user, data["comment"])
            audit.record(
                request.user, decision, "application", application.id,
                data["comment"] or f"Application {decision} by {request.user.name}",
            )
        if decision != "returned":
            notify.decision(request.user.lender, application.borrower, application)
        return _application_response(request.user.lender, application.pk)


class ApplicationDocumentsView(APIView):
    permission_classes = [IsAuthenticated, section_editor("applications")]

    def post(self, request, application_id):
        application = _application_or_404(request, application_id)
        if application.status in (ApplicationStatus.DECLINED, ApplicationStatus.DISBURSED):
            raise Conflict("This application is closed")
        data = validated(ser.ApplicationDocumentWriteSerializer, request.data)
        doc = ApplicationDocument.objects.create(
            application=application, type=data["type"], name=data["name"], uploaded_by=request.user.name,
        )
        audit.record(request.user, "uploaded", "application", application.id, f"{doc.type}: {doc.name}")
        return _application_response(request.user.lender, application.pk, status.HTTP_201_CREATED)


class ApplicationDocumentDetailView(APIView):
    permission_classes = [IsAuthenticated, section_editor("applications")]

    def patch(self, request, application_id, document_id):
        application = _application_or_404(request, application_id)
        doc = application.documents.filter(pk=document_id).first()
        if doc is None:
            raise NotFound("Document not found")
        data = validated(ser.ApplicationDocumentVerifySerializer, request.data)
        doc.status = data["status"]
        doc.note = data["note"]
        doc.verified_by = request.user.name if data["status"] != "pending" else ""
        doc.verified_at = timezone.now() if data["status"] != "pending" else None
        doc.save()
        audit.record(request.user, "verified", "application", application.id, f"{doc.type} marked {doc.status}")
        return _application_response(request.user.lender, application.pk)


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
        if not loan.product.early_repayment_allowed:
            raise Conflict("This product does not allow early repayment")
        channel = request.data.get("channel", "cash")
        if channel not in {c for c, _ in RepaymentChannel.choices}:
            channel = "cash"
        with transaction.atomic():
            repayment = _repayment_call(
                repayment_service.record, request.user, loan, amount=amount, channel=channel,
                reference=request.data.get("reference", ""), notes="Early settlement",
            )
            loan.refresh_from_db()
            if loan.status != LoanStatus.ACTIVE:
                loan.closure_reason = "Early settlement"
                loan.save(update_fields=["closure_reason"])
            audit.record(
                request.user, "settled", "loan", loan.id,
                f"Early settlement of {amount:,.0f}, receipt {repayment.receipt_number}",
            )
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
            borrower.status = Borrower.Status.BLACKLISTED
            borrower.save(update_fields=["blacklisted", "blacklist_reason", "status"])
            BorrowerHistoryEvent.objects.create(
                borrower=borrower, label="Loan written off",
                detail=f"{loan.outstanding_balance:,.0f} written off — {reason}",
            )
            audit.record(request.user, "written_off", "loan", loan.id,
                         f"{loan.outstanding_balance:,.0f} written off: {reason}")
        return Response(ser.LoanSerializer(Loan.objects.prefetch_related("schedule").get(pk=loan.pk)).data)


# -------------------------------------------------------------------- repayments

def repayment_qs(lender):
    return Repayment.objects.filter(lender=lender).select_related("received_by").prefetch_related("corrections")


def _repayment_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except repayment_service.RepaymentError as exc:
        if exc.status == 409:
            raise Conflict(str(exc))
        raise UnprocessableEntity(str(exc))


class RepaymentsView(APIView):
    permission_classes = [IsAuthenticated, section_editor("repayments")]

    def get(self, request):
        return Response(ser.RepaymentSerializer(repayment_qs(request.user.lender), many=True).data)

    def post(self, request):
        data = validated(ser.RepaymentCreateSerializer, request.data)
        lender = request.user.lender
        loan = Loan.objects.filter(pk=data["loan_id"], lender=lender).prefetch_related("schedule").first()
        if loan is None:
            raise NotFound("Loan not found")
        received_by = ensure_staff_member(lender, data.get("received_by_id")) if data.get("received_by_id") else None
        if data.get("branch_id"):
            ensure_branch(lender, data["branch_id"])
        activity = None
        if data.get("collection_activity_id"):
            activity = CollectionActivity.objects.filter(pk=data["collection_activity_id"], loan=loan).first()
            if activity is None:
                raise NotFound("Collection activity not found for this loan")
        repayment = _repayment_call(
            repayment_service.record, request.user, loan, amount=data["amount"], channel=data["channel"],
            payment_date=data.get("payment_date"), reference=data["reference"], received_by=received_by,
            branch_id=data.get("branch_id"), collection_point=data["collection_point"], notes=data["notes"],
            collection_activity=activity,
        )
        return Response(ser.RepaymentSerializer(repayment_qs(lender).get(pk=repayment.pk)).data, status=status.HTTP_201_CREATED)


class RepaymentReverseView(APIView):
    permission_classes = [IsAuthenticated, section_editor("repayments"), IsSupervisor]

    def post(self, request, repayment_id):
        lender = request.user.lender
        repayment = Repayment.objects.filter(pk=repayment_id, lender=lender).select_related("received_by").first()
        if repayment is None:
            raise NotFound("Repayment not found")
        data = validated(ser.RepaymentReverseSerializer, request.data)
        original, corrected = _repayment_call(
            repayment_service.reverse, request.user, repayment, reason=data["reason"], corrected=data.get("corrected"),
        )
        body = ser.RepaymentSerializer(repayment_qs(lender).get(pk=original.pk)).data
        if corrected is not None:
            body = {**body, "corrected": ser.RepaymentSerializer(repayment_qs(lender).get(pk=corrected.pk)).data}
        return Response(body)


class GroupPaymentsView(APIView):
    permission_classes = [IsAuthenticated, section_editor("repayments")]

    def _group(self, request, group_id):
        group = BorrowerGroup.objects.filter(pk=group_id, lender=request.user.lender).first()
        if group is None:
            raise NotFound("Group not found")
        return group

    def get(self, request, group_id):
        group = self._group(request, group_id)
        rows = group.payments.prefetch_related("repayments")
        return Response(ser.GroupPaymentSerializer(rows, many=True).data)

    def post(self, request, group_id):
        group = self._group(request, group_id)
        data = validated(ser.GroupPaymentCreateSerializer, request.data)
        gp = _repayment_call(
            repayment_service.record_group_payment, request.user, group, channel=data["channel"],
            payment_date=data.get("payment_date"), reference=data["reference"],
            collection_point=data["collection_point"], notes=data["notes"],
            contributions=[{"loan_id": c["loan_id"], "amount": c["amount"]} for c in data["contributions"]],
        )
        return Response(ser.GroupPaymentSerializer(gp).data, status=status.HTTP_201_CREATED)


class ReconciliationView(APIView):
    """Statement lines and the reconciliation position for one money source."""

    permission_classes = [IsAuthenticated, section_editor("repayments")]

    def get(self, request):
        source = request.query_params.get("source", "bank")
        lender = request.user.lender
        lines = StatementLine.objects.filter(lender=lender, source=source)[:500]
        return Response({
            "summary": repayment_service.summary(lender, source),
            "lines": ser.StatementLineSerializer(lines, many=True).data,
        })


class StatementImportView(APIView):
    permission_classes = [IsAuthenticated, section_editor("repayments")]

    def post(self, request):
        data = validated(ser.StatementImportSerializer, request.data)
        result = _repayment_call(repayment_service.import_statement, request.user, request.user.lender,
                                 source=data["source"], lines=data["lines"])
        return Response(result, status=status.HTTP_201_CREATED)


class StatementRematchView(APIView):
    permission_classes = [IsAuthenticated, section_editor("repayments")]

    def post(self, request):
        source = request.data.get("source", "bank")
        return Response({"matched": repayment_service.rematch(request.user, request.user.lender, source)})


class StatementLineActionView(APIView):
    """POST /reconciliation/lines/<id>/<match|ignore|unmatch>."""

    permission_classes = [IsAuthenticated, section_editor("repayments")]

    def post(self, request, line_id, action):
        lender = request.user.lender
        line = StatementLine.objects.filter(pk=line_id, lender=lender).first()
        if line is None:
            raise NotFound("Statement line not found")
        data = validated(ser.StatementActionSerializer, request.data)
        if action == "match":
            repayment = Repayment.objects.filter(pk=data.get("repayment_id"), lender=lender).first()
            if repayment is None:
                raise NotFound("Repayment not found")
            _repayment_call(repayment_service.match, request.user, line, repayment)
        elif action == "ignore":
            _repayment_call(repayment_service.ignore, request.user, line, data["note"])
        elif action == "unmatch":
            _repayment_call(repayment_service.unmatch, request.user, line)
        else:
            raise NotFound("Unknown action")
        line.refresh_from_db()
        return Response(ser.StatementLineSerializer(line).data)


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
        case_service.sync(lender)
        case = CollectionCase.objects.filter(loan=loan).exclude(status__in=case_service.CLOSED).first()
        payment = data.pop("payment", None)
        with transaction.atomic():
            activity = CollectionActivity.objects.create(
                lender=lender, loan=loan, borrower=loan.borrower, case=case,
                kind=data["kind"], outcome=data.get("outcome") or "", note=data.get("note") or "",
                promised_amount=data.get("promised_amount"), promised_date=data.get("promised_date"),
                reason=data["reason"], next_follow_up=data.get("next_follow_up"), next_action=data["next_action"],
                location=data["location"], purpose=data["purpose"],
                amount_collected=(payment or {}).get("amount") or data.get("amount_collected"),
                visit_date=data.get("visit_date") or (timezone.localdate() if data["kind"] == "visit" else None),
                visit_status=data["visit_status"] if data["kind"] == "visit" else "",
                attachments=data["attachments"], created_by=request.user.name,
            )
            if payment:
                loan = Loan.objects.prefetch_related("schedule").get(pk=loan.pk)
                _repayment_call(
                    repayment_service.record, request.user, loan, amount=float(payment["amount"]),
                    channel=payment.get("channel") or "field", reference=payment.get("reference", ""),
                    collection_point=data["location"] or ("Field visit" if data["kind"] == "visit" else "Collections"),
                    notes=f"Collected during {data['kind']}", collection_activity=activity,
                )
                if activity.outcome == "":
                    activity.outcome = "paid"
                    activity.save(update_fields=["outcome"])
            case_service.apply_activity(case, activity, request.user)
            label = {"promise": "Promise to pay", "visit": "Field visit", "escalation": "Escalation"}.get(data["kind"], data["kind"].title())
            audit.record(request.user, "logged", "collection_activity", activity.id, f"{label} on {loan.borrower.full_name}'s loan")
        if payment:
            case_service.sync(lender)
        _attach_promise_status([activity], lender)
        return Response(ser.CollectionActivitySerializer(activity).data, status=status.HTTP_201_CREATED)


def collection_case_qs(lender):
    return CollectionCase.objects.filter(lender=lender).select_related(
        "loan", "loan__borrower", "loan__group", "assigned_to",
    ).prefetch_related("loan__schedule")


class CollectionCasesView(APIView):
    permission_classes = [IsAuthenticated, has_section("collections")]

    def get(self, request):
        case_service.sync(request.user.lender)
        return Response(ser.CollectionCaseSerializer(collection_case_qs(request.user.lender), many=True).data)


class CollectionCaseDetailView(APIView):
    permission_classes = [IsAuthenticated, section_editor("collections")]

    def get(self, request, case_id):
        c = collection_case_qs(request.user.lender).filter(pk=case_id).first()
        if c is None:
            raise NotFound("Case not found")
        return Response(ser.CollectionCaseSerializer(c).data)

    def patch(self, request, case_id):
        lender = request.user.lender
        c = collection_case_qs(lender).filter(pk=case_id).first()
        if c is None:
            raise NotFound("Case not found")
        data = validated(ser.CollectionCaseUpdateSerializer, request.data)
        if ("assigned_to_id" in data or "status" in data or "stage" in data) and not is_supervisor(request.user.role):
            raise PermissionDenied("Only a manager can assign cases or change their status")
        if "stage" in data and data["stage"] not in case_service.stages_for(lender):
            raise UnprocessableEntity("Unknown collection stage")
        if "assigned_to_id" in data:
            data["assigned_to"] = ensure_staff_member(lender, data.pop("assigned_to_id"))
        with transaction.atomic():
            case_service.update(c, request.user, data)
            audit.record(request.user, "updated", "collection_case", c.id, f"{c.number} updated")
        return Response(ser.CollectionCaseSerializer(collection_case_qs(lender).get(pk=c.pk)).data)


class CollectionCasesAssignView(APIView):
    permission_classes = [IsAuthenticated, section_editor("collections"), IsSupervisor]

    def post(self, request):
        lender = request.user.lender
        data = validated(ser.CollectionCaseAssignSerializer, request.data)
        officer = ensure_staff_member(lender, data["staff_id"])
        cases = list(CollectionCase.objects.filter(lender=lender, pk__in=data["case_ids"]))
        with transaction.atomic():
            for c in cases:
                case_service.update(c, request.user, {"assigned_to": officer})
            audit.record(request.user, "assigned", "collection_case", None, f"{len(cases)} case(s) assigned to {officer.name}")
        return Response({"assigned": len(cases)})


class CollectionDashboardView(APIView):
    permission_classes = [IsAuthenticated, has_section("collections")]

    def get(self, request):
        return Response(case_service.dashboard(request.user.lender, request.user))


class LoanCollectionTimelineView(APIView):
    def get(self, request, loan_id):
        loan = Loan.objects.filter(pk=loan_id, lender=request.user.lender).prefetch_related("schedule").first()
        if loan is None:
            raise NotFound("Loan not found")
        return Response(case_service.timeline(loan))


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


# ---------------------------------------------------------------------- groups

def group_qs(lender):
    return BorrowerGroup.objects.filter(lender=lender).prefetch_related(
        "memberships__borrower", "documents", "history", "meetings__attendance",
    )


def _group_event(group, label, detail="", by=""):
    GroupHistoryEvent.objects.create(group=group, label=label, detail=detail, by=by)


def _next_group_number(lender) -> str:
    n = BorrowerGroup.objects.filter(lender=lender).count() + 1
    while BorrowerGroup.objects.filter(lender=lender, group_number=f"GRP-{n:04d}").exists():
        n += 1
    return f"GRP-{n:04d}"


def _add_member(group, borrower, role, by):
    """Create (or re-activate) a membership with a stable membership number."""
    existing = GroupMembership.objects.filter(group=group, borrower=borrower).first()
    if existing:
        if existing.status == GroupMembership.Status.ACTIVE:
            raise Conflict(f"{borrower.full_name} is already in this group")
        existing.status, existing.active, existing.left_on, existing.role = "active", True, None, role
        existing.save(update_fields=["status", "active", "left_on", "role"])
        _group_event(group, "Member rejoined", f"{borrower.full_name} ({existing.membership_number})", by)
        return existing
    seq = GroupMembership.objects.filter(group=group).count() + 1
    m = GroupMembership.objects.create(
        group=group, borrower=borrower, role=role,
        membership_number=f"{group.group_number or 'GRP'}-{seq:02d}",
    )
    _group_event(group, "Member joined", f"{borrower.full_name} as {role} ({m.membership_number})", by)
    return m


def _one_leader_per_role(group, membership):
    """A group has one chair, one secretary and one treasurer."""
    if membership.role != GroupMembership.Role.MEMBER:
        GroupMembership.objects.filter(group=group, role=membership.role).exclude(pk=membership.pk) \
            .update(role=GroupMembership.Role.MEMBER)


class GroupsView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def get(self, request):
        return Response(ser.BorrowerGroupSerializer(group_qs(request.user.lender), many=True).data)

    def post(self, request):
        lender = request.user.lender
        data = validated(ser.BorrowerGroupWriteSerializer, request.data)
        ensure_branch(lender, data["branch_id"])
        ensure_staff_member(lender, data["officer_id"])
        members = data.pop("members", [])
        documents = data.pop("documents", [])
        if not data.get("formed_on"):
            data["formed_on"] = timezone.now().date()
        with transaction.atomic():
            group = BorrowerGroup.objects.create(
                lender=lender, group_number=_next_group_number(lender),
                active=data.get("status", "active") == "active", **data,
            )
            _group_event(group, "Group formed", f"{group.name} ({group.group_number})", request.user.name)
            for item in members:
                borrower = Borrower.objects.filter(pk=item["borrower_id"], lender=lender).first()
                if borrower is None:
                    raise NotFound("Borrower not found")
                m = _add_member(group, borrower, item.get("role", "member"), request.user.name)
                _one_leader_per_role(group, m)
            for d in documents:
                if d.get("name"):
                    GroupDocument.objects.create(group=group, name=d["name"], type=d.get("type") or "Other")
            audit.record(request.user, "created", "group", group.id,
                         f'Group "{group.name}" ({group.group_number}) formed with {len(members)} member(s)')
        return Response(ser.BorrowerGroupSerializer(group_qs(lender).get(pk=group.pk)).data, status=status.HTTP_201_CREATED)


class GroupDetailView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def get(self, request, group_id):
        group = group_qs(request.user.lender).filter(pk=group_id).first()
        if group is None:
            raise NotFound("Group not found")
        return Response(ser.BorrowerGroupSerializer(group).data)

    def patch(self, request, group_id):
        lender = request.user.lender
        group = BorrowerGroup.objects.filter(pk=group_id, lender=lender).first()
        if group is None:
            raise NotFound("Group not found")
        data = validated(ser.BorrowerGroupUpdateSerializer, request.data)
        if "active" in data and "status" not in data:
            data["status"] = "active" if data.pop("active") else "suspended"
        data.pop("active", None)
        if "branch_id" in data:
            ensure_branch(lender, data["branch_id"])
        if "officer_id" in data:
            ensure_staff_member(lender, data["officer_id"])
        diff = audit.diff(group, data)
        for field, value in data.items():
            setattr(group, field, value)
        group.active = group.status == BorrowerGroup.Status.ACTIVE
        group.save()
        if diff:
            if "status" in diff:
                _group_event(group, f"Status set to {group.status}", "", request.user.name)
            else:
                _group_event(group, "Details updated", ", ".join(k.replace("_", " ") for k in diff), request.user.name)
            audit.record(request.user, "updated", "group", group.id, f"Group {group.name} updated", changes=diff)
        return Response(ser.BorrowerGroupSerializer(group_qs(lender).get(pk=group.pk)).data)


class GroupMembersView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def post(self, request, group_id):
        lender = request.user.lender
        group = BorrowerGroup.objects.filter(pk=group_id, lender=lender).first()
        if group is None:
            raise NotFound("Group not found")
        data = validated(ser.GroupMemberAddSerializer, request.data)
        borrower = Borrower.objects.filter(pk=data["borrower_id"], lender=lender).first()
        if borrower is None:
            raise NotFound("Borrower not found")
        with transaction.atomic():
            m = _add_member(group, borrower, data["role"], request.user.name)
            _one_leader_per_role(group, m)
            audit.record(request.user, "added", "group_member", group.id, f"{borrower.full_name} joined {group.name}")
        return Response(ser.BorrowerGroupSerializer(group_qs(lender).get(pk=group.pk)).data, status=status.HTTP_201_CREATED)


class GroupMemberDetailView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def _get(self, request, group_id, membership_id):
        m = GroupMembership.objects.filter(pk=membership_id, group__pk=group_id, group__lender=request.user.lender) \
            .select_related("borrower", "group").first()
        if m is None:
            raise NotFound("Membership not found")
        return m

    def patch(self, request, group_id, membership_id):
        m = self._get(request, group_id, membership_id)
        data = validated(ser.GroupMemberUpdateSerializer, request.data)
        with transaction.atomic():
            if "role" in data and data["role"] != m.role:
                m.role = data["role"]
                _one_leader_per_role(m.group, m)
                _group_event(m.group, "Role changed", f"{m.borrower.full_name} is now {m.role}", request.user.name)
            if "status" in data and data["status"] != m.status:
                m.status = data["status"]
                m.left_on = timezone.now().date() if m.status == "left" else None
                if m.status == "left":
                    m.role = GroupMembership.Role.MEMBER
                _group_event(m.group, f"Member {m.status}", m.borrower.full_name, request.user.name)
            m.active = m.status == GroupMembership.Status.ACTIVE
            m.save()
            audit.record(request.user, "updated", "group_member", m.group_id, f"{m.borrower.full_name}: {m.role}, {m.status}")
        return Response(ser.BorrowerGroupSerializer(group_qs(request.user.lender).get(pk=group_id)).data)

    def delete(self, request, group_id, membership_id):
        """Removing a member marks them as having left — their history stays."""
        m = self._get(request, group_id, membership_id)
        with transaction.atomic():
            m.status, m.active, m.left_on, m.role = "left", False, timezone.now().date(), "member"
            m.save(update_fields=["status", "active", "left_on", "role"])
            _group_event(m.group, "Member left", m.borrower.full_name, request.user.name)
            audit.record(request.user, "removed", "group_member", group_id, f"{m.borrower.full_name} left the group")
        return Response(ser.BorrowerGroupSerializer(group_qs(request.user.lender).get(pk=group_id)).data)


class GroupMeetingsView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def post(self, request, group_id):
        lender = request.user.lender
        group = BorrowerGroup.objects.filter(pk=group_id, lender=lender).first()
        if group is None:
            raise NotFound("Group not found")
        data = validated(ser.GroupMeetingWriteSerializer, request.data)
        member_ids = set(GroupMembership.objects.filter(group=group).values_list("id", flat=True))
        with transaction.atomic():
            meeting = GroupMeeting.objects.create(
                group=group, date=data["date"], location=data.get("location") or group.meeting_location,
                notes=data.get("notes") or "", recorded_by=request.user.name,
            )
            total = 0.0
            for row in data.get("attendance", []):
                if row["membership_id"] not in member_ids:
                    raise UnprocessableEntity("Attendance lists someone who is not a member of this group")
                contribution = float(row.get("contribution") or 0) if row.get("present", True) else 0.0
                total += contribution
                GroupAttendance.objects.create(
                    meeting=meeting, membership_id=row["membership_id"],
                    present=row.get("present", True), contribution=contribution,
                )
            meeting.collection_amount = total
            meeting.save(update_fields=["collection_amount"])
            present = sum(1 for r in data.get("attendance", []) if r.get("present", True))
            _group_event(group, "Meeting held",
                         f"{meeting.date:%d %b %Y}: {present}/{len(data.get('attendance', []))} present, collected {total:,.0f}",
                         request.user.name)
            audit.record(request.user, "recorded", "group_meeting", meeting.id,
                         f"{group.name} meeting on {meeting.date}: collected {total:,.0f}")
        return Response(ser.BorrowerGroupSerializer(group_qs(lender).get(pk=group.pk)).data, status=status.HTTP_201_CREATED)


class GroupDocumentsView(APIView):
    permission_classes = [IsAuthenticated, section_editor("borrowers")]

    def post(self, request, group_id):
        group = BorrowerGroup.objects.filter(pk=group_id, lender=request.user.lender).first()
        if group is None:
            raise NotFound("Group not found")
        data = validated(ser.GroupDocumentWriteSerializer, request.data)
        GroupDocument.objects.create(group=group, name=data["name"], type=data["type"])
        _group_event(group, "Document added", f"{data['name']} ({data['type']})", request.user.name)
        return Response(ser.BorrowerGroupSerializer(group_qs(request.user.lender).get(pk=group.pk)).data,
                        status=status.HTTP_201_CREATED)


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
            repayment_service.reconcile_till(request.user.lender, request.user.name, business_date, rec.id)
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


# ------------------------------------------------------------------ sms messaging

def _message_context(lender, borrower) -> dict:
    """Values for {placeholders} in a message, from the borrower's active loan."""
    loan = (
        Loan.objects.filter(borrower=borrower, status=LoanStatus.ACTIVE)
        .prefetch_related("schedule").order_by("-days_in_arrears").first()
    )
    amount_due, due_date, outstanding = 0.0, "", 0.0
    if loan:
        outstanding = float(loan.outstanding_balance)
        nxt = next((i for i in loan.schedule.all() if i.status != "paid"), None)
        if loan.days_in_arrears > 0:
            amount_due = float(loan.arrears_amount)
        elif nxt is not None:
            amount_due = float(nxt.total_due) - float(nxt.paid_amount)
        if nxt is not None:
            due_date = f"{nxt.due_date:%d %b %Y}"

    def money(v):
        return f"{lender.currency} {round(v):,}"

    return {
        "name": borrower.full_name,
        "first_name": borrower.full_name.split()[0] if borrower.full_name else "",
        "customer_number": borrower.customer_number,
        "amount_due": money(amount_due),
        "due_date": due_date or "-",
        "outstanding": money(outstanding),
        "lender": lender.name,
    }


def _render(template: str, ctx: dict) -> str:
    out = template
    for k, v in ctx.items():
        out = out.replace("{" + k + "}", str(v))
    return out


def _audience(lender, data) -> list:
    qs = Borrower.objects.filter(lender=lender).exclude(status=Borrower.Status.BLACKLISTED)
    if data.get("branch_id"):
        qs = qs.filter(branch_id=data["branch_id"])
    aud = data["audience"]
    if aud == "custom":
        qs = qs.filter(pk__in=data.get("borrower_ids") or [])
    elif aud == "group":
        qs = qs.filter(group_memberships__group_id=data.get("group_id"), group_memberships__active=True)
    elif aud == "active_loans":
        qs = qs.filter(loans__status=LoanStatus.ACTIVE)
    elif aud == "overdue":
        qs = qs.filter(loans__status=LoanStatus.ACTIVE, loans__days_in_arrears__gt=0)
    elif aud == "due_soon":
        today = timezone.localdate()
        horizon = today + timedelta(days=data.get("due_within_days", 3))
        qs = qs.filter(
            loans__status=LoanStatus.ACTIVE, loans__days_in_arrears=0,
            loans__schedule__due_date__gte=today, loans__schedule__due_date__lte=horizon,
            loans__schedule__status__in=["upcoming", "due", "partial"],
        )
    else:  # all
        qs = qs.filter(status=Borrower.Status.ACTIVE)
    return list(qs.distinct())


class SmsSendView(APIView):
    """Send one SMS — to a borrower (placeholders filled from their loan) or any number."""

    permission_classes = [IsAuthenticated, section_editor("collections")]

    def post(self, request):
        lender = request.user.lender
        data = validated(ser.SmsSendSerializer, request.data)
        borrower = None
        if data.get("borrower_id"):
            borrower = Borrower.objects.filter(pk=data["borrower_id"], lender=lender).first()
            if borrower is None:
                raise NotFound("Borrower not found")
        body = _render(data["message"], _message_context(lender, borrower)) if borrower else data["message"]
        to = data.get("to") or (borrower.phone if borrower else "")
        n = notify.send(lender, to=to, kind="manual", body=body, borrower=borrower, sent_by=request.user.name)
        audit.record(request.user, "sms", "notification", n.id, f"SMS to {to}: {n.status}")
        return Response(ser.NotificationSerializer(n).data, status=status.HTTP_201_CREATED)


class SmsBulkView(APIView):
    """Send the same (personalised) SMS to an audience. dryRun previews it."""

    permission_classes = [IsAuthenticated, section_editor("collections")]

    def post(self, request):
        import uuid as _uuid

        from lms.integrations import sms as sms_integration

        lender = request.user.lender
        data = validated(ser.SmsBulkSerializer, request.data)
        recipients = _audience(lender, data)
        rendered = [(b, _render(data["message"], _message_context(lender, b))) for b in recipients]
        segments = sum(sms_integration.segments(body) for _, body in rendered)

        if data["dry_run"]:
            return Response({
                "recipients": len(rendered),
                "segments": segments,
                "credits_available": lender.sms_balance,
                "sample": [{"borrower_id": str(b.id), "name": b.full_name, "phone": b.phone, "body": body}
                           for b, body in rendered[:5]],
            })
        if not rendered:
            raise UnprocessableEntity("No borrowers match this audience")
        if segments > lender.sms_balance:
            raise UnprocessableEntity(f"This send needs {segments} SMS credits - only {lender.sms_balance} left")

        batch = f"BULK-{_uuid.uuid4().hex[:8].upper()}"
        sent = failed = 0
        for b, body in rendered:
            n = notify.send(lender, to=b.phone, kind="bulk", body=body, borrower=b,
                            sent_by=request.user.name, batch=batch)
            lender.refresh_from_db(fields=["sms_balance"])
            if n.status == "sent":
                sent += 1
            else:
                failed += 1
        audit.record(request.user, "sms_bulk", "notification", batch,
                     f"Bulk SMS ({data['audience']}) to {len(rendered)} borrowers: {sent} sent, {failed} failed")
        return Response({"batch": batch, "recipients": len(rendered), "sent": sent, "failed": failed},
                        status=status.HTTP_201_CREATED)


# ------------------------------------------------------------------ online payments

class IntegrationsView(APIView):
    def get(self, request):
        from lms.integrations import payments as pay_integration
        from lms.integrations import sms as sms_integration

        s, p = sms_integration.get_provider(), pay_integration.get_provider()
        return Response({
            "sms": {"provider": s.name, "simulated": s.simulated},
            "payments": {"provider": p.name, "simulated": p.simulated, "networks": gateway_service.NETWORKS},
        })


class PaymentsView(APIView):
    permission_classes = [IsAuthenticated, has_section("repayments")]

    def get(self, request):
        rows = PaymentTransaction.objects.filter(lender=request.user.lender).select_related("initiated_by")[:500]
        return Response(ser.PaymentTransactionSerializer(rows, many=True).data)


class PaymentCollectView(APIView):
    permission_classes = [IsAuthenticated, section_editor("repayments")]

    def post(self, request):
        data = validated(ser.PaymentCollectSerializer, request.data)
        loan = Loan.objects.filter(pk=data["loan_id"], lender=request.user.lender).select_related("borrower").first()
        if loan is None:
            raise NotFound("Loan not found")
        try:
            tx = gateway_service.start_collection(
                staff=request.user, loan=loan, phone=data["phone"], amount=data["amount"], network=data["network"],
            )
        except gateway_service.GatewayError as exc:
            raise UnprocessableEntity(str(exc))
        return Response(ser.PaymentTransactionSerializer(tx).data, status=status.HTTP_201_CREATED)


class PaymentCallbackView(APIView):
    """Webhook for the payment gateway. Authenticated by a shared secret header,
    not a staff login. Idempotent."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        from django.conf import settings as dj_settings

        if request.headers.get("X-Webhook-Token") != dj_settings.LMS_PAYMENT_WEBHOOK_SECRET:
            raise PermissionDenied("Invalid webhook token")
        data = validated(ser.PaymentCallbackSerializer, request.data)
        qs = PaymentTransaction.objects.all()
        tx = None
        if data["provider_ref"]:
            tx = qs.filter(provider_ref=data["provider_ref"]).first()
        if tx is None and data["reference"]:
            tx = qs.filter(reference=data["reference"]).first()
        if tx is None:
            raise NotFound("Unknown transaction")
        tx = gateway_service.settle(tx, success=data["status"] == "success", receipt=data["receipt"],
                                    reason=data["reason"], payload=dict(request.data))
        return Response({"reference": tx.reference, "status": tx.status})


class PaymentSimulateView(APIView):
    """Mock gateway only: stand in for the customer approving/declining."""

    permission_classes = [IsAuthenticated, section_editor("repayments")]

    def post(self, request, payment_id):
        import secrets

        from lms.integrations import payments as pay_integration

        if not pay_integration.get_provider().simulated:
            raise PermissionDenied("Simulation is only available with the mock gateway")
        tx = PaymentTransaction.objects.filter(pk=payment_id, lender=request.user.lender).first()
        if tx is None:
            raise NotFound("Payment not found")
        outcome = validated(ser.PaymentSimulateSerializer, request.data)["outcome"]
        receipt = ("SIM" + secrets.token_hex(4)).upper() if outcome == "success" else ""
        tx = gateway_service.settle(tx, success=outcome == "success", receipt=receipt,
                                    reason="Customer declined (simulated)", payload={"simulated": True})
        return Response(ser.PaymentTransactionSerializer(tx).data)


# ---------------------------------------------------------------- disbursements
#
# Prepared → under verification → authorised → processing → successful.
# See services/disbursements.py; the loan only exists once the transfer is confirmed.

def disbursement_qs(lender):
    return Disbursement.objects.filter(lender=lender).select_related(
        "application", "application__borrower", "loan", "prepared_by", "verified_by", "authorised_by",
        "second_authorised_by", "processed_by", "confirmed_by", "reversed_by", "payment",
    ).prefetch_related("events")


def _disbursement_or_404(request, disbursement_id):
    d = disbursement_qs(request.user.lender).filter(pk=disbursement_id).first()
    if d is None:
        raise NotFound("Disbursement not found")
    return d


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except disbursement_service.DisbursementError as exc:
        if exc.status == 403:
            raise PermissionDenied(str(exc))
        if exc.status == 422:
            raise UnprocessableEntity(str(exc))
        raise Conflict(str(exc))


def _disbursement_response(request, d, code=status.HTTP_200_OK):
    fresh = disbursement_qs(request.user.lender).get(pk=d.pk)
    return Response(ser.DisbursementSerializer(fresh).data, status=code)


class DisbursementsView(APIView):
    permission_classes = [IsAuthenticated, section_editor("disbursement")]

    def get(self, request):
        return Response(ser.DisbursementSerializer(disbursement_qs(request.user.lender), many=True).data)

    def post(self, request):
        data = validated(ser.DisbursementPrepareSerializer, request.data)
        application = application_qs(request.user.lender).filter(pk=data.pop("application_id")).first()
        if application is None:
            raise NotFound("Application not found")
        d = _run(disbursement_service.prepare, request.user, application, data)
        return _disbursement_response(request, d, status.HTTP_201_CREATED)


class DisbursementPreviewView(APIView):
    """The breakdown and destination warnings for a disbursement being prepared."""

    permission_classes = [IsAuthenticated, section_editor("disbursement")]

    def post(self, request):
        data = validated(ser.DisbursementPrepareSerializer, request.data)
        application = application_qs(request.user.lender).filter(pk=data["application_id"]).first()
        if application is None:
            raise NotFound("Application not found")
        parts = disbursement_service.breakdown(
            application, insurance=data.get("insurance", 0), other_deductions=data.get("other_deductions", []),
        )
        warnings = disbursement_service.destination_warnings(
            application, method=data.get("method", ""), recipient_type=data.get("recipient_type", "borrower"),
            name=data.get("recipient_name", ""), provider=data.get("recipient_provider", ""),
            account=data.get("recipient_account", ""),
        )
        threshold = float(request.user.lender.dual_authorisation_threshold or 0)
        return Response({
            **parts, "warnings": warnings,
            "requires_dual_authorisation": threshold > 0 and parts["approved_amount"] >= threshold,
            "dual_authorisation_threshold": threshold,
        })


class DisbursementDetailView(APIView):
    permission_classes = [IsAuthenticated, section_editor("disbursement")]

    def get(self, request, disbursement_id):
        d = _disbursement_or_404(request, disbursement_id)
        return Response(ser.DisbursementSerializer(d).data)

    def patch(self, request, disbursement_id):
        d = _disbursement_or_404(request, disbursement_id)
        data = validated(ser.DisbursementUpdateSerializer, request.data)
        d = _run(disbursement_service.update, request.user, d, data)
        return _disbursement_response(request, d)


class DisbursementActionView(APIView):
    """POST /disbursements/<id>/<action> for submit, verify, authorise, release, confirm, cancel and reverse."""

    permission_classes = [IsAuthenticated, section_editor("disbursement")]

    def post(self, request, disbursement_id, action):
        d = _disbursement_or_404(request, disbursement_id)
        data = validated(ser.DisbursementActionSerializer, request.data)
        s = disbursement_service
        handlers = {
            "submit": lambda: s.submit(request.user, d),
            "verify": lambda: s.verify(request.user, d, destination_confirmed=data["destination_confirmed"],
                                       override_reason=data["override_reason"]),
            "authorise": lambda: s.authorise(request.user, d),
            "release": lambda: s.release(request.user, d, reference=data["reference"]),
            "confirm": lambda: s.confirm(request.user, d, success=data["success"], reference=data["reference"],
                                         reason=data["reason"]),
            "cancel": lambda: s.cancel(request.user, d, reason=data["reason"]),
            "reverse": lambda: s.reverse(request.user, d, reason=data["reason"]),
        }
        if action not in handlers:
            raise NotFound("Unknown disbursement action")
        d = _run(handlers[action])
        return _disbursement_response(request, d)


class LedgerView(APIView):
    """Journal lines (optionally for one loan) plus account balances and the reconciliation."""

    def get(self, request):
        if not (has_section_access(request.user.role, "disbursement") or has_section_access(request.user.role, "reports")):
            raise PermissionDenied("You don't have access to the ledger")
        lender = request.user.lender
        balances = ledger_service.balances(lender)
        rows = LedgerEntry.objects.filter(lender=lender).select_related("loan")
        if request.query_params.get("loanId"):
            rows = rows.filter(loan_id=request.query_params["loanId"])
        rows = rows.order_by("-date", "-journal")[: int(request.query_params.get("limit") or 300)]
        return Response({
            "entries": ser.LedgerEntrySerializer(rows, many=True).data,
            "accounts": [{"code": code, "name": name, "balance": balances[code]} for code, name in ledger_service.ACCOUNTS.items()],
            "reconciliation": ledger_service.reconciliation(lender),
        })
