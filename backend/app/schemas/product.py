from app.models.enums import (
    FeeTiming,
    GracePeriodAppliesTo,
    InterestMethod,
    InterestPeriod,
    RepaymentFrequency,
    StaffRole,
)
from app.schemas.base import CamelModel


class ProductFeeSchema(CamelModel):
    id: str | None = None
    name: str
    kind: str  # 'fixed' | 'percent'
    value: float
    timing: FeeTiming


class ApprovalLevelSchema(CamelModel):
    id: str | None = None
    min_amount: float
    max_amount: float | None
    required_role: StaffRole


class LoanProductResponse(CamelModel):
    id: str
    lender_id: str
    name: str
    code: str
    active: bool
    interest_method: InterestMethod
    interest_rate: float
    interest_period: InterestPeriod
    repayment_frequency: RepaymentFrequency
    min_amount: float
    max_amount: float
    min_term_instalments: int
    max_term_instalments: int
    step_up_enabled: bool
    grace_period_days: int
    grace_period_applies_to: GracePeriodAppliesTo
    penalty_kind: str
    penalty_value: float
    penalty_cap: float
    allocation_order: list[str]
    security_required: list[str]
    fees: list[ProductFeeSchema] = []
    approval_levels: list[ApprovalLevelSchema] = []


class LoanProductWriteRequest(CamelModel):
    name: str
    code: str
    active: bool = True
    interest_method: InterestMethod
    interest_rate: float
    interest_period: InterestPeriod
    repayment_frequency: RepaymentFrequency
    min_amount: float
    max_amount: float
    min_term_instalments: int
    max_term_instalments: int
    step_up_enabled: bool = False
    grace_period_days: int = 0
    grace_period_applies_to: GracePeriodAppliesTo = GracePeriodAppliesTo.none
    penalty_kind: str
    penalty_value: float
    penalty_cap: float
    allocation_order: list[str]
    security_required: list[str]
    fees: list[ProductFeeSchema] = []
    approval_levels: list[ApprovalLevelSchema] = []


class ProductActiveRequest(CamelModel):
    active: bool


class SchedulePreviewRequest(CamelModel):
    amount: float
    term_instalments: int


class ScheduleRowSchema(CamelModel):
    period: int
    due_date: str
    principal_due: float
    interest_due: float
    fees_due: float
    penalty_due: float
    total_due: float
    balance_after: float
