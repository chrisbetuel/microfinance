from datetime import date

from app.schemas.base import CamelModel


class LenderResponse(CamelModel):
    id: str
    name: str
    licence_number: str
    licence_expiry: date | None
    address: str
    phone: str
    email: str
    logo_initials: str
    brand_color: str
    currency: str
    language: str
    plan_level: str
    staff_limit: int
    active_loan_limit: int
    sms_balance: int
    sms_sender_name: str
    sms_sender_approved: bool


class LenderUpdateRequest(CamelModel):
    name: str | None = None
    licence_number: str | None = None
    licence_expiry: date | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    logo_initials: str | None = None
    brand_color: str | None = None
    currency: str | None = None
    language: str | None = None
