from pydantic import EmailStr

from app.models.enums import StaffRole
from app.schemas.base import CamelModel


class LoginRequest(CamelModel):
    email: EmailStr
    password: str


class TokenResponse(CamelModel):
    access_token: str
    token_type: str = "bearer"


class RegisterLenderRequest(CamelModel):
    lender_name: str
    admin_name: str
    admin_email: EmailStr
    admin_password: str
    currency: str = "TZS"
    language: str = "sw"


class CurrentStaffResponse(CamelModel):
    id: str
    lender_id: str
    name: str
    email: str
    role: StaffRole
    branch_id: str | None
    approval_limit: float
