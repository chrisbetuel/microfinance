from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLogEntry, Staff


async def record(
    db: AsyncSession,
    staff: Staff,
    action: str,
    entity: str,
    entity_id: str,
    details: str = "",
) -> AuditLogEntry:
    """Append an immutable audit-trail entry. Never raises on its own — callers
    pair this with the write it describes inside a single transaction."""
    entry = AuditLogEntry(
        lender_id=staff.lender_id,
        user_id=staff.id,
        user_name=staff.name,
        action=action,
        entity=entity,
        entity_id=entity_id,
        details=details,
    )
    db.add(entry)
    return entry
