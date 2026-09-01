from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.core.deps import CurrentStaff, DbSession
from app.core.security import create_access_token, hash_password, verify_password
from app.models import Lender, Staff
from app.models.enums import StaffRole
from app.schemas.auth import (
    CurrentStaffResponse,
    LoginRequest,
    RegisterLenderRequest,
    TokenResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register_lender(body: RegisterLenderRequest, db: DbSession) -> TokenResponse:
    """Create a brand-new lender workspace with a single administrator account.

    Nothing else is seeded — the workspace starts empty by design.
    """
    existing = await db.scalar(select(Staff).where(Staff.email == body.admin_email.lower()))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email is already registered")

    lender = Lender(
        name=body.lender_name,
        currency=body.currency,
        language=body.language,
        logo_initials="".join(word[0] for word in body.lender_name.split()[:2]).upper(),
    )
    db.add(lender)
    await db.flush()

    admin = Staff(
        lender_id=lender.id,
        name=body.admin_name,
        email=body.admin_email.lower(),
        hashed_password=hash_password(body.admin_password),
        role=StaffRole.lender_admin,
        approval_limit=0,
        active=True,
    )
    db.add(admin)
    await db.commit()

    token = create_access_token(admin.id, {"lender_id": lender.id, "role": admin.role.value})
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: DbSession) -> TokenResponse:
    staff = await db.scalar(select(Staff).where(Staff.email == body.email.lower()))
    if staff is None or not verify_password(body.password, staff.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    if not staff.active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account has been suspended")

    token = create_access_token(staff.id, {"lender_id": staff.lender_id, "role": staff.role.value})
    return TokenResponse(access_token=token)


@router.get("/me", response_model=CurrentStaffResponse)
async def me(staff: CurrentStaff) -> Staff:
    return staff
