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
    # Minutes of inactivity before a signed-in user is automatically logged out.
    session_timeout_minutes = models.IntegerField(default=20)
    # disbursements of this amount or more need two different authorisers (0 = never)
    dual_authorisation_threshold = models.DecimalField(max_digits=14, decimal_places=2, default=5_000_000)
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

    class Status(models.TextChoices):
        ACTIVE = "active"
        INACTIVE = "inactive"
        SUSPENDED = "suspended"
        BLACKLISTED = "blacklisted"

    customer_number = models.CharField(max_length=20, blank=True, default="", db_index=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)

    # verification — set by staff after checking NIDA, phone and documents
    verified = models.BooleanField(default=False)
    phone_verified = models.BooleanField(default=False)
    verified_by = models.CharField(max_length=150, blank=True, default="")
    verified_at = models.DateTimeField(null=True, blank=True)
    dependents = models.IntegerField(null=True, blank=True)

    # 1. personal
    national_id = models.CharField(max_length=100, db_index=True)
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=10, blank=True, default="")
    marital_status = models.CharField(max_length=20, blank=True, default="")
    phone = models.CharField(max_length=50)
    alt_phone = models.CharField(max_length=50, blank=True, default="")
    email = models.CharField(max_length=200, blank=True, default="")

    # 2. address  (residence = physical address)
    region = models.CharField(max_length=100, blank=True, default="")
    district = models.CharField(max_length=100, blank=True, default="")
    ward = models.CharField(max_length=100, blank=True, default="")
    street = models.CharField(max_length=150, blank=True, default="")
    residence = models.CharField(max_length=250, blank=True, default="")
    postal_address = models.CharField(max_length=150, blank=True, default="")

    # 3. employment / business  (sector = business type, years_trading = years in business)
    income_source = models.CharField(max_length=12, blank=True, default="")  # employed | business | other
    occupation = models.CharField(max_length=150, blank=True, default="")
    employer_name = models.CharField(max_length=200, blank=True, default="")
    job_title = models.CharField(max_length=150, blank=True, default="")
    employment_type = models.CharField(max_length=30, blank=True, default="")
    years_employed = models.IntegerField(null=True, blank=True)
    business_location = models.CharField(max_length=200, blank=True, default="")

    # 4. financial
    monthly_income = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    monthly_expenses = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    other_income_sources = models.CharField(max_length=250, blank=True, default="")
    existing_loans = models.CharField(max_length=250, blank=True, default="")
    existing_loan_payments = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    bank_name = models.CharField(max_length=100, blank=True, default="")
    bank_account = models.CharField(max_length=50, blank=True, default="")
    mobile_money_provider = models.CharField(max_length=50, blank=True, default="")
    mobile_money_number = models.CharField(max_length=50, blank=True, default="")

    # 5. emergency contact  (next_of_kin kept for older records)
    next_of_kin = models.CharField(max_length=200, blank=True, default="")
    emergency_name = models.CharField(max_length=200, blank=True, default="")
    emergency_relationship = models.CharField(max_length=60, blank=True, default="")
    emergency_phone = models.CharField(max_length=50, blank=True, default="")
    emergency_address = models.CharField(max_length=250, blank=True, default="")

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
    relationship = models.CharField(max_length=60, blank=True, default="")
    address = models.CharField(max_length=250, blank=True, default="")
    occupation = models.CharField(max_length=200, blank=True, default="")
    monthly_income = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    guarantee_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(max_length=12, default="pending")  # pending | approved | rejected
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

    # % of principal taken at disbursement into the borrower's compulsory
    # savings account (held as partial security, released on loan closure).
    compulsory_savings_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0)

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
    group = models.ForeignKey("BorrowerGroup", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    # `amount`/`term_instalments` are the working terms: the request until an
    # approver approves a different amount, which then becomes the loan.
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    term_instalments = models.IntegerField()
    requested_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    requested_term = models.IntegerField(default=0)
    purpose = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=20, choices=enums.ApplicationStatus.choices, default=enums.ApplicationStatus.SUBMITTED
    )
    loan_officer = models.ForeignKey(Staff, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    application_date = models.DateField(default=timezone.localdate)
    disbursement_method = models.CharField(max_length=20, choices=enums.DisbursementChannel.choices, blank=True, default="")
    first_repayment_date = models.DateField(null=True, blank=True)
    group_members = models.ManyToManyField(Borrower, blank=True, related_name="+")
    guarantors = models.ManyToManyField("Guarantor", blank=True, related_name="applications")
    collateral = models.ManyToManyField("Collateral", blank=True, related_name="applications")

    # financial assessment (monthly figures)
    other_income = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    business_income = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    business_expenses = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    existing_loans_count = models.IntegerField(default=0)
    existing_repayments = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    dependents = models.IntegerField(default=0)

    # loan officer's assessment
    assessment_result = models.CharField(max_length=20, choices=enums.AssessmentResult.choices, blank=True, default="")
    assessed_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    recommended_term = models.IntegerField(null=True, blank=True)
    assessment_notes = models.TextField(blank=True, default="")
    assessed_by = models.ForeignKey(Staff, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    assessed_at = models.DateTimeField(null=True, blank=True)

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
    # risk indicators computed at intake (see services/applications.assess)
    risk = models.JSONField(default=dict, blank=True)
    needs_review = models.BooleanField(default=False)

    required_approver_role = models.CharField(max_length=30, choices=enums.StaffRole.choices)
    created_by = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name="+")
    decline_reason = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]


