from rest_framework import serializers

from lms import enums, models
from lms.enums import BorrowerType


class Uuid(serializers.UUIDField):
    """Read-only FK id field — reads `<name>` off the instance and renders the UUID string."""

    def __init__(self, **kw):
        kw.setdefault("read_only", True)
        super().__init__(**kw)


# --------------------------------------------------------------------------- auth

class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()


class RegisterSerializer(serializers.Serializer):
    lender_name = serializers.CharField(max_length=200)
    admin_name = serializers.CharField(max_length=150)
    admin_email = serializers.EmailField()
    admin_password = serializers.CharField(min_length=6)
    currency = serializers.CharField(required=False, default="TZS")
    language = serializers.CharField(required=False, default="sw")


class CurrentStaffSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    branch_id = Uuid(allow_null=True)
    approval_limit = serializers.IntegerField()

    class Meta:
        model = models.Staff
        fields = ["id", "lender_id", "name", "email", "role", "branch_id", "approval_limit", "phone"]


class ProfileUpdateSerializer(serializers.Serializer):
    """Self-service — a user may change their own name and phone, nothing else."""

    name = serializers.CharField(required=False)
    phone = serializers.CharField(required=False, allow_blank=True)


# ------------------------------------------------------------------------- lender

class LenderSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.Lender
        fields = [
            "id", "name", "licence_number", "licence_expiry", "address", "phone", "email",
            "logo_initials", "brand_color", "currency", "language", "plan_level",
            "staff_limit", "active_loan_limit", "sms_balance", "sms_sender_name", "sms_sender_approved",
            "session_timeout_minutes", "dual_authorisation_threshold", "collection_stages",
        ]


class LenderUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(required=False)
    licence_number = serializers.CharField(required=False, allow_blank=True)
    licence_expiry = serializers.DateField(required=False, allow_null=True)
    address = serializers.CharField(required=False, allow_blank=True)
    phone = serializers.CharField(required=False, allow_blank=True)
    email = serializers.CharField(required=False, allow_blank=True)
    logo_initials = serializers.CharField(required=False, allow_blank=True, max_length=3)
    brand_color = serializers.CharField(required=False, max_length=7)
    currency = serializers.CharField(required=False)
    language = serializers.CharField(required=False)
    session_timeout_minutes = serializers.IntegerField(required=False, min_value=1, max_value=1440)
    dual_authorisation_threshold = serializers.FloatField(required=False, min_value=0)
    collection_stages = serializers.ListField(child=serializers.CharField(max_length=40), required=False, min_length=2)


# ----------------------------------------------------------------------- branches

class BranchSerializer(serializers.ModelSerializer):
    lender_id = Uuid()

    class Meta:
        model = models.Branch
        fields = ["id", "lender_id", "name", "code", "location", "opened_on"]


class BranchCreateSerializer(serializers.Serializer):
    name = serializers.CharField()
    code = serializers.CharField()
    location = serializers.CharField(allow_blank=True, default="")
    opened_on = serializers.DateField()


# -------------------------------------------------------------------------- staff

class StaffSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    branch_id = Uuid(allow_null=True)
    approval_limit = serializers.IntegerField()
    active = serializers.BooleanField(source="is_active")

    class Meta:
        model = models.Staff
        fields = ["id", "lender_id", "branch_id", "name", "email", "role", "approval_limit", "phone", "active"]


class StaffCreateSerializer(serializers.Serializer):
    name = serializers.CharField()
    email = serializers.EmailField()
    password = serializers.CharField(min_length=6)
    role = serializers.ChoiceField(choices=enums.StaffRole.choices)
    branch_id = serializers.UUIDField(required=False, allow_null=True)
    approval_limit = serializers.FloatField(required=False, default=0)
    phone = serializers.CharField(required=False, allow_blank=True, default="")


class StaffUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(required=False)
    role = serializers.ChoiceField(choices=enums.StaffRole.choices, required=False)
    branch_id = serializers.UUIDField(required=False, allow_null=True)
    approval_limit = serializers.FloatField(required=False)
    phone = serializers.CharField(required=False, allow_blank=True)
    active = serializers.BooleanField(required=False)


# ----------------------------------------------------------------------- holidays

class HolidaySerializer(serializers.ModelSerializer):
    lender_id = Uuid()

    class Meta:
        model = models.Holiday
        fields = ["id", "lender_id", "date", "name"]


class HolidayCreateSerializer(serializers.Serializer):
    date = serializers.DateField()
    name = serializers.CharField()


# ---------------------------------------------------------------------- borrowers

class GuarantorSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.Guarantor
        fields = [
            "id", "name", "national_id", "phone", "relationship", "address", "occupation",
            "monthly_income", "guarantee_amount", "status", "consent_given", "consent_date",
        ]


class BorrowerDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.BorrowerDocument
        fields = ["id", "name", "type", "uploaded_at"]


class BorrowerHistoryEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.BorrowerHistoryEvent
        fields = ["id", "date", "label", "detail"]


# Profile fields grouped as the registration wizard collects them. Text fields
# are optional/blank-able; national_id, phone and full_name are required on create.
BORROWER_TEXT_FIELDS = [
    "business_name", "registration_number", "tax_id", "sector",
    "gender", "marital_status", "alt_phone", "email",
    "region", "district", "ward", "street", "residence", "postal_address",
    "income_source", "occupation", "employer_name", "job_title", "employment_type", "business_location",
    "other_income_sources", "existing_loans", "bank_name", "bank_account",
    "mobile_money_provider", "mobile_money_number",
    "next_of_kin", "emergency_name", "emergency_relationship", "emergency_phone", "emergency_address",
]
BORROWER_INT_FIELDS = ["years_trading", "years_employed", "dependents"]
BORROWER_MONEY_FIELDS = ["monthly_income", "monthly_expenses", "existing_loan_payments"]


class BorrowerSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    branch_id = Uuid()
    officer_id = Uuid()
    guarantors = GuarantorSerializer(many=True, read_only=True)
    documents = BorrowerDocumentSerializer(many=True, read_only=True)
    history = BorrowerHistoryEventSerializer(many=True, read_only=True)

    class Meta:
        model = models.Borrower
        fields = [
            "id", "lender_id", "branch_id", "officer_id", "customer_number", "status", "type",
            "verified", "phone_verified", "verified_by", "verified_at",
            "full_name", "national_id", "phone", "date_of_birth",
            *BORROWER_TEXT_FIELDS, *BORROWER_INT_FIELDS, *BORROWER_MONEY_FIELDS,
            "blacklisted", "blacklist_reason", "created_at", "guarantors", "documents", "history",
        ]


class GuarantorWriteSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False, allow_null=True)  # keep an existing guarantor (and its links)
    name = serializers.CharField()
    national_id = serializers.CharField()
    phone = serializers.CharField()
    relationship = serializers.CharField(required=False, allow_blank=True, default="")
    address = serializers.CharField(required=False, allow_blank=True, default="")
    occupation = serializers.CharField(required=False, allow_blank=True, default="")
    monthly_income = serializers.FloatField(required=False, default=0)
    guarantee_amount = serializers.FloatField(required=False, default=0)
    status = serializers.ChoiceField(choices=["pending", "approved", "rejected"], required=False, default="pending")
    consent_given = serializers.BooleanField(required=False, default=False)
    consent_date = serializers.DateField(required=False, allow_null=True)


def _profile_fields(create: bool) -> dict:
    fields = {}
    for name in BORROWER_TEXT_FIELDS:
        fields[name] = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    for name in BORROWER_INT_FIELDS:
        fields[name] = serializers.IntegerField(required=False, allow_null=True)
    for name in BORROWER_MONEY_FIELDS:
        fields[name] = serializers.FloatField(required=False)
    fields["date_of_birth"] = serializers.DateField(required=False, allow_null=True)
    fields["type"] = serializers.ChoiceField(choices=BorrowerType.choices, required=create)
    fields["branch_id"] = serializers.UUIDField(required=create)
    fields["officer_id"] = serializers.UUIDField(required=False, allow_null=True)
    fields["full_name"] = serializers.CharField(required=create)
    fields["national_id"] = serializers.CharField(required=create)
    fields["phone"] = serializers.CharField(required=create)
    fields["guarantors"] = GuarantorWriteSerializer(many=True, required=False)
    return fields


BorrowerCreateSerializer = type("BorrowerCreateSerializer", (serializers.Serializer,), _profile_fields(True))
BorrowerUpdateSerializer = type("BorrowerUpdateSerializer", (serializers.Serializer,), _profile_fields(False))


class BorrowerStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=models.Borrower.Status.choices)
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class BorrowerVerifySerializer(serializers.Serializer):
    verified = serializers.BooleanField()
    phone_verified = serializers.BooleanField(required=False)


class CollateralSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    borrower_id = Uuid()
    loan_id = Uuid(allow_null=True)

    class Meta:
        model = models.Collateral
        fields = [
            "id", "lender_id", "borrower_id", "loan_id", "asset_type", "description", "estimated_value",
            "owner_name", "ownership_document", "valuation_date", "valued_by", "existing_claims", "documents",
            "status", "created_by", "created_at",
        ]


class CollateralWriteSerializer(serializers.Serializer):
    asset_type = serializers.CharField()
    description = serializers.CharField()
    estimated_value = serializers.FloatField(min_value=0)
    owner_name = serializers.CharField(required=False, allow_blank=True, default="")
    ownership_document = serializers.CharField(required=False, allow_blank=True, default="")
    valuation_date = serializers.DateField(required=False, allow_null=True)
    valued_by = serializers.CharField(required=False, allow_blank=True, default="")
    existing_claims = serializers.CharField(required=False, allow_blank=True, default="")
    documents = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    loan_id = serializers.UUIDField(required=False, allow_null=True)


class CollateralUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=models.Collateral.Status.choices, required=False)
    estimated_value = serializers.FloatField(min_value=0, required=False)
    valuation_date = serializers.DateField(required=False, allow_null=True)
    loan_id = serializers.UUIDField(required=False, allow_null=True)


class BlacklistSerializer(serializers.Serializer):
    blacklisted = serializers.BooleanField()
    reason = serializers.CharField(required=False, allow_null=True, allow_blank=True)


class BorrowerDocumentUploadSerializer(serializers.Serializer):
    name = serializers.CharField()
    type = serializers.CharField()


# ----------------------------------------------------------------------- products

class ProductFeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.ProductFee
        fields = ["id", "name", "kind", "value", "timing"]


class ApprovalLevelSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.ApprovalLevel
        fields = ["id", "min_amount", "max_amount", "required_role"]


class LoanProductSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    fees = ProductFeeSerializer(many=True, read_only=True)
    approval_levels = ApprovalLevelSerializer(many=True, read_only=True)

    class Meta:
        model = models.LoanProduct
        fields = [
            "id", "lender_id", "name", "code", "active", "interest_method", "interest_rate",
            "interest_period", "repayment_frequency", "min_amount", "max_amount",
            "min_term_instalments", "max_term_instalments", "step_up_enabled", "grace_period_days",
            "grace_period_applies_to", "penalty_kind", "penalty_value", "penalty_cap",
            "compulsory_savings_percent", "allocation_order", "security_required", "fees", "approval_levels",
        ]


class ProductFeeWriteSerializer(serializers.Serializer):
    id = serializers.CharField(required=False, allow_null=True)
    name = serializers.CharField()
    kind = serializers.CharField()
    value = serializers.FloatField()
    timing = serializers.ChoiceField(choices=enums.FeeTiming.choices)


class ApprovalLevelWriteSerializer(serializers.Serializer):
    id = serializers.CharField(required=False, allow_null=True)
    min_amount = serializers.FloatField()
    max_amount = serializers.FloatField(required=False, allow_null=True)
    required_role = serializers.ChoiceField(choices=enums.StaffRole.choices)


