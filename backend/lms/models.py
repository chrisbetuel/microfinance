import uuid

from django.contrib.auth.base_user import AbstractBaseUser
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone

from lms import enums
from lms.managers import StaffManager


def uuid_pk() -> models.UUIDField:
    return models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)


class Lender(models.Model):
    id = uuid_pk()
    name = models.CharField(max_length=200)
    licence_number = models.CharField(max_length=100, blank=True, default="")
    licence_expiry = models.DateField(null=True, blank=True)
    address = models.CharField(max_length=300, blank=True, default="")
    phone = models.CharField(max_length=50, blank=True, default="")
    email = models.CharField(max_length=200, blank=True, default="")
    logo_initials = models.CharField(max_length=3, blank=True, default="")
    brand_color = models.CharField(max_length=7, default="#EE0033")
    currency = models.CharField(max_length=10, default="TZS")
    language = models.CharField(max_length=2, default="sw")
    plan_level = models.CharField(max_length=20, default="starter")
    staff_limit = models.IntegerField(default=10)
    active_loan_limit = models.IntegerField(default=500)
    sms_balance = models.IntegerField(default=25)  # trial credit for a new workspace
    sms_sender_name = models.CharField(max_length=11, blank=True, default="")
    sms_sender_approved = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)


class Branch(models.Model):
    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="branches")
    name = models.CharField(max_length=150)
    code = models.CharField(max_length=20)
    location = models.CharField(max_length=200, blank=True, default="")
    opened_on = models.DateField()

    class Meta:
        ordering = ["name"]


class Staff(AbstractBaseUser, PermissionsMixin):
    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="staff")
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    name = models.CharField(max_length=150)
    email = models.CharField(max_length=200, unique=True)
    role = models.CharField(max_length=30, choices=enums.StaffRole.choices)
    approval_limit = models.IntegerField(default=0)
    phone = models.CharField(max_length=50, blank=True, default="")
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)  # Django-admin access, not a lending role
    date_joined = models.DateTimeField(default=timezone.now)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    objects = StaffManager()

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "staff"

    def __str__(self) -> str:
        return f"{self.name} <{self.email}>"


class Holiday(models.Model):
    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="holidays")
    date = models.DateField()
    name = models.CharField(max_length=150)

    class Meta:
        ordering = ["date"]


class Borrower(models.Model):
    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="borrowers")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    officer = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name="+")
    type = models.CharField(max_length=20, choices=enums.BorrowerType.choices)

    full_name = models.CharField(max_length=200)
    business_name = models.CharField(max_length=200, null=True, blank=True)
    registration_number = models.CharField(max_length=100, null=True, blank=True)
    tax_id = models.CharField(max_length=100, null=True, blank=True)
    sector = models.CharField(max_length=150, null=True, blank=True)
    years_trading = models.IntegerField(null=True, blank=True)

    national_id = models.CharField(max_length=100, db_index=True)
    phone = models.CharField(max_length=50)
    residence = models.CharField(max_length=250, blank=True, default="")
    occupation = models.CharField(max_length=150, blank=True, default="")
    monthly_income = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    next_of_kin = models.CharField(max_length=200, blank=True, default="")

    blacklisted = models.BooleanField(default=False)
    blacklist_reason = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]


class Guarantor(models.Model):
    id = uuid_pk()
    borrower = models.ForeignKey(Borrower, on_delete=models.CASCADE, related_name="guarantors")
    name = models.CharField(max_length=200)
    national_id = models.CharField(max_length=100)
    phone = models.CharField(max_length=50)
    consent_given = models.BooleanField(default=False)
    consent_date = models.DateField(null=True, blank=True)


class BorrowerDocument(models.Model):
    id = uuid_pk()
    borrower = models.ForeignKey(Borrower, on_delete=models.CASCADE, related_name="documents")
    name = models.CharField(max_length=200)
    type = models.CharField(max_length=100)
    uploaded_at = models.DateTimeField(default=timezone.now)


class BorrowerHistoryEvent(models.Model):
    id = uuid_pk()
    borrower = models.ForeignKey(Borrower, on_delete=models.CASCADE, related_name="history")
    date = models.DateTimeField(default=timezone.now)
    label = models.CharField(max_length=200)
    detail = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["date"]


