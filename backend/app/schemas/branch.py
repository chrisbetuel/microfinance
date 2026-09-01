from datetime import date

from app.schemas.base import CamelModel


class BranchResponse(CamelModel):
    id: str
    lender_id: str
    name: str
    code: str
    location: str
    opened_on: date


class BranchCreateRequest(CamelModel):
    name: str
    code: str
    location: str
    opened_on: date