class LoanProductWriteSerializer(serializers.Serializer):
    name = serializers.CharField()
    code = serializers.CharField()
    active = serializers.BooleanField(required=False, default=True)
    interest_method = serializers.ChoiceField(choices=enums.InterestMethod.choices)
    interest_rate = serializers.FloatField()
    interest_period = serializers.ChoiceField(choices=enums.InterestPeriod.choices)
    repayment_frequency = serializers.ChoiceField(choices=enums.RepaymentFrequency.choices)
    min_amount = serializers.FloatField()
    max_amount = serializers.FloatField()
    min_term_instalments = serializers.IntegerField()
    max_term_instalments = serializers.IntegerField()
    step_up_enabled = serializers.BooleanField(required=False, default=False)
    grace_period_days = serializers.IntegerField(required=False, default=0)
    grace_period_applies_to = serializers.ChoiceField(
        choices=enums.GracePeriodAppliesTo.choices, required=False, default="none"
    )
    penalty_kind = serializers.CharField()
    penalty_value = serializers.FloatField()
    penalty_cap = serializers.FloatField()
    compulsory_savings_percent = serializers.FloatField(required=False, default=0)
    allocation_order = serializers.ListField(child=serializers.CharField())
    security_required = serializers.ListField(child=serializers.CharField())
    fees = ProductFeeWriteSerializer(many=True, required=False, default=list)
    approval_levels = ApprovalLevelWriteSerializer(many=True, required=False, default=list)


class ProductActiveSerializer(serializers.Serializer):
    active = serializers.BooleanField()


# ------------------------------------------------------------------- applications

class ApprovalDecisionSerializer(serializers.ModelSerializer):
    approver_id = Uuid()

    class Meta:
        model = models.ApprovalDecision
        fields = ["id", "approver_id", "approver_name", "role", "decision", "date", "comment"]


class ApplicationDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.ApplicationDocument
        fields = ["id", "type", "name", "status", "note", "verified_by", "verified_at", "uploaded_by", "uploaded_at"]


class ApplicationEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.ApplicationEvent
        fields = ["id", "stage", "label", "note", "by", "at"]


class ApplicationSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    branch_id = Uuid()
    borrower_id = Uuid()
    product_id = Uuid()
    group_id = Uuid(allow_null=True)
    created_by = Uuid(source="created_by_id")
    loan_officer_id = Uuid(allow_null=True)
    assessed_by_id = Uuid(allow_null=True)
    approvals = ApprovalDecisionSerializer(many=True, read_only=True)
    documents = ApplicationDocumentSerializer(many=True, read_only=True)
    events = ApplicationEventSerializer(many=True, read_only=True)
    group_member_ids = serializers.SerializerMethodField()
    guarantor_ids = serializers.SerializerMethodField()
    collateral_ids = serializers.SerializerMethodField()
    capacity = serializers.SerializerMethodField()

    def get_group_member_ids(self, obj):
        return [str(b.pk) for b in obj.group_members.all()]

    def get_guarantor_ids(self, obj):
        return [str(g.pk) for g in obj.guarantors.all()]

    def get_collateral_ids(self, obj):
        return [str(c.pk) for c in obj.collateral.all()]

    def get_capacity(self, obj):
        from lms.services.applications import repayment_capacity

        return repayment_capacity(
            monthly_income=obj.declared_income, other_income=obj.other_income,
            business_income=obj.business_income, business_expenses=obj.business_expenses,
            monthly_expenses=obj.declared_expenses, existing_repayments=obj.existing_repayments,
        )

    class Meta:
        model = models.Application
        fields = [
            "id", "lender_id", "branch_id", "reference", "borrower_id", "product_id", "group_id", "amount",
            "term_instalments", "purpose", "status", "declared_income", "declared_expenses",
            "affordability_pass", "duplicate_check_pass", "blacklist_check_pass",
            "credit_bureau_consent", "score", "score_recommendation", "required_approver_role",
            "created_by", "created_at", "decline_reason", "approvals", "risk", "needs_review",
            "requested_amount", "requested_term", "loan_officer_id", "application_date", "disbursement_method",
            "first_repayment_date", "group_member_ids", "guarantor_ids", "collateral_ids",
            "other_income", "business_income", "business_expenses", "existing_loans_count", "existing_repayments",
            "dependents", "capacity",
            "assessment_result", "assessed_amount", "recommended_term", "assessment_notes", "assessed_by_id",
            "assessed_at", "documents", "events",
        ]


class ApplicationCreateSerializer(serializers.Serializer):
    borrower_id = serializers.UUIDField()
    product_id = serializers.UUIDField()
    branch_id = serializers.UUIDField(required=False, allow_null=True)
    group_id = serializers.UUIDField(required=False, allow_null=True)
    amount = serializers.FloatField()
    term_instalments = serializers.IntegerField()
    purpose = serializers.CharField(allow_blank=True)
    declared_income = serializers.FloatField()
    declared_expenses = serializers.FloatField()
    credit_bureau_consent = serializers.BooleanField(required=False, default=False)
    # staged workflow — all optional so a minimal application still works
    draft = serializers.BooleanField(required=False, default=False)
    loan_officer_id = serializers.UUIDField(required=False, allow_null=True)
    application_date = serializers.DateField(required=False, allow_null=True)
    disbursement_method = serializers.ChoiceField(choices=enums.DisbursementChannel.choices, required=False, allow_blank=True)
    first_repayment_date = serializers.DateField(required=False, allow_null=True)
    group_member_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    guarantor_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    collateral_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    other_income = serializers.FloatField(required=False, min_value=0, default=0)
    business_income = serializers.FloatField(required=False, min_value=0, default=0)
    business_expenses = serializers.FloatField(required=False, min_value=0, default=0)
    existing_loans_count = serializers.IntegerField(required=False, min_value=0, default=0)
    existing_repayments = serializers.FloatField(required=False, min_value=0, allow_null=True, default=None)
    dependents = serializers.IntegerField(required=False, min_value=0, default=0)
    documents = serializers.ListField(child=serializers.DictField(), required=False, default=list)