class LoanProduct(models.Model):
    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="products")
    name = models.CharField(max_length=150)
    code = models.CharField(max_length=20)
    active = models.BooleanField(default=True)

    interest_method = models.CharField(max_length=20, choices=enums.InterestMethod.choices)
    interest_rate = models.DecimalField(max_digits=6, decimal_places=3)
    interest_period = models.CharField(max_length=20, choices=enums.InterestPeriod.choices)
    repayment_frequency = models.CharField(max_length=20, choices=enums.RepaymentFrequency.choices)

    min_amount = models.DecimalField(max_digits=14, decimal_places=2)
    max_amount = models.DecimalField(max_digits=14, decimal_places=2)
    min_term_instalments = models.IntegerField()
    max_term_instalments = models.IntegerField()
    step_up_enabled = models.BooleanField(default=False)

    grace_period_days = models.IntegerField(default=0)
    grace_period_applies_to = models.CharField(
        max_length=20, choices=enums.GracePeriodAppliesTo.choices, default=enums.GracePeriodAppliesTo.NONE
    )

    penalty_kind = models.CharField(max_length=10)  # 'fixed' | 'percent'
    penalty_value = models.DecimalField(max_digits=10, decimal_places=2)
    penalty_cap = models.DecimalField(max_digits=14, decimal_places=2)

    allocation_order = models.JSONField(default=list)
    security_required = models.JSONField(default=list)

    class Meta:
        ordering = ["name"]


class ProductFee(models.Model):
    id = uuid_pk()
    product = models.ForeignKey(LoanProduct, on_delete=models.CASCADE, related_name="fees")
    name = models.CharField(max_length=150)
    kind = models.CharField(max_length=10)  # 'fixed' | 'percent'
    value = models.DecimalField(max_digits=10, decimal_places=2)
    timing = models.CharField(max_length=20, choices=enums.FeeTiming.choices)


class ApprovalLevel(models.Model):
    id = uuid_pk()
    product = models.ForeignKey(LoanProduct, on_delete=models.CASCADE, related_name="approval_levels")
    min_amount = models.DecimalField(max_digits=14, decimal_places=2)
    max_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    required_role = models.CharField(max_length=30, choices=enums.StaffRole.choices)

    class Meta:
        ordering = ["min_amount"]


class Application(models.Model):
    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="applications")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    reference = models.CharField(max_length=30, db_index=True)

    borrower = models.ForeignKey(Borrower, on_delete=models.PROTECT, related_name="applications")
    product = models.ForeignKey(LoanProduct, on_delete=models.PROTECT, related_name="+")

    amount = models.DecimalField(max_digits=14, decimal_places=2)
    term_instalments = models.IntegerField()
    purpose = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=20, choices=enums.ApplicationStatus.choices, default=enums.ApplicationStatus.PENDING_APPROVAL
    )

    declared_income = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    declared_expenses = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    affordability_pass = models.BooleanField(default=True)
    duplicate_check_pass = models.BooleanField(default=True)
    blacklist_check_pass = models.BooleanField(default=True)
    credit_bureau_consent = models.BooleanField(default=False)

    score = models.IntegerField(null=True, blank=True)
    score_recommendation = models.CharField(
        max_length=20, choices=enums.ScoreRecommendation.choices, null=True, blank=True
    )

    required_approver_role = models.CharField(max_length=30, choices=enums.StaffRole.choices)
    created_by = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name="+")
    decline_reason = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]


class ApprovalDecision(models.Model):
    id = uuid_pk()
    application = models.ForeignKey(Application, on_delete=models.CASCADE, related_name="approvals")
    approver = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name="+")
    approver_name = models.CharField(max_length=150, blank=True, default="")
    role = models.CharField(max_length=30, choices=enums.StaffRole.choices)
    decision = models.CharField(max_length=20, choices=enums.ApprovalDecisionType.choices)
    date = models.DateTimeField(default=timezone.now)
    comment = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["date"]


class Loan(models.Model):
    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="loans")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    application = models.OneToOneField(Application, on_delete=models.PROTECT, related_name="loan")
    borrower = models.ForeignKey(Borrower, on_delete=models.PROTECT, related_name="loans")
    product = models.ForeignKey(LoanProduct, on_delete=models.PROTECT, related_name="+")

    principal = models.DecimalField(max_digits=14, decimal_places=2)
    net_disbursed = models.DecimalField(max_digits=14, decimal_places=2)
    fees_deducted = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(max_length=25, choices=enums.LoanStatus.choices, default=enums.LoanStatus.ACTIVE)
    outstanding_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    disbursement_channel = models.CharField(max_length=20, choices=enums.DisbursementChannel.choices)
    disbursement_date = models.DateTimeField()
    disbursement_reference = models.CharField(max_length=100)
    disbursement_approved_by = models.CharField(max_length=150)
    disbursement_disbursed_by = models.CharField(max_length=150)

    # Maintained by the daily `age_loans` job.
    days_in_arrears = models.IntegerField(default=0)
    arrears_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    aged_at = models.DateTimeField(null=True, blank=True)

    # Principal the *current* schedule was generated from (= principal at
    # disbursement; changes when the loan is restructured).
    schedule_principal = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    restructure_count = models.IntegerField(default=0)
    restructured_at = models.DateTimeField(null=True, blank=True)

    closed_at = models.DateTimeField(null=True, blank=True)
    closure_reason = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]

    @property
    def disbursement(self):
        if self.disbursement_date is None:
            return None
        return {
            "channel": self.disbursement_channel,
            "date": self.disbursement_date,
            "reference": self.disbursement_reference,
            "approved_by": self.disbursement_approved_by,
            "disbursed_by": self.disbursement_disbursed_by,
        }


