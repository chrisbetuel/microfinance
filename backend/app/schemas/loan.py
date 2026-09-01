from datetime import date, datetime

from app.models.enums import DisbursementChannel, InstalmentStatus, LoanStatus
from app.schemas.base import CamelModel


class ScheduleInstalmentResponse(CamelModel):
    id: str
    period: int
    due_date: date
    principal_due: float
    interest_due: float
    fees_due: float
    penalty_due: float
    total_due: float
    paid_amount: float
    balance_after: float
    status: InstalmentStatus


class DisbursementInfo(CamelModel):
    channel: DisbursementChannel
    date: datetime
    reference: str
    approved_by: str
    disbursed_by: str


class LoanResponse(CamelModel):
    id: str
    lender_id: str
    branch_id: str
    application_id: str
    borrower_id: str
    product_id: str
    principal: float
    net_disbursed: float
    fees_deducted: float
    status: LoanStatus
    outstanding_balance: float
    disbursement: DisbursementInfo | None
    created_at: datetime
    schedule: list[ScheduleInstalmentResponse] = []


class DisburseRequest(CamelModel):
    channel: DisbursementChannel
    reference: str
