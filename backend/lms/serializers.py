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
        fields = ["id", "name", "national_id", "phone", "consent_given", "consent_date"]


class BorrowerDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.BorrowerDocument
        fields = ["id", "name", "type", "uploaded_at"]


class BorrowerHistoryEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.BorrowerHistoryEvent
        fields = ["id", "date", "label", "detail"]


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
            "id", "lender_id", "branch_id", "officer_id", "type", "full_name", "business_name",
            "registration_number", "tax_id", "sector", "years_trading", "national_id", "phone",
            "residence", "occupation", "monthly_income", "next_of_kin", "blacklisted",
            "blacklist_reason", "created_at", "guarantors", "documents", "history",
        ]


class GuarantorWriteSerializer(serializers.Serializer):
    name = serializers.CharField()
    national_id = serializers.CharField()
    phone = serializers.CharField()
    consent_given = serializers.BooleanField(required=False, default=False)
    consent_date = serializers.DateField(required=False, allow_null=True)


class BorrowerCreateSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=BorrowerType.choices)
    branch_id = serializers.UUIDField()
    officer_id = serializers.UUIDField(required=False, allow_null=True)
    full_name = serializers.CharField()
    business_name = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    registration_number = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    tax_id = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    sector = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    years_trading = serializers.IntegerField(required=False, allow_null=True)
    national_id = serializers.CharField()
    phone = serializers.CharField()
    residence = serializers.CharField(required=False, allow_blank=True, default="")
    occupation = serializers.CharField(required=False, allow_blank=True, default="")
    monthly_income = serializers.FloatField(required=False, default=0)
    next_of_kin = serializers.CharField(required=False, allow_blank=True, default="")
    guarantors = GuarantorWriteSerializer(many=True, required=False, default=list)


class BorrowerUpdateSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=BorrowerType.choices, required=False)
    branch_id = serializers.UUIDField(required=False)
    officer_id = serializers.UUIDField(required=False, allow_null=True)
    full_name = serializers.CharField(required=False)
    business_name = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    registration_number = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    tax_id = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    sector = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    years_trading = serializers.IntegerField(required=False, allow_null=True)
    national_id = serializers.CharField(required=False)
    phone = serializers.CharField(required=False)
    residence = serializers.CharField(required=False, allow_blank=True)
    occupation = serializers.CharField(required=False, allow_blank=True)
    monthly_income = serializers.FloatField(required=False)
    next_of_kin = serializers.CharField(required=False, allow_blank=True)


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


class ApplicationSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    branch_id = Uuid()
    borrower_id = Uuid()
    product_id = Uuid()
    group_id = Uuid(allow_null=True)
    created_by = Uuid()
    approvals = ApprovalDecisionSerializer(many=True, read_only=True)

    class Meta:
        model = models.Application
        fields = [
            "id", "lender_id", "branch_id", "reference", "borrower_id", "product_id", "group_id", "amount",
            "term_instalments", "purpose", "status", "declared_income", "declared_expenses",
            "affordability_pass", "duplicate_check_pass", "blacklist_check_pass",
            "credit_bureau_consent", "score", "score_recommendation", "required_approver_role",
            "created_by", "created_at", "decline_reason", "approvals",
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


class ApplicationDecisionSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=enums.ApprovalDecisionType.choices)
    comment = serializers.CharField(allow_blank=True)


# --------------------------------------------------------------------------- loans

class ScheduleInstalmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.ScheduleInstalment
        fields = [
            "id", "period", "due_date", "principal_due", "interest_due", "fees_due",
            "penalty_due", "total_due", "paid_amount", "balance_after", "status",
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
            "group_id",
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
    allocation = serializers.SerializerMethodField()

    class Meta:
        model = models.Repayment
        fields = [
            "id", "lender_id", "loan_id", "amount", "date", "channel", "receipt_number",
            "allocation", "recorded_by", "reversed", "reversal_reason",
        ]

    def get_allocation(self, obj):
        return obj.allocation


class RepaymentCreateSerializer(serializers.Serializer):
    loan_id = serializers.UUIDField()
    amount = serializers.FloatField()
    channel = serializers.ChoiceField(choices=enums.RepaymentChannel.choices)


class RepaymentReverseSerializer(serializers.Serializer):
    reason = serializers.CharField()


# --------------------------------------------------------------------------- audit

class AuditLogEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = models.AuditLogEntry
        fields = ["id", "timestamp", "user_id", "user_name", "action", "entity", "entity_id", "details"]


class NotificationSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    borrower_id = Uuid(allow_null=True)

    class Meta:
        model = models.Notification
        fields = ["id", "lender_id", "borrower_id", "channel", "to", "kind", "body", "status", "error", "created_at", "sent_at"]


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField()
    new_password = serializers.CharField(min_length=6)


# --------------------------------------------------------------------- collections

class CollectionActivitySerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    loan_id = Uuid()
    borrower_id = Uuid()
    promise_status = serializers.SerializerMethodField()

    class Meta:
        model = models.CollectionActivity
        fields = [
            "id", "lender_id", "loan_id", "borrower_id", "kind", "outcome", "note",
            "promised_amount", "promised_date", "promise_status", "created_by", "created_at",
        ]

    def get_promise_status(self, obj):
        return getattr(obj, "_promise_status", None)


class GroupMembershipSerializer(serializers.ModelSerializer):
    borrower_id = Uuid()
    borrower_name = serializers.CharField(source="borrower.full_name", read_only=True)

    class Meta:
        model = models.GroupMembership
        fields = ["id", "borrower_id", "borrower_name", "role", "joined_on", "active"]


class BorrowerGroupSerializer(serializers.ModelSerializer):
    lender_id = Uuid()
    branch_id = Uuid()
    officer_id = Uuid()
    memberships = GroupMembershipSerializer(many=True, read_only=True)

    class Meta:
        model = models.BorrowerGroup
        fields = [
            "id", "lender_id", "branch_id", "officer_id", "name", "meeting_day",
            "meeting_frequency", "formed_on", "active", "created_at", "memberships",
        ]


class BorrowerGroupWriteSerializer(serializers.Serializer):
    name = serializers.CharField()
    branch_id = serializers.UUIDField()
    officer_id = serializers.UUIDField()
    meeting_day = serializers.CharField(required=False, allow_blank=True, default="")
    meeting_frequency = serializers.CharField(required=False, allow_blank=True, default="weekly")
    formed_on = serializers.DateField(required=False)


class GroupMemberAddSerializer(serializers.Serializer):
    borrower_id = serializers.UUIDField()
    role = serializers.ChoiceField(choices=models.GroupMembership.Role.choices, required=False, default="member")


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

    def validate(self, data):
        if data["kind"] == "promise" and not data.get("promised_amount"):
            raise serializers.ValidationError("A promise needs a promised amount")
        return data
