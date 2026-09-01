from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentStaff, DbSession, require_section_editor
from app.models import Borrower, BorrowerHistoryEvent, Guarantor, Staff
from app.schemas.borrower import BlacklistRequest, BorrowerCreateRequest, BorrowerResponse
from app.services import audit
from app.services.tenancy import ensure_branch, ensure_staff_member

router = APIRouter(prefix="/borrowers", tags=["borrowers"])

BorrowerEditor = Annotated[Staff, Depends(require_section_editor("borrowers"))]

_WITH_RELATIONS = (
    selectinload(Borrower.guarantors),
    selectinload(Borrower.documents),
    selectinload(Borrower.history),
)


async def _get(db: DbSession, lender_id: str, borrower_id: str) -> Borrower:
    borrower = await db.scalar(
        select(Borrower).where(Borrower.id == borrower_id).options(*_WITH_RELATIONS)
    )
    if borrower is None or borrower.lender_id != lender_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Borrower not found")
    return borrower


@router.get("", response_model=list[BorrowerResponse])
async def list_borrowers(staff: CurrentStaff, db: DbSession) -> list[Borrower]:
    result = await db.scalars(
        select(Borrower)
        .where(Borrower.lender_id == staff.lender_id)
        .options(*_WITH_RELATIONS)
        .order_by(Borrower.created_at.desc())
    )
    return list(result)


@router.get("/{borrower_id}", response_model=BorrowerResponse)
async def get_borrower(borrower_id: str, staff: CurrentStaff, db: DbSession) -> Borrower:
    return await _get(db, staff.lender_id, borrower_id)


@router.post("", response_model=BorrowerResponse, status_code=status.HTTP_201_CREATED)
async def create_borrower(body: BorrowerCreateRequest, staff: BorrowerEditor, db: DbSession) -> Borrower:
    officer_id = body.officer_id or staff.id
    await ensure_branch(db, staff.lender_id, body.branch_id)
    await ensure_staff_member(db, staff.lender_id, officer_id)
    data = body.model_dump(exclude={"officer_id", "guarantors"})

    borrower = Borrower(
        lender_id=staff.lender_id,
        officer_id=officer_id,
        **data,
        blacklisted=False,
        guarantors=[Guarantor(**g.model_dump()) for g in body.guarantors],
        history=[BorrowerHistoryEvent(label="File opened", detail=f"Borrower registered by {staff.name}")],
    )
    db.add(borrower)
    await db.flush()
    await audit.record(db, staff, "created", "borrower", borrower.id, f'Borrower "{borrower.full_name}" registered')
    await db.commit()
    return await _get(db, staff.lender_id, borrower.id)


@router.post("/{borrower_id}/blacklist", response_model=BorrowerResponse)
async def set_blacklist(
    borrower_id: str, body: BlacklistRequest, staff: BorrowerEditor, db: DbSession
) -> Borrower:
    borrower = await _get(db, staff.lender_id, borrower_id)
    borrower.blacklisted = body.blacklisted
    borrower.blacklist_reason = body.reason if body.blacklisted else None
    borrower.history.append(
        BorrowerHistoryEvent(
            label="Blacklisted" if body.blacklisted else "Removed from blacklist",
            detail=body.reason or "Reason not recorded",
        )
    )
    await audit.record(
        db,
        staff,
        "blacklisted" if body.blacklisted else "unblacklisted",
        "borrower",
        borrower.id,
        body.reason or "",
    )
    await db.commit()
    return await _get(db, staff.lender_id, borrower_id)
