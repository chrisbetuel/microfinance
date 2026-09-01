from datetime import datetime

from app.models.enums import ApplicationStatus, ApprovalDecisionType, ScoreRecommendation, StaffRole
from app.schemas.base import CamelModel


class ApprovalDecisionResponse(CamelModel):
    id: str
    approver_id: str
    approver_name: str
    role: StaffRole
    decision: ApprovalDecisionType
    date: datetime
    comment: str


class ApplicationResponse(CamelModel):
    id: str
    lender_id: str
    branch_id: str
    reference: str
    borrower_id: str
    product_id: str
    amount: float
    term_instalments: int
    purpose: str
    status: ApplicationStatus
    declared_income: float
    declared_expenses: float
    affordability_pass: bool
    duplicate_check_pass: bool
    blacklist_check_pass: bool
    credit_bureau_consent: bool
    score: int | None
    score_recommendation: ScoreRecommendation | None
    required_approver_role: StaffRole
    created_by: str
    created_at: datetime
    decline_reason: str | None
    approvals: list[ApprovalDecisionResponse] = []


class ApplicationCreateRequest(CamelModel):
    borrower_id: str
    product_id: str
    branch_id: str | None = None
    amount: float
    term_instalments: int
    purpose: str
    declared_income: float
    declared_expenses: float
    credit_bureau_consent: bool = False


class ApplicationDecisionRequest(CamelModel):
    decision: ApprovalDecisionType
    comment: str
