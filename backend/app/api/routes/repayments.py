from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentStaff, DbSession, require_section_editor
from app.models import Loan, LoanProduct, Repayment, Staff
from app.models.enums import LoanStatus
from app.schemas.repayment import (
    RepaymentCreateRequest,
    RepaymentResponse,
    RepaymentReverseRequest,
)
from app.services import audit, loans as loan_service
from app.services import permissions

router = APIRouter(prefix="/repayments", tags=["repayments"])

RepaymentEditor = Annotated[Staff, Depends(require_section_editor("repayments"))]


@router.get("", response_model=list[RepaymentResponse])
async def list_repayments(staff: CurrentStaff, db: DbSession) -> list[Repayment]:
    result = await db.scalars(
        select(Repayment)
        .where(Repayment.lender_id == staff.lender_id)
        .order_by(Repayment.date.desc())
    )
    return list(result)


async def _load_loan(db: DbSession, lender_id: str, loan_id: str) -> Loan:
    loan = await db.scalar(
        select(Loan).where(Loan.id == loan_id).options(selectinload(Loan.schedule))
    )
    if loan is None or loan.lender_id != lender_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")
    return loan


async def _load_product(db: DbSession, lender_id: str, product_id: str) -> LoanProduct:
    return await db.scalar(
        select(LoanProduct)
        .where(LoanProduct.id == product_id, LoanProduct.lender_id == lender_id)
        .options(selectinload(LoanProduct.fees))
    )


@router.post("", response_model=RepaymentResponse, status_code=status.HTTP_201_CREATED)
async def record_repayment(
    body: RepaymentCreateRequest, staff: RepaymentEditor, db: DbSession
) -> Repayment:
    if body.amount <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Amount must be positive")

    loan = await _load_loan(db, staff.lender_id, body.loan_id)
    if loan.status != LoanStatus.active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This loan is not active")

    product = await _load_product(db, staff.lender_id, loan.product_id)
    repayment = await loan_service.post_repayment(
        db,
        loan=loan,
        product=product,
        amount=body.amount,
        channel=body.channel,
        recorded_by=staff.name,
    )
    await db.flush()
    await audit.record(
        db, staff, "recorded", "repayment", repayment.id,
        f"{body.amount:,.0f} received via {body.channel.value}, receipt {repayment.receipt_number}",
    )
    await db.commit()
    return await db.get(Repayment, repayment.id)


@router.post("/{repayment_id}/reverse", response_model=RepaymentResponse)
async def reverse_repayment(
    repayment_id: str, body: RepaymentReverseRequest, staff: RepaymentEditor, db: DbSession
) -> Repayment:
    if not permissions.is_supervisor(staff.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a supervisor can reverse a posted payment",
        )

    repayment = await db.get(Repayment, repayment_id)
    if repayment is None or repayment.lender_id != staff.lender_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Repayment not found")
    if repayment.reversed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This payment has already been reversed")

    loan = await _load_loan(db, staff.lender_id, repayment.loan_id)
    product = await _load_product(db, staff.lender_id, loan.product_id)
    loan_repayments = list(
        await db.scalars(select(Repayment).where(Repayment.loan_id == loan.id))
    )

    await loan_service.reverse_repayment(
        db,
        repayment=repayment,
        loan=loan,
        product=product,
        loan_repayments=loan_repayments,
        reason=body.reason,
    )
    await audit.record(db, staff, "reversed", "repayment", repayment.id, f"Reversal reason: {body.reason}")
    await db.commit()
    return await db.get(Repayment, repayment_id)
