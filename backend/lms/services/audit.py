from lms.models import AuditLogEntry


def record(staff, action: str, entity: str, entity_id, details: str = "") -> AuditLogEntry:
    """Append an immutable audit-trail entry for the write it describes."""
    return AuditLogEntry.objects.create(
        lender=staff.lender,
        user_id=str(staff.id),
        user_name=staff.name,
        action=action,
        entity=entity,
        entity_id=str(entity_id),
        details=details,
    )
