from datetime import date, datetime

from app.models.enums import BorrowerType
from app.schemas.base import CamelModel


class GuarantorResponse(CamelModel):
    id: str
    name: str
    national_id: str
    phone: str
    consent_given: bool
    consent_date: date | None


class BorrowerDocumentResponse(CamelModel):
    id: str
    name: str
    type: str
    uploaded_at: datetime


class BorrowerHistoryEventResponse(CamelModel):
    id: str
    date: datetime
    label: str
    detail: str


class BorrowerResponse(CamelModel):
    id: str
    lender_id: str
    branch_id: str
    officer_id: str
    type: BorrowerType
    full_name: str
    business_name: str | None
    registration_number: str | None
    tax_id: str | None
    sector: str | None
    years_trading: int | None
    national_id: str
    phone: str
    residence: str
    occupation: str
    monthly_income: float
    next_of_kin: str
    blacklisted: bool
    blacklist_reason: str | None
    created_at: datetime
    guarantors: list[GuarantorResponse] = []
    documents: list[BorrowerDocumentResponse] = []
    history: list[BorrowerHistoryEventResponse] = []


class GuarantorWriteRequest(CamelModel):
    name: str
    national_id: str
    phone: str
    consent_given: bool = False
    consent_date: date | None = None


class BorrowerCreateRequest(CamelModel):
    type: BorrowerType
    branch_id: str
    officer_id: str | None = None
    full_name: str
    business_name: str | None = None
    registration_number: str | None = None
    tax_id: str | None = None
    sector: str | None = None
    years_trading: int | None = None
    national_id: str
    phone: str
    residence: str = ""
    occupation: str = ""
    monthly_income: float = 0
    next_of_kin: str = ""
    guarantors: list[GuarantorWriteRequest] = []


class BlacklistRequest(CamelModel):
    blacklisted: bool
    reason: str | None = None