class ApplicationUpdateSerializer(serializers.Serializer):
    """Edits while the application is still with the loan officer."""

    product_id = serializers.UUIDField(required=False)
    group_id = serializers.UUIDField(required=False, allow_null=True)
    amount = serializers.FloatField(required=False)
    term_instalments = serializers.IntegerField(required=False)
    purpose = serializers.CharField(required=False, allow_blank=True)
    declared_income = serializers.FloatField(required=False, min_value=0)
    declared_expenses = serializers.FloatField(required=False, min_value=0)
    credit_bureau_consent = serializers.BooleanField(required=False)
    loan_officer_id = serializers.UUIDField(required=False, allow_null=True)
    disbursement_method = serializers.ChoiceField(choices=enums.DisbursementChannel.choices, required=False, allow_blank=True)
    first_repayment_date = serializers.DateField(required=False, allow_null=True)
    group_member_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    guarantor_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    collateral_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    other_income = serializers.FloatField(required=False, min_value=0)
    business_income = serializers.FloatField(required=False, min_value=0)
    business_expenses = serializers.FloatField(required=False, min_value=0)
    existing_loans_count = serializers.IntegerField(required=False, min_value=0)
    existing_repayments = serializers.FloatField(required=False, min_value=0)
    dependents = serializers.IntegerField(required=False, min_value=0)


class ApplicationAssessmentSerializer(serializers.Serializer):
    result = serializers.ChoiceField(choices=enums.AssessmentResult.choices)
    assessed_amount = serializers.FloatField(min_value=0)
    recommended_term = serializers.IntegerField(min_value=1)
    notes = serializers.CharField(allow_blank=True, required=False, default="")
    forward = serializers.BooleanField(required=False, default=False)


class ApplicationDecisionSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=enums.ApprovalDecisionType.choices)
    comment = serializers.CharField(allow_blank=True)
    # optional: approve on different terms than requested
    approved_amount = serializers.FloatField(required=False, allow_null=True, min_value=0)
    approved_term = serializers.IntegerField(required=False, allow_null=True, min_value=1)


class ApplicationDocumentWriteSerializer(serializers.Serializer):
    type = serializers.CharField(max_length=60)
    name = serializers.CharField(max_length=200)


class ApplicationDocumentVerifySerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=models.ApplicationDocument.Status.choices)
    note = serializers.CharField(required=False, allow_blank=True, default="")


# --------------------------------------------------------------------------- loans

class ScheduleInstalmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.ScheduleInstalment
        fields = [
            "id", "period", "due_date", "principal_due", "interest_due", "fees_due",
            "penalty_due", "total_due", "paid_amount", "balance_after", "status", "was_late",
        ]


class LoanSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    branch_id = Uuid()
    application_id = Uuid()
    borrower_id = Uuid()
    product_id = Uuid()
    group_id = Uuid(allow_null=True)
    schedule = ScheduleInstalmentSerializer(many=True, read_only=True)
    disbursement = serializers.SerializerMethodField()

    class Meta:
        model = models.Loan
        fields = [
            "id", "lender_id", "branch_id", "application_id", "borrower_id", "product_id",
            "group_id", "loan_number",
            "principal", "net_disbursed", "fees_deducted", "savings_deducted", "status", "outstanding_balance",
            "days_in_arrears", "arrears_amount", "restructure_count", "restructured_at",
            "closed_at", "closure_reason", "disbursement", "created_at", "schedule",
        ]

    def get_disbursement(self, obj):
        return obj.disbursement


class DisburseSerializer(serializers.Serializer):
    channel = serializers.ChoiceField(choices=enums.DisbursementChannel.choices)
    reference = serializers.CharField()


class BatchDisburseItemSerializer(serializers.Serializer):
    application_id = serializers.UUIDField()
    channel = serializers.ChoiceField(choices=enums.DisbursementChannel.choices)
    reference = serializers.CharField()


class BatchDisburseSerializer(serializers.Serializer):
    items = BatchDisburseItemSerializer(many=True, allow_empty=False)


class WriteOffSerializer(serializers.Serializer):
    reason = serializers.CharField()


class RestructureSerializer(serializers.Serializer):
    new_term = serializers.IntegerField(min_value=1, max_value=120)
    first_due_date = serializers.DateField(required=False, allow_null=True)
    waive_penalties = serializers.BooleanField(required=False, default=False)
    reason = serializers.CharField(required=False, allow_blank=True, default="")


# ----------------------------------------------------------------------- repayments

class RepaymentSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    loan_id = Uuid()
    received_by_id = Uuid(allow_null=True)
    branch_id = Uuid(allow_null=True)
    corrects_id = Uuid(allow_null=True)
    group_payment_id = Uuid(allow_null=True)
    collection_activity_id = Uuid(allow_null=True)
    received_by_name = serializers.SerializerMethodField()
    corrected_by_id = serializers.SerializerMethodField()
    allocation = serializers.SerializerMethodField()

    class Meta:
        model = models.Repayment
        fields = [
            "id", "lender_id", "loan_id", "amount", "date", "channel", "receipt_number",
            "allocation", "recorded_by", "reversed", "reversal_reason", "reversed_by", "reversed_at",
            "payment_date", "reference", "received_by_id", "received_by_name", "branch_id", "collection_point",
            "notes", "balance_after", "corrects_id", "corrected_by_id", "group_payment_id", "collection_activity_id",
            "reconciliation_status", "reconciled_at", "reconciled_by", "reconciliation_note",
        ]

    def get_received_by_name(self, obj):
        return obj.received_by.name if obj.received_by_id else obj.recorded_by

    def get_corrected_by_id(self, obj):
        fix = next(iter(obj.corrections.all()), None)
        return str(fix.pk) if fix else None

    def get_allocation(self, obj):
        return obj.allocation


