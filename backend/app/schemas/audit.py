from datetime import datetime

from app.schemas.base import CamelModel


class AuditLogEntryResponse(CamelModel):
    id: str
    timestamp: datetime
    user_id: str
    user_name: str
    action: str
    entity: str
    entity_id: str
    details: str