class ApplicationDocument(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending"
        VERIFIED = "verified"
        REJECTED = "rejected"

    id = uuid_pk()
    application = models.ForeignKey(Application, on_delete=models.CASCADE, related_name="documents")
    type = models.CharField(max_length=60)
    name = models.CharField(max_length=200)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    note = models.CharField(max_length=250, blank=True, default="")
    verified_by = models.CharField(max_length=150, blank=True, default="")
    verified_at = models.DateTimeField(null=True, blank=True)
    uploaded_by = models.CharField(max_length=150, blank=True, default="")
    uploaded_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["uploaded_at"]


class ApplicationEvent(models.Model):
    """One step through the approval workflow: who moved the application to which stage."""

    id = uuid_pk()
    application = models.ForeignKey(Application, on_delete=models.CASCADE, related_name="events")
    stage = models.CharField(max_length=20, choices=enums.ApplicationStatus.choices)
    label = models.CharField(max_length=150)
    note = models.TextField(blank=True, default="")
    by = models.CharField(max_length=150, blank=True, default="")
    at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["at"]


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
    loan_number = models.CharField(max_length=20, blank=True, default="", db_index=True)  # LN-000245
    borrower = models.ForeignKey(Borrower, on_delete=models.PROTECT, related_name="loans")
    product = models.ForeignKey(LoanProduct, on_delete=models.PROTECT, related_name="+")
    group = models.ForeignKey("BorrowerGroup", on_delete=models.SET_NULL, null=True, blank=True, related_name="loans")

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

    savings_deducted = models.DecimalField(max_digits=14, decimal_places=2, default=0)

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
    # set by the aging job the first time this instalment goes overdue — the
    # borrower's late-payment history survives the instalment later being paid
    was_late = models.BooleanField(default=False)

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
    # {field: {"before": …, "after": …}} for edits
    changes = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-timestamp"]


class BorrowerGroup(models.Model):
    """A joint-liability / solidarity group. Members guarantee each other's loans."""

    class Status(models.TextChoices):
        PENDING = "pending"
        ACTIVE = "active"
        SUSPENDED = "suspended"
        CLOSED = "closed"

    class Meta:
        ordering = ["name"]

    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="groups")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    officer = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name="+")
    group_number = models.CharField(max_length=20, blank=True, default="", db_index=True)
    name = models.CharField(max_length=150)
    group_type = models.CharField(max_length=20, blank=True, default="general")
    purpose = models.TextField(blank=True, default="")
    # location
    region = models.CharField(max_length=100, blank=True, default="")
    district = models.CharField(max_length=100, blank=True, default="")
    ward = models.CharField(max_length=100, blank=True, default="")
    location = models.CharField(max_length=200, blank=True, default="")
    # meetings
    meeting_location = models.CharField(max_length=200, blank=True, default="")
    meeting_day = models.CharField(max_length=12, blank=True, default="")  # e.g. "Tuesday"
    meeting_frequency = models.CharField(max_length=12, blank=True, default="weekly")  # weekly | biweekly | monthly
    meeting_time = models.CharField(max_length=10, blank=True, default="")
    # finance
    loan_limit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    formed_on = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    active = models.BooleanField(default=True)  # mirrors status == active, kept for older code
    created_at = models.DateTimeField(default=timezone.now)


