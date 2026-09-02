from django.db import models


class StaffRole(models.TextChoices):
    PLATFORM_ADMIN = "platform_admin"
    LENDER_ADMIN = "lender_admin"
    BRANCH_MANAGER = "branch_manager"
    LOAN_OFFICER = "loan_officer"
    CREDIT_COMMITTEE = "credit_committee"
    CASHIER = "cashier"
    AUDITOR = "auditor"


class BorrowerType(models.TextChoices):
    INDIVIDUAL = "individual"
    BUSINESS = "business"


class InterestMethod(models.TextChoices):
    REDUCING = "reducing"
    FLAT = "flat"


class InterestPeriod(models.TextChoices):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class RepaymentFrequency(models.TextChoices):
    DAILY = "daily"
    WEEKLY = "weekly"
    FORTNIGHTLY = "fortnightly"
    MONTHLY = "monthly"


class FeeTiming(models.TextChoices):
    DEDUCTED = "deducted"
    ADDED = "added"


class GracePeriodAppliesTo(models.TextChoices):
    PRINCIPAL = "principal"
    INTEREST = "interest"
    BOTH = "both"
    NONE = "none"


class ApplicationStatus(models.TextChoices):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    DECLINED = "declined"
    DISBURSED = "disbursed"


class ScoreRecommendation(models.TextChoices):
    RECOMMEND = "recommend"
    CAUTION = "caution"
    DECLINE = "decline"


class ApprovalDecisionType(models.TextChoices):
    APPROVED = "approved"
    DECLINED = "declined"


class LoanStatus(models.TextChoices):
    PENDING_DISBURSEMENT = "pending_disbursement"
    ACTIVE = "active"
    CLOSED = "closed"
    WRITTEN_OFF = "written_off"


class InstalmentStatus(models.TextChoices):
    UPCOMING = "upcoming"
    DUE = "due"
    OVERDUE = "overdue"
    PAID = "paid"
    PARTIAL = "partial"


class DisbursementChannel(models.TextChoices):
    MOBILE_MONEY = "mobile_money"
    BANK_TRANSFER = "bank_transfer"
    SUPPLIER = "supplier"
    CASH = "cash"


class RepaymentChannel(models.TextChoices):
    MOBILE_MONEY = "mobile_money"
    BANK = "bank"
    CASH = "cash"
    FIELD = "field"
