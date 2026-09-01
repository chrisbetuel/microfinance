from datetime import date

from app.schemas.base import CamelModel


class HolidayResponse(CamelModel):
    id: str
    lender_id: str
    date: date
    name: str


class HolidayCreateRequest(CamelModel):
    date: date
    name: str
