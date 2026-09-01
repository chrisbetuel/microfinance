import enum


class StaffRole(str, enum.Enum):
    platform_admin = "platform_admin"
    lender_admin = "lender_admin"
    branch_manager = "branch_manager"
    loan_officer = "loan_officer"
    credit_committee = "credit_committee"
    cashier = "cashier"
    auditor = "auditor"


class BorrowerType(str, enum.Enum):
    individual = "individual"
    business = "business"


class InterestMethod(str, enum.Enum):
    reducing = "reducing"
    flat = "flat"


class InterestPeriod(str, enum.Enum):
    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"


class RepaymentFrequency(str, enum.Enum):
    daily = "daily"
    weekly = "weekly"
    fortnightly = "fortnightly"
    monthly = "monthly"


class FeeTiming(str, enum.Enum):
    deducted = "deducted"
    added = "added"


class GracePeriodAppliesTo(str, enum.Enum):
    principal = "principal"
    interest = "interest"
    both = "both"
    none = "none"


class SecurityType(str, enum.Enum):
    guarantors = "guarantors"
    collateral = "collateral"
    group_guarantee = "group_guarantee"
    savings = "savings"
    none = "none"


class ApplicationStatus(str, enum.Enum):
    draft = "draft"
    submitted = "submitted"
    pending_approval = "pending_approval"
    approved = "approved"
    declined = "declined"
    disbursed = "disbursed"


class ScoreRecommendation(str, enum.Enum):
    recommend = "recommend"
    caution = "caution"
    decline = "decline"


class ApprovalDecisionType(str, enum.Enum):
    approved = "approved"
    declined = "declined"


class LoanStatus(str, enum.Enum):
    pending_disbursement = "pending_disbursement"
    active = "active"
    closed = "closed"
    written_off = "written_off"


class InstalmentStatus(str, enum.Enum):
    upcoming = "upcoming"
    due = "due"
    overdue = "overdue"
    paid = "paid"
    partial = "partial"


class DisbursementChannel(str, enum.Enum):
    mobile_money = "mobile_money"
    bank_transfer = "bank_transfer"
    supplier = "supplier"
    cash = "cash"


class RepaymentChannel(str, enum.Enum):
    mobile_money = "mobile_money"
    bank = "bank"
    cash = "cash"
    field = "field"


class AllocationBucket(str, enum.Enum):
    penalty = "penalty"
    fee = "fee"
    interest = "interest"
    principal = "principal"
