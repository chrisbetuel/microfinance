from pydantic import EmailStr

from app.models.enums import StaffRole
from app.schemas.base import CamelModel


class StaffResponse(CamelModel):
    id: str
    lender_id: str
    branch_id: str | None
    name: str
    email: str
    role: StaffRole
    approval_limit: float
    phone: str
    active: bool


class StaffCreateRequest(CamelModel):
    name: str
    email: EmailStr
    password: str
    role: StaffRole
    branch_id: str | None = None
    approval_limit: float = 0
    phone: str = ""


class StaffUpdateRequest(CamelModel):
    name: str | None = None
    role: StaffRole | None = None
    branch_id: str | None = None
    approval_limit: float | None = None
    phone: str | None = None
    active: bool | None = None
