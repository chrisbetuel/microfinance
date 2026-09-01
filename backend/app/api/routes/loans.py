from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentStaff, DbSession
from app.models import Loan
from app.schemas.loan import LoanResponse

router = APIRouter(prefix="/loans", tags=["loans"])


@router.get("", response_model=list[LoanResponse])
async def list_loans(staff: CurrentStaff, db: DbSession) -> list[Loan]:
    result = await db.scalars(
        select(Loan)
        .where(Loan.lender_id == staff.lender_id)
        .options(selectinload(Loan.schedule))
        .order_by(Loan.created_at.desc())
    )
    return list(result)


@router.get("/{loan_id}", response_model=LoanResponse)
async def get_loan(loan_id: str, staff: CurrentStaff, db: DbSession) -> Loan:
    loan = await db.scalar(
        select(Loan).where(Loan.id == loan_id).options(selectinload(Loan.schedule))
    )
    if loan is None or loan.lender_id != staff.lender_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")
    return loan