class RepaymentCreateSerializer(serializers.Serializer):
    loan_id = serializers.UUIDField()
    amount = serializers.FloatField()
    channel = serializers.ChoiceField(choices=enums.RepaymentChannel.choices)
    payment_date = serializers.DateField(required=False, allow_null=True)
    reference = serializers.CharField(required=False, allow_blank=True, default="", max_length=100)
    received_by_id = serializers.UUIDField(required=False, allow_null=True)
    branch_id = serializers.UUIDField(required=False, allow_null=True)
    collection_point = serializers.CharField(required=False, allow_blank=True, default="", max_length=150)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    collection_activity_id = serializers.UUIDField(required=False, allow_null=True)


class CorrectedPaymentSerializer(serializers.Serializer):
    amount = serializers.FloatField()
    channel = serializers.ChoiceField(choices=enums.RepaymentChannel.choices, required=False)
    payment_date = serializers.DateField(required=False, allow_null=True)
    reference = serializers.CharField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class RepaymentReverseSerializer(serializers.Serializer):
    reason = serializers.CharField()
    corrected = CorrectedPaymentSerializer(required=False, allow_null=True)


class GroupPaymentSerializer(serializers.ModelSerializer):
    group_id = Uuid()
    received_by_id = Uuid(allow_null=True)
    repayment_ids = serializers.SerializerMethodField()
    reconciled = serializers.SerializerMethodField()

    class Meta:
        model = models.GroupPayment
        fields = ["id", "group_id", "number", "amount", "payment_date", "channel", "reference", "received_by_id",
                  "collection_point", "notes", "recorded_by", "created_at", "repayment_ids", "reconciled"]

    def get_repayment_ids(self, obj):
        return [str(r.pk) for r in obj.repayments.all()]

    def get_reconciled(self, obj):
        rows = list(obj.repayments.all())
        return bool(rows) and all(r.reconciliation_status == "reconciled" for r in rows if not r.reversed)


class ContributionSerializer(serializers.Serializer):
    loan_id = serializers.UUIDField()
    amount = serializers.FloatField(min_value=0)


class GroupPaymentCreateSerializer(serializers.Serializer):
    channel = serializers.ChoiceField(choices=enums.RepaymentChannel.choices)
    payment_date = serializers.DateField(required=False, allow_null=True)
    reference = serializers.CharField(required=False, allow_blank=True, default="")
    collection_point = serializers.CharField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    contributions = ContributionSerializer(many=True)


class StatementLineSerializer(serializers.ModelSerializer):
    repayment_id = Uuid(allow_null=True)
    group_payment_id = Uuid(allow_null=True)

    class Meta:
        model = models.StatementLine
        fields = ["id", "source", "date", "reference", "amount", "description", "batch", "status", "repayment_id",
                  "group_payment_id", "note", "imported_by", "imported_at"]


class StatementRowSerializer(serializers.Serializer):
    date = serializers.DateField()
    reference = serializers.CharField(required=False, allow_blank=True, default="")
    amount = serializers.FloatField()
    description = serializers.CharField(required=False, allow_blank=True, default="")


class StatementImportSerializer(serializers.Serializer):
    source = serializers.ChoiceField(choices=["bank", "mobile_money", "cash"])
    lines = StatementRowSerializer(many=True)


class StatementActionSerializer(serializers.Serializer):
    repayment_id = serializers.UUIDField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, default="")


# --------------------------------------------------------------------------- audit

class AuditLogEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = models.AuditLogEntry
        fields = ["id", "timestamp", "user_id", "user_name", "action", "entity", "entity_id", "details", "changes"]


class NotificationSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    borrower_id = Uuid(allow_null=True)

    class Meta:
        model = models.Notification
        fields = [
            "id", "lender_id", "borrower_id", "channel", "to", "kind", "body", "status", "error",
            "segments", "provider_ref", "sent_by", "batch", "created_at", "sent_at",
        ]


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField()
    new_password = serializers.CharField(min_length=6)


# --------------------------------------------------------------------- collections

class CollectionActivitySerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    loan_id = Uuid()
    borrower_id = Uuid()
    case_id = Uuid(allow_null=True)
    promise_status = serializers.SerializerMethodField()

    class Meta:
        model = models.CollectionActivity
        fields = [
            "id", "lender_id", "loan_id", "borrower_id", "kind", "outcome", "note",
            "promised_amount", "promised_date", "promise_status", "created_by", "created_at",
            "case_id", "reason", "next_follow_up", "next_action", "location", "purpose", "amount_collected",
            "visit_date", "visit_status", "attachments",
        ]

    def get_promise_status(self, obj):
        return getattr(obj, "_promise_status", None)


class GroupMembershipSerializer(serializers.ModelSerializer):
    borrower_id = Uuid()
    borrower_name = serializers.CharField(source="borrower.full_name", read_only=True)
    borrower_phone = serializers.CharField(source="borrower.phone", read_only=True)
    customer_number = serializers.CharField(source="borrower.customer_number", read_only=True)

    class Meta:
        model = models.GroupMembership
        fields = [
            "id", "borrower_id", "borrower_name", "borrower_phone", "customer_number", "membership_number",
            "role", "joined_on", "status", "left_on", "active",
        ]


class GroupDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.GroupDocument
        fields = ["id", "name", "type", "uploaded_at"]


class GroupHistoryEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.GroupHistoryEvent
        fields = ["id", "date", "label", "detail", "by"]


class GroupAttendanceSerializer(serializers.ModelSerializer):
    membership_id = Uuid()

    class Meta:
        model = models.GroupAttendance
        fields = ["id", "membership_id", "present", "contribution"]


class GroupMeetingSerializer(serializers.ModelSerializer):
    attendance = GroupAttendanceSerializer(many=True, read_only=True)

    class Meta:
        model = models.GroupMeeting
        fields = ["id", "date", "location", "notes", "collection_amount", "recorded_by", "created_at", "attendance"]


class BorrowerGroupSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    branch_id = Uuid()
    officer_id = Uuid()
    memberships = GroupMembershipSerializer(many=True, read_only=True)
    documents = GroupDocumentSerializer(many=True, read_only=True)
    history = GroupHistoryEventSerializer(many=True, read_only=True)
    meetings = GroupMeetingSerializer(many=True, read_only=True)
    savings_total = serializers.SerializerMethodField()
    contributions_total = serializers.SerializerMethodField()

    class Meta:
        model = models.BorrowerGroup
        fields = [
            "id", "lender_id", "branch_id", "officer_id", "group_number", "name", "group_type", "purpose",
            "region", "district", "ward", "location", "meeting_location", "meeting_day", "meeting_frequency",
            "meeting_time", "loan_limit", "formed_on", "status", "active", "created_at",
            "memberships", "documents", "history", "meetings", "savings_total", "contributions_total",
        ]

    def get_savings_total(self, obj):
        from django.db.models import Sum

        ids = [m.borrower_id for m in obj.memberships.all() if m.status == "active"]
        total = models.SavingsAccount.objects.filter(borrower_id__in=ids).aggregate(t=Sum("balance"))["t"]
        return float(total or 0)

    def get_contributions_total(self, obj):
        return float(sum(float(m.collection_amount) for m in obj.meetings.all()))


GROUP_TYPES = ["business", "women", "youth", "agriculture", "savings", "general"]


class GroupMemberInputSerializer(serializers.Serializer):
    borrower_id = serializers.UUIDField()
    role = serializers.ChoiceField(choices=models.GroupMembership.Role.choices, required=False, default="member")


class BorrowerGroupWriteSerializer(serializers.Serializer):
    name = serializers.CharField()
    branch_id = serializers.UUIDField()
    officer_id = serializers.UUIDField()
    group_type = serializers.ChoiceField(choices=GROUP_TYPES, required=False, default="general")
    purpose = serializers.CharField(required=False, allow_blank=True, default="")
    region = serializers.CharField(required=False, allow_blank=True, default="")
    district = serializers.CharField(required=False, allow_blank=True, default="")
    ward = serializers.CharField(required=False, allow_blank=True, default="")
    location = serializers.CharField(required=False, allow_blank=True, default="")
    meeting_location = serializers.CharField(required=False, allow_blank=True, default="")
    meeting_day = serializers.CharField(required=False, allow_blank=True, default="")
    meeting_frequency = serializers.ChoiceField(choices=["weekly", "biweekly", "monthly"], required=False, default="weekly")
    meeting_time = serializers.CharField(required=False, allow_blank=True, default="")
    loan_limit = serializers.FloatField(required=False, default=0, min_value=0)
    formed_on = serializers.DateField(required=False)
    status = serializers.ChoiceField(choices=models.BorrowerGroup.Status.choices, required=False, default="active")
    members = GroupMemberInputSerializer(many=True, required=False, default=list)
    documents = serializers.ListField(child=serializers.DictField(), required=False, default=list)


class BorrowerGroupUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(required=False)
    branch_id = serializers.UUIDField(required=False)
    officer_id = serializers.UUIDField(required=False)
    group_type = serializers.ChoiceField(choices=GROUP_TYPES, required=False)
    purpose = serializers.CharField(required=False, allow_blank=True)
    region = serializers.CharField(required=False, allow_blank=True)
    district = serializers.CharField(required=False, allow_blank=True)
    ward = serializers.CharField(required=False, allow_blank=True)
    location = serializers.CharField(required=False, allow_blank=True)
    meeting_location = serializers.CharField(required=False, allow_blank=True)
    meeting_day = serializers.CharField(required=False, allow_blank=True)
    meeting_frequency = serializers.ChoiceField(choices=["weekly", "biweekly", "monthly"], required=False)
    meeting_time = serializers.CharField(required=False, allow_blank=True)
    loan_limit = serializers.FloatField(required=False, min_value=0)
    formed_on = serializers.DateField(required=False)
    status = serializers.ChoiceField(choices=models.BorrowerGroup.Status.choices, required=False)
    active = serializers.BooleanField(required=False)


class GroupMemberAddSerializer(serializers.Serializer):
    borrower_id = serializers.UUIDField()
    role = serializers.ChoiceField(choices=models.GroupMembership.Role.choices, required=False, default="member")


class GroupMemberUpdateSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=models.GroupMembership.Role.choices, required=False)
    status = serializers.ChoiceField(choices=models.GroupMembership.Status.choices, required=False)


class GroupAttendanceInputSerializer(serializers.Serializer):
    membership_id = serializers.UUIDField()
    present = serializers.BooleanField(default=True)
    contribution = serializers.FloatField(required=False, default=0, min_value=0)


class GroupMeetingWriteSerializer(serializers.Serializer):
    date = serializers.DateField()
    location = serializers.CharField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    attendance = GroupAttendanceInputSerializer(many=True, required=False, default=list)


class GroupDocumentWriteSerializer(serializers.Serializer):
    name = serializers.CharField()
    type = serializers.CharField()


class SavingsTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.SavingsTransaction
        fields = ["id", "kind", "amount", "balance_after", "note", "created_by", "created_at"]


class SavingsAccountSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    borrower_id = Uuid()
    borrower_name = serializers.CharField(source="borrower.full_name", read_only=True)
    transactions = SavingsTransactionSerializer(many=True, read_only=True)

    class Meta:
        model = models.SavingsAccount
        fields = ["id", "lender_id", "borrower_id", "borrower_name", "balance", "created_at", "transactions"]


class SavingsAccountListSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    borrower_id = Uuid()
    borrower_name = serializers.CharField(source="borrower.full_name", read_only=True)

    class Meta:
        model = models.SavingsAccount
        fields = ["id", "lender_id", "borrower_id", "borrower_name", "balance", "created_at"]


class SavingsTransactionCreateSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["deposit", "withdrawal", "release"])
    amount = serializers.FloatField(min_value=0.01)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class TillReconciliationSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    branch_id = Uuid(allow_null=True)

    class Meta:
        model = models.TillReconciliation
        fields = [
            "id", "lender_id", "branch_id", "cashier_name", "business_date",
            "opening_float", "cash_in", "cash_out", "expected_close", "counted_close",
            "variance", "note", "created_at",
        ]


class TillCloseSerializer(serializers.Serializer):
    business_date = serializers.DateField(required=False, allow_null=True)
    counted_close = serializers.FloatField()
    note = serializers.CharField(required=False, allow_blank=True, default="")


class CollectionActivityCreateSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=models.CollectionActivity.Kind.choices)
    outcome = serializers.ChoiceField(
        choices=models.CollectionActivity.Outcome.choices, required=False, allow_blank=True, default=""
    )
    note = serializers.CharField(required=False, allow_blank=True, default="")
    promised_amount = serializers.FloatField(required=False, allow_null=True)
    promised_date = serializers.DateField(required=False, allow_null=True)
    reason = serializers.CharField(required=False, allow_blank=True, default="", max_length=250)
    next_follow_up = serializers.DateField(required=False, allow_null=True)
    next_action = serializers.CharField(required=False, allow_blank=True, default="", max_length=250)
    location = serializers.CharField(required=False, allow_blank=True, default="", max_length=250)
    purpose = serializers.CharField(required=False, allow_blank=True, default="", max_length=250)
    amount_collected = serializers.FloatField(required=False, allow_null=True, min_value=0)
    visit_date = serializers.DateField(required=False, allow_null=True)
    visit_status = serializers.ChoiceField(choices=["", "scheduled", "completed"], required=False, default="")
    attachments = serializers.ListField(child=serializers.CharField(max_length=200), required=False, default=list)
    payment = CorrectedPaymentSerializer(required=False, allow_null=True)

    def validate(self, data):
        if data["kind"] == "promise" and not data.get("promised_amount"):
            raise serializers.ValidationError("A promise needs a promised amount")
        if data["kind"] == "promise" and not data.get("promised_date"):
            raise serializers.ValidationError("A promise needs a promise date")
        if data["kind"] == "visit" and not data.get("visit_status"):
            data["visit_status"] = "completed"
        if data["kind"] == "escalation" and not data.get("note", "").strip():
            raise serializers.ValidationError("Say why the case is being escalated")
        if data.get("payment") and data["kind"] not in ("visit", "call", "note"):
            raise serializers.ValidationError("Payments can only be taken during a visit or contact")
        return data


class CollectionCaseSerializer(serializers.ModelSerializer):
    loan_id = Uuid()
    assigned_to_id = Uuid(allow_null=True)
    loan_number = serializers.CharField(source="loan.loan_number", read_only=True)
    borrower_id = Uuid(source="loan.borrower_id")
    borrower_name = serializers.CharField(source="loan.borrower.full_name", read_only=True)
    group_id = Uuid(source="loan.group_id", allow_null=True)
    group_name = serializers.SerializerMethodField()
    branch_id = Uuid(source="loan.branch_id")
    assigned_to_name = serializers.SerializerMethodField()
    figures = serializers.SerializerMethodField()

    class Meta:
        model = models.CollectionCase
        fields = [
            "id", "number", "loan_id", "loan_number", "borrower_id", "borrower_name", "group_id", "group_name",
            "branch_id", "status", "stage", "assigned_to_id", "assigned_to_name", "assigned_by", "assigned_at",
            "next_action", "next_follow_up", "opened_at", "closed_at", "resolution_note", "last_contact_at", "figures",
        ]

    def get_group_name(self, obj):
        return obj.loan.group.name if obj.loan.group_id else None

    def get_assigned_to_name(self, obj):
        return obj.assigned_to.name if obj.assigned_to_id else ""

    def get_figures(self, obj):
        from lms.services.collection_cases import case_figures

        return case_figures(obj)

    def to_representation(self, obj):
        data = super().to_representation(obj)
        data.update(data.pop("figures"))  # flatten the loan figures into the case
        return data


class CollectionCaseUpdateSerializer(serializers.Serializer):
    assigned_to_id = serializers.UUIDField(required=False, allow_null=True)
    status = serializers.ChoiceField(choices=[
        "pending_follow_up", "contacted", "promise_to_pay", "promise_kept", "promise_broken",
        "field_visit_required", "under_review", "escalated", "resolved", "paid",
    ], required=False)
    stage = serializers.CharField(required=False, max_length=40)
    next_action = serializers.CharField(required=False, allow_blank=True, max_length=250)
    next_follow_up = serializers.DateField(required=False, allow_null=True)
    resolution_note = serializers.CharField(required=False, allow_blank=True, max_length=250)


class CollectionCaseAssignSerializer(serializers.Serializer):
    case_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1)
    staff_id = serializers.UUIDField()


# ---------------------------------------------------------------- sms & payments

class SmsSendSerializer(serializers.Serializer):
    borrower_id = serializers.UUIDField(required=False, allow_null=True)
    to = serializers.CharField(required=False, allow_blank=True, default="")
    message = serializers.CharField(max_length=918)  # 6 SMS parts

    def validate(self, data):
        if not data.get("borrower_id") and not data.get("to"):
            raise serializers.ValidationError("Choose a borrower or enter a phone number")
        return data


class SmsBulkSerializer(serializers.Serializer):
    audience = serializers.ChoiceField(choices=["all", "active_loans", "overdue", "due_soon", "group", "custom"])
    message = serializers.CharField(max_length=918)
    branch_id = serializers.UUIDField(required=False, allow_null=True)
    group_id = serializers.UUIDField(required=False, allow_null=True)
    borrower_ids = serializers.ListField(child=serializers.UUIDField(), required=False, default=list)
    due_within_days = serializers.IntegerField(required=False, default=3, min_value=0, max_value=60)
    dry_run = serializers.BooleanField(required=False, default=False)


class PaymentTransactionSerializer(serializers.ModelSerializer):
    borrower_id = Uuid()
    loan_id = Uuid(allow_null=True)
    application_id = Uuid(allow_null=True)
    repayment_id = Uuid(allow_null=True)
    initiated_by_name = serializers.CharField(source="initiated_by.name", read_only=True)

    class Meta:
        model = models.PaymentTransaction
        fields = [
            "id", "reference", "direction", "network", "provider", "provider_ref", "phone", "amount",
            "borrower_id", "loan_id", "application_id", "repayment_id", "status", "failure_reason",
            "receipt", "initiated_by_name", "created_at", "completed_at",
        ]


