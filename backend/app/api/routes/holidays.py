from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.core.deps import CurrentStaff, DbSession, RequireAdmin
from app.models import Holiday
from app.schemas.holiday import HolidayCreateRequest, HolidayResponse
from app.services import audit

router = APIRouter(prefix="/holidays", tags=["holidays"])


@router.get("", response_model=list[HolidayResponse])
async def list_holidays(staff: CurrentStaff, db: DbSession) -> list[Holiday]:
    result = await db.scalars(
        select(Holiday).where(Holiday.lender_id == staff.lender_id).order_by(Holiday.date)
    )
    return list(result)


@router.post("", response_model=HolidayResponse, status_code=status.HTTP_201_CREATED)
async def create_holiday(body: HolidayCreateRequest, admin: RequireAdmin, db: DbSession) -> Holiday:
    holiday = Holiday(lender_id=admin.lender_id, **body.model_dump())
    db.add(holiday)
    await db.flush()
    await audit.record(db, admin, "created", "holiday", holiday.id, f'Holiday "{holiday.name}" added')
    await db.commit()
    return holiday


@router.delete("/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_holiday(holiday_id: str, admin: RequireAdmin, db: DbSession) -> None:
    holiday = await db.get(Holiday, holiday_id)
    if holiday is None or holiday.lender_id != admin.lender_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Holiday not found")
    await db.delete(holiday)
    await audit.record(db, admin, "deleted", "holiday", holiday_id, "Holiday removed")
    await db.commit()
