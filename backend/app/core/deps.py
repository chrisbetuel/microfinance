from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import Staff
from app.models.enums import StaffRole
from app.services import permissions

bearer_scheme = HTTPBearer(auto_error=False)

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_staff(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> Staff:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = decode_access_token(credentials.credentials)
    if payload is None or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    staff = await db.get(Staff, payload["sub"])
    if staff is None or not staff.active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found or suspended")
    return staff


CurrentStaff = Annotated[Staff, Depends(get_current_staff)]


def require_section(section: str):
    """Dependency factory: 403 unless the caller's role may see this section at all."""

    async def _dep(staff: CurrentStaff) -> Staff:
        if not permissions.has_section_access(staff.role, section):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Your role has no access to {section}")
        return staff

    return _dep


async def require_editor(staff: CurrentStaff) -> Staff:
    """The auditor role may read everything but must never write anything."""
    if not permissions.can_edit_data(staff.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your account has view-only access")
    return staff


RequireEditor = Annotated[Staff, Depends(require_editor)]


def require_section_editor(section: str):
    """Dependency factory for write endpoints: caller must both be an editor
    (not an auditor) and have their role's section access for `section`."""

    async def _dep(staff: CurrentStaff) -> Staff:
        if not permissions.can_edit_data(staff.role):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your account has view-only access")
        if not permissions.has_section_access(staff.role, section):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=f"Your role cannot make changes in {section}"
            )
        return staff

    return _dep


async def require_product_manager(staff: CurrentStaff) -> Staff:
    if not permissions.can_manage_products(staff.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a lender administrator can manage loan products",
        )
    return staff


RequireProductManager = Annotated[Staff, Depends(require_product_manager)]


async def require_admin(staff: CurrentStaff) -> Staff:
    if staff.role not in (StaffRole.lender_admin, StaffRole.platform_admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lender administrator access required")
    return staff


RequireAdmin = Annotated[Staff, Depends(require_admin)]