class GroupMembership(models.Model):
    class Role(models.TextChoices):
        MEMBER = "member"
        CHAIR = "chair"
        SECRETARY = "secretary"
        TREASURER = "treasurer"

    class Status(models.TextChoices):
        ACTIVE = "active"
        INACTIVE = "inactive"
        SUSPENDED = "suspended"
        LEFT = "left"

    id = uuid_pk()
    group = models.ForeignKey(BorrowerGroup, on_delete=models.CASCADE, related_name="memberships")
    borrower = models.ForeignKey(Borrower, on_delete=models.PROTECT, related_name="group_memberships")
    membership_number = models.CharField(max_length=30, blank=True, default="")
    role = models.CharField(max_length=12, choices=Role.choices, default=Role.MEMBER)
    joined_on = models.DateField(default=timezone.now)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    left_on = models.DateField(null=True, blank=True)
    active = models.BooleanField(default=True)  # mirrors status == active

    class Meta:
        unique_together = [("group", "borrower")]
        ordering = ["role", "joined_on"]


class GroupMeeting(models.Model):
    id = uuid_pk()
    group = models.ForeignKey(BorrowerGroup, on_delete=models.CASCADE, related_name="meetings")
    date = models.DateField()
    location = models.CharField(max_length=200, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    collection_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    recorded_by = models.CharField(max_length=150)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-date", "-created_at"]


class GroupAttendance(models.Model):
    id = uuid_pk()
    meeting = models.ForeignKey(GroupMeeting, on_delete=models.CASCADE, related_name="attendance")
    membership = models.ForeignKey(GroupMembership, on_delete=models.CASCADE, related_name="+")
    present = models.BooleanField(default=True)
    contribution = models.DecimalField(max_digits=14, decimal_places=2, default=0)


class GroupDocument(models.Model):
    id = uuid_pk()
    group = models.ForeignKey(BorrowerGroup, on_delete=models.CASCADE, related_name="documents")
    name = models.CharField(max_length=200)
    type = models.CharField(max_length=100)
    uploaded_at = models.DateTimeField(default=timezone.now)


class GroupHistoryEvent(models.Model):
    id = uuid_pk()
    group = models.ForeignKey(BorrowerGroup, on_delete=models.CASCADE, related_name="history")
    date = models.DateTimeField(default=timezone.now)
    label = models.CharField(max_length=200)
    detail = models.TextField(blank=True, default="")
    by = models.CharField(max_length=150, blank=True, default="")

    class Meta:
        ordering = ["-date"]


class SavingsAccount(models.Model):
    """A borrower's compulsory-savings account. One per borrower per lender."""

    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="savings_accounts")
    borrower = models.OneToOneField(Borrower, on_delete=models.PROTECT, related_name="savings_account")
    balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    created_at = models.DateTimeField(default=timezone.now)


class SavingsTransaction(models.Model):
    class Kind(models.TextChoices):
        DEPOSIT = "deposit"
        WITHDRAWAL = "withdrawal"
        LOAN_DEDUCTION = "loan_deduction"
        RELEASE = "release"

    id = uuid_pk()
    account = models.ForeignKey(SavingsAccount, on_delete=models.CASCADE, related_name="transactions")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    balance_after = models.DecimalField(max_digits=14, decimal_places=2)
    note = models.CharField(max_length=250, blank=True, default="")
    created_by = models.CharField(max_length=150)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]