NETWORK_CHOICES = ["mpesa", "tigopesa", "airtel", "halopesa", "bank"]


class PaymentCollectSerializer(serializers.Serializer):
    loan_id = serializers.UUIDField()
    phone = serializers.CharField()
    amount = serializers.FloatField(min_value=1)
    network = serializers.ChoiceField(choices=NETWORK_CHOICES, default="mpesa")


class PaymentPayoutSerializer(serializers.Serializer):
    application_id = serializers.UUIDField()
    phone = serializers.CharField()
    network = serializers.ChoiceField(choices=NETWORK_CHOICES, default="mpesa")


class PaymentCallbackSerializer(serializers.Serializer):
    reference = serializers.CharField(required=False, allow_blank=True, default="")
    provider_ref = serializers.CharField(required=False, allow_blank=True, default="")
    status = serializers.ChoiceField(choices=["success", "failed"])
    receipt = serializers.CharField(required=False, allow_blank=True, default="")
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class PaymentSimulateSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(choices=["success", "failed"])


# ---------------------------------------------------------------- disbursements

class DisbursementEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.DisbursementEvent
        fields = ["id", "status", "action", "note", "changes", "by", "at"]


class DisbursementSerializer(serializers.ModelSerializer):
    application_id = Uuid()
    loan_id = Uuid(allow_null=True)
    payment_id = Uuid(allow_null=True)
    prepared_by_id = Uuid()
    verified_by_id = Uuid(allow_null=True)
    authorised_by_id = Uuid(allow_null=True)
    second_authorised_by_id = Uuid(allow_null=True)
    processed_by_id = Uuid(allow_null=True)
    application_reference = serializers.CharField(source="application.reference", read_only=True)
    borrower_id = Uuid(source="application.borrower_id")
    borrower_name = serializers.CharField(source="application.borrower.full_name", read_only=True)
    customer_number = serializers.CharField(source="application.borrower.customer_number", read_only=True)
    loan_number = serializers.SerializerMethodField()
    payment_status = serializers.SerializerMethodField()
    staff_names = serializers.SerializerMethodField()
    checklist = serializers.SerializerMethodField()
    events = DisbursementEventSerializer(many=True, read_only=True)

    class Meta:
        model = models.Disbursement
        fields = [
            "id", "number", "application_id", "application_reference", "borrower_id", "borrower_name",
            "customer_number", "loan_id", "loan_number", "status",
            "approved_amount", "fees", "fees_total", "insurance", "savings_deducted", "other_deductions", "net_amount",
            "method", "recipient_type", "recipient_name", "recipient_provider", "recipient_account",
            "authorisation_note", "destination_verified", "warnings",
            "requires_dual_authorisation", "checks", "override_reason",
            "prepared_by_id", "prepared_at", "verified_by_id", "verified_at", "authorised_by_id", "authorised_at",
            "second_authorised_by_id", "second_authorised_at", "processed_by_id", "processed_at", "confirmed_at",
            "reversed_at", "staff_names", "checklist",
            "transaction_reference", "payment_id", "payment_status", "failure_reason", "cancel_reason",
            "reversal_reason", "created_at", "events",
        ]

    def get_loan_number(self, obj):
        return obj.loan.loan_number if obj.loan_id else None

    def get_payment_status(self, obj):
        return obj.payment.status if obj.payment_id else None

    def get_checklist(self, obj):
        from lms.services.disbursements import checks

        return checks(obj)

    def get_staff_names(self, obj):
        def name(s):
            return s.name if s else ""

        return {
            "prepared_by": name(obj.prepared_by), "verified_by": name(obj.verified_by),
            "authorised_by": name(obj.authorised_by), "second_authorised_by": name(obj.second_authorised_by),
            "processed_by": name(obj.processed_by), "confirmed_by": name(obj.confirmed_by),
            "reversed_by": name(obj.reversed_by),
        }


class DeductionSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=80)
    amount = serializers.FloatField(min_value=0)


class DisbursementPrepareSerializer(serializers.Serializer):
    application_id = serializers.UUIDField()
    method = serializers.ChoiceField(choices=enums.DisbursementChannel.choices)
    recipient_type = serializers.ChoiceField(choices=["borrower", "third_party"], required=False, default="borrower")
    recipient_name = serializers.CharField(required=False, allow_blank=True, default="")
    recipient_provider = serializers.CharField(required=False, allow_blank=True, default="")
    recipient_account = serializers.CharField(required=False, allow_blank=True, default="")
    authorisation_note = serializers.CharField(required=False, allow_blank=True, default="")
    insurance = serializers.FloatField(required=False, min_value=0, default=0)
    other_deductions = DeductionSerializer(many=True, required=False, default=list)


class DisbursementUpdateSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=enums.DisbursementChannel.choices, required=False)
    recipient_type = serializers.ChoiceField(choices=["borrower", "third_party"], required=False)
    recipient_name = serializers.CharField(required=False, allow_blank=True)
    recipient_provider = serializers.CharField(required=False, allow_blank=True)
    recipient_account = serializers.CharField(required=False, allow_blank=True)
    authorisation_note = serializers.CharField(required=False, allow_blank=True)
    insurance = serializers.FloatField(required=False, min_value=0)
    other_deductions = DeductionSerializer(many=True, required=False)


class DisbursementActionSerializer(serializers.Serializer):
    destination_confirmed = serializers.BooleanField(required=False, default=False)
    override_reason = serializers.CharField(required=False, allow_blank=True, default="")
    reference = serializers.CharField(required=False, allow_blank=True, default="")
    success = serializers.BooleanField(required=False, default=True)
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class LedgerEntrySerializer(serializers.ModelSerializer):
    loan_id = Uuid(allow_null=True)
    loan_number = serializers.SerializerMethodField()

    class Meta:
        model = models.LedgerEntry
        fields = ["id", "journal", "date", "account", "debit", "credit", "description", "reference", "loan_id",
                  "loan_number", "created_by"]

    def get_loan_number(self, obj):
        return obj.loan.loan_number if obj.loan_id else None
