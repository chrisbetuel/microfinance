from __future__ import annotations

from lms.models import AuditLogEntry


def record(staff, action: str, entity: str, entity_id, details: str = "", changes: dict | None = None) -> AuditLogEntry:
    """Append an immutable audit-trail entry for the write it describes."""
    return AuditLogEntry.objects.create(
        lender=staff.lender,
        user_id=str(staff.id),
        user_name=staff.name,
        action=action,
        entity=entity,
        entity_id=str(entity_id),
        details=details,
        changes=changes or {},
    )


def diff(obj, new_values: dict) -> dict:
    """{field: {before, after}} for every field whose value actually changes."""
    out = {}
    for field, after in new_values.items():
        before = getattr(obj, field, None)
        if str(before if before is not None else "") != str(after if after is not None else ""):
            out[field] = {"before": _plain(before), "after": _plain(after)}
    return out


def _plain(v):
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    return str(v)