class Collateral(models.Model):
    class Status(models.TextChoices):
        PLEDGED = "pledged"      # recorded, not yet securing an active loan
        ACTIVE = "active"        # securing an active loan
        RELEASED = "released"    # loan repaid, returned to owner
        SEIZED = "seized"        # taken after default

    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="collateral")
    borrower = models.ForeignKey(Borrower, on_delete=models.PROTECT, related_name="collateral")
    loan = models.ForeignKey("Loan", on_delete=models.SET_NULL, null=True, blank=True, related_name="collateral")
    asset_type = models.CharField(max_length=60)
    description = models.CharField(max_length=250)
    estimated_value = models.DecimalField(max_digits=14, decimal_places=2)
    owner_name = models.CharField(max_length=200, blank=True, default="")
    ownership_document = models.CharField(max_length=200, blank=True, default="")  # title deed / card no.
    valuation_date = models.DateField(null=True, blank=True)
    valued_by = models.CharField(max_length=150, blank=True, default="")
    existing_claims = models.CharField(max_length=250, blank=True, default="")  # liens / other lenders
    documents = models.JSONField(default=list, blank=True)  # supporting document names
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PLEDGED)
    created_by = models.CharField(max_length=150)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]


class PaymentTransaction(models.Model):
    """A mobile-money / online payment through the gateway. Inbound = customer
    paying a loan instalment; outbound = disbursing a loan to the customer.
    Settled asynchronously by the gateway callback."""

    class Direction(models.TextChoices):
        INBOUND = "inbound"
        OUTBOUND = "outbound"

    class Status(models.TextChoices):
        PENDING = "pending"
        SUCCESS = "success"
        FAILED = "failed"

    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="payment_transactions")
    reference = models.CharField(max_length=30, db_index=True)  # our id, sent to the gateway
    direction = models.CharField(max_length=10, choices=Direction.choices)
    network = models.CharField(max_length=20)  # mpesa | tigopesa | airtel | halopesa | bank
    provider = models.CharField(max_length=30)
    provider_ref = models.CharField(max_length=100, blank=True, default="", db_index=True)
    phone = models.CharField(max_length=50)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    borrower = models.ForeignKey(Borrower, on_delete=models.PROTECT, related_name="+")
    loan = models.ForeignKey("Loan", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    application = models.ForeignKey(Application, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    repayment = models.ForeignKey("Repayment", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    failure_reason = models.CharField(max_length=250, blank=True, default="")
    receipt = models.CharField(max_length=100, blank=True, default="")  # network receipt, e.g. M-Pesa code
    initiated_by = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)
    completed_at = models.DateTimeField(null=True, blank=True)
    callback_payload = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]


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
        ESCALATION = "escalation"

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
    segments = models.IntegerField(default=1)
    provider_ref = models.CharField(max_length=100, blank=True, default="")
    sent_by = models.CharField(max_length=150, blank=True, default="System")
    batch = models.CharField(max_length=40, blank=True, default="")  # groups a bulk send
    created_at = models.DateTimeField(default=timezone.now)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class Disbursement(models.Model):
    """One attempt to release an approved loan. See services/disbursements.py."""

    class Status(models.TextChoices):
        PENDING = "pending"                        # prepared
        UNDER_VERIFICATION = "under_verification"
        APPROVED = "approved"                      # authorised for release
        PROCESSING = "processing"                  # money released, awaiting confirmation
        SUCCESSFUL = "successful"
        FAILED = "failed"
        CANCELLED = "cancelled"
        REVERSED = "reversed"

    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="disbursements")
    number = models.CharField(max_length=20, db_index=True)  # DIS-000124
    application = models.ForeignKey(Application, on_delete=models.RESTRICT, related_name="disbursements")
    loan = models.ForeignKey("Loan", on_delete=models.SET_NULL, null=True, blank=True, related_name="disbursements")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)

    # amounts
    approved_amount = models.DecimalField(max_digits=14, decimal_places=2)
    fees = models.JSONField(default=list, blank=True)  # [{name, amount}]
    fees_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    insurance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    savings_deducted = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    other_deductions = models.JSONField(default=list, blank=True)  # [{label, amount}]
    net_amount = models.DecimalField(max_digits=14, decimal_places=2)

    # destination
    method = models.CharField(max_length=20, choices=enums.DisbursementChannel.choices)
    recipient_type = models.CharField(max_length=12, default="borrower")  # borrower | third_party
    recipient_name = models.CharField(max_length=200, blank=True, default="")
    recipient_provider = models.CharField(max_length=100, blank=True, default="")  # bank / network
    recipient_account = models.CharField(max_length=100, blank=True, default="")  # account or phone
    authorisation_note = models.CharField(max_length=250, blank=True, default="")
    destination_verified = models.BooleanField(default=False)
    warnings = models.JSONField(default=list, blank=True)

    # controls
    requires_dual_authorisation = models.BooleanField(default=False)
    checks = models.JSONField(default=dict, blank=True)
    override_reason = models.CharField(max_length=250, blank=True, default="")
    prepared_by = models.ForeignKey(Staff, on_delete=models.RESTRICT, related_name="+")
    prepared_at = models.DateTimeField(default=timezone.now)
    verified_by = models.ForeignKey(Staff, on_delete=models.RESTRICT, null=True, blank=True, related_name="+")
    verified_at = models.DateTimeField(null=True, blank=True)
    authorised_by = models.ForeignKey(Staff, on_delete=models.RESTRICT, null=True, blank=True, related_name="+")
    authorised_at = models.DateTimeField(null=True, blank=True)
    second_authorised_by = models.ForeignKey(Staff, on_delete=models.RESTRICT, null=True, blank=True, related_name="+")
    second_authorised_at = models.DateTimeField(null=True, blank=True)
    processed_by = models.ForeignKey(Staff, on_delete=models.RESTRICT, null=True, blank=True, related_name="+")
    processed_at = models.DateTimeField(null=True, blank=True)
    confirmed_by = models.ForeignKey(Staff, on_delete=models.RESTRICT, null=True, blank=True, related_name="+")
    confirmed_at = models.DateTimeField(null=True, blank=True)

    # transaction
    transaction_reference = models.CharField(max_length=100, blank=True, default="")
    payment = models.ForeignKey("PaymentTransaction", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    failure_reason = models.CharField(max_length=250, blank=True, default="")
    cancel_reason = models.CharField(max_length=250, blank=True, default="")
    reversal_reason = models.CharField(max_length=250, blank=True, default="")
    reversed_by = models.ForeignKey(Staff, on_delete=models.RESTRICT, null=True, blank=True, related_name="+")
    reversed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]