class ScheduleInstalment(models.Model):
    id = uuid_pk()
    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="schedule")
    period = models.IntegerField()
    due_date = models.DateField()
    principal_due = models.DecimalField(max_digits=14, decimal_places=2)
    interest_due = models.DecimalField(max_digits=14, decimal_places=2)
    fees_due = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    penalty_due = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_due = models.DecimalField(max_digits=14, decimal_places=2)
    paid_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    balance_after = models.DecimalField(max_digits=14, decimal_places=2)
    status = models.CharField(
        max_length=20, choices=enums.InstalmentStatus.choices, default=enums.InstalmentStatus.UPCOMING
    )

    class Meta:
        ordering = ["period"]


class Repayment(models.Model):
    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="repayments")
    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="repayments")

    amount = models.DecimalField(max_digits=14, decimal_places=2)
    date = models.DateTimeField(default=timezone.now)
    channel = models.CharField(max_length=20, choices=enums.RepaymentChannel.choices)
    receipt_number = models.CharField(max_length=30, db_index=True)

    allocation_penalty = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    allocation_fees = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    allocation_interest = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    allocation_principal = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    allocation_remainder = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    recorded_by = models.CharField(max_length=150)
    reversed = models.BooleanField(default=False)
    reversal_reason = models.TextField(null=True, blank=True)

    class Meta:
        ordering = ["-date"]

    @property
    def allocation(self):
        return {
            "penalty": self.allocation_penalty,
            "fees": self.allocation_fees,
            "interest": self.allocation_interest,
            "principal": self.allocation_principal,
            "remainder": self.allocation_remainder,
        }


class AuditLogEntry(models.Model):
    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="audit_entries")
    timestamp = models.DateTimeField(default=timezone.now)
    user_id = models.CharField(max_length=36)
    user_name = models.CharField(max_length=150)
    action = models.CharField(max_length=50)
    entity = models.CharField(max_length=50)
    entity_id = models.CharField(max_length=36)
    details = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-timestamp"]


class TillReconciliation(models.Model):
    """A cashier's end-of-day count of the physical cash drawer."""

    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="till_reconciliations")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+", null=True, blank=True)
    cashier_name = models.CharField(max_length=150)
    business_date = models.DateField()
    opening_float = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    cash_in = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    cash_out = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    expected_close = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    counted_close = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    variance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    note = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-business_date", "-created_at"]


class CollectionActivity(models.Model):
    """A contact attempt, field visit, note or promise-to-pay logged against an
    overdue loan. Drives the collections workbench."""

    class Kind(models.TextChoices):
        CALL = "call"
        VISIT = "visit"
        MESSAGE = "message"
        NOTE = "note"
        PROMISE = "promise"

    class Outcome(models.TextChoices):
        REACHED = "reached"
        NO_ANSWER = "no_answer"
        PROMISED = "promised"
        DISPUTED = "disputed"
        PAID = "paid"
        OTHER = "other"

    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="collection_activities")
    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="collection_activities")
    borrower = models.ForeignKey(Borrower, on_delete=models.PROTECT, related_name="+")
    kind = models.CharField(max_length=12, choices=Kind.choices)
    outcome = models.CharField(max_length=12, choices=Outcome.choices, blank=True, default="")
    note = models.TextField(blank=True, default="")
    promised_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    promised_date = models.DateField(null=True, blank=True)
    created_by = models.CharField(max_length=150)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]


class Notification(models.Model):
    """An outbound message (SMS/email). Written by lms.services.notify; delivered
    by whichever backend is configured. Kept so the workspace has a message log."""

    class Channel(models.TextChoices):
        SMS = "sms"
        EMAIL = "email"

    class Status(models.TextChoices):
        QUEUED = "queued"
        SENT = "sent"
        FAILED = "failed"

    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="notifications")
    borrower = models.ForeignKey(Borrower, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    channel = models.CharField(max_length=10, choices=Channel.choices, default=Channel.SMS)
    to = models.CharField(max_length=200)
    kind = models.CharField(max_length=40)  # receipt | disbursed | decision | arrears_reminder ...
    body = models.TextField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.QUEUED)
    error = models.CharField(max_length=250, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
