from fastapi import APIRouter

from app.core.deps import CurrentStaff, DbSession, RequireAdmin
from app.models import Lender
from app.schemas.lender import LenderResponse, LenderUpdateRequest
from app.services import audit

router = APIRouter(prefix="/lender", tags=["lender"])


@router.get("", response_model=LenderResponse)
async def get_lender(staff: CurrentStaff, db: DbSession) -> Lender:
    return await db.get(Lender, staff.lender_id)


@router.patch("", response_model=LenderResponse)
async def update_lender(body: LenderUpdateRequest, staff: RequireAdmin, db: DbSession) -> Lender:
    lender = await db.get(Lender, staff.lender_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(lender, field, value)
    await audit.record(db, staff, "updated", "lender", lender.id, "Lender profile updated")
    await db.commit()
    return lender
