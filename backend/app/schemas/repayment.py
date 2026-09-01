from datetime import datetime

from app.models.enums import RepaymentChannel
from app.schemas.base import CamelModel


class RepaymentAllocation(CamelModel):
    penalty: float
    fees: float
    interest: float
    principal: float


class RepaymentResponse(CamelModel):
    id: str
    lender_id: str
    loan_id: str
    amount: float
    date: datetime
    channel: RepaymentChannel
    receipt_number: str
    allocation: RepaymentAllocation
    recorded_by: str
    reversed: bool
    reversal_reason: str | None


class RepaymentCreateRequest(CamelModel):
    loan_id: str
    amount: float
    channel: RepaymentChannel


class RepaymentReverseRequest(CamelModel):
    reason: str
