from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.core.deps import CurrentStaff, DbSession, require_section
from app.models import AuditLogEntry
from app.schemas.audit import AuditLogEntryResponse

router = APIRouter(
    prefix="/audit",
    tags=["audit"],
    dependencies=[Depends(require_section("audit"))],
)


@router.get("", response_model=list[AuditLogEntryResponse])
async def list_audit_log(staff: CurrentStaff, db: DbSession, limit: int = 500) -> list[AuditLogEntry]:
    result = await db.scalars(
        select(AuditLogEntry)
        .where(AuditLogEntry.lender_id == staff.lender_id)
        .order_by(AuditLogEntry.timestamp.desc())
        .limit(min(limit, 1000))
    )
    return list(result)