class DisbursementEvent(models.Model):
    id = uuid_pk()
    disbursement = models.ForeignKey(Disbursement, on_delete=models.CASCADE, related_name="events")
    status = models.CharField(max_length=20, choices=Disbursement.Status.choices)
    action = models.CharField(max_length=150)
    note = models.TextField(blank=True, default="")
    changes = models.JSONField(default=dict, blank=True)
    by = models.CharField(max_length=150, blank=True, default="")
    at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["at"]


class LedgerEntry(models.Model):
    """One line of a balanced journal. Never edited: mistakes are reversed with a new journal."""

    id = uuid_pk()
    lender = models.ForeignKey(Lender, on_delete=models.CASCADE, related_name="ledger_entries")
    journal = models.CharField(max_length=20, db_index=True)  # JNL-000001; lines of one posting share it
    date = models.DateTimeField(default=timezone.now)
    account = models.CharField(max_length=30, db_index=True)
    debit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    description = models.CharField(max_length=250)
    reference = models.CharField(max_length=100, blank=True, default="")
    loan = models.ForeignKey("Loan", on_delete=models.RESTRICT, null=True, blank=True, related_name="ledger_entries")
    disbursement = models.ForeignKey(Disbursement, on_delete=models.RESTRICT, null=True, blank=True, related_name="ledger_entries")
    repayment = models.ForeignKey("Repayment", on_delete=models.RESTRICT, null=True, blank=True, related_name="ledger_entries")
    created_by = models.CharField(max_length=150, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["date", "journal"]
