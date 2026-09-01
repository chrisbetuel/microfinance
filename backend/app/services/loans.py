"""Disbursement and repayment posting.

Ported from disburseLoan / recordRepayment / reverseRepayment in
src/store/useStore.ts. The schedule and every allocation are computed here and
never trusted from the client.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Application, Loan, LoanProduct, Repayment, ScheduleInstalment
from app.models.enums import DisbursementChannel, InstalmentStatus, LoanStatus, RepaymentChannel
from app.services.loan_math import ScheduleRow, allocate_payment, generate_schedule, total_fee_amount


def _rows_to_instalments(rows: list[ScheduleRow]) -> list[ScheduleInstalment]:
    return [
        ScheduleInstalment(
            period=row.period,
            due_date=row.due_date,
            principal_due=row.principal_due,
            interest_due=row.interest_due,
            fees_due=row.fees_due,
            penalty_due=row.penalty_due,
            total_due=row.total_due,
            paid_amount=row.paid_amount,
            balance_after=row.balance_after,
            status=InstalmentStatus(row.status),
        )
        for row in rows
    ]


def _outstanding(schedule: list[ScheduleInstalment]) -> float:
    return max(sum(float(i.total_due) - float(i.paid_amount) for i in schedule), 0.0)


async def create_loan_from_application(
    db: AsyncSession,
    *,
    application: Application,
    product: LoanProduct,
    channel: DisbursementChannel,
    reference: str,
    approved_by: str,
    disbursed_by: str,
) -> Loan:
    amount = float(application.amount)
    now = datetime.now(timezone.utc)
    rows = generate_schedule(product, amount, application.term_instalments, now)
    fees_deducted = total_fee_amount(product, amount, "deducted")
    schedule = _rows_to_instalments(rows)

    loan = Loan(
        lender_id=application.lender_id,
        branch_id=application.branch_id,
        application_id=application.id,
        borrower_id=application.borrower_id,
        product_id=application.product_id,
        principal=amount,
        net_disbursed=amount - fees_deducted,
        fees_deducted=fees_deducted,
        status=LoanStatus.active,
        outstanding_balance=_outstanding(schedule),
        disbursement_channel=channel,
        disbursement_date=now,
        disbursement_reference=reference,
        disbursement_approved_by=approved_by,
        disbursement_disbursed_by=disbursed_by,
        schedule=schedule,
    )
    db.add(loan)
    return loan


async def _next_receipt_number(db: AsyncSession, lender_id: str) -> str:
    count = await db.scalar(
        select(func.count()).select_from(Repayment).where(Repayment.lender_id == lender_id)
    )
    return f"RCT-{100000 + (count or 0) + 1}"


def _apply_allocation_result(schedule: list[ScheduleInstalment], result_rows: list[ScheduleRow]) -> None:
    by_period = {row.period: row for row in result_rows}
    for inst in schedule:
        row = by_period.get(inst.period)
        if row is None:
            continue
        inst.paid_amount = row.paid_amount
        inst.status = InstalmentStatus(row.status)


async def post_repayment(
    db: AsyncSession,
    *,
    loan: Loan,
    product: LoanProduct,
    amount: float,
    channel: RepaymentChannel,
    recorded_by: str,
) -> Repayment:
    result = allocate_payment(product, loan.schedule, amount)
    _apply_allocation_result(loan.schedule, result.schedule)

    loan.outstanding_balance = _outstanding(loan.schedule)
    if loan.outstanding_balance <= 0 and loan.status == LoanStatus.active:
        loan.status = LoanStatus.closed

    repayment = Repayment(
        lender_id=loan.lender_id,
        loan_id=loan.id,
        amount=amount,
        date=datetime.now(timezone.utc),
        channel=channel,
        receipt_number=await _next_receipt_number(db, loan.lender_id),
        allocation_penalty=result.allocation.penalty,
        allocation_fees=result.allocation.fees,
        allocation_interest=result.allocation.interest,
        allocation_principal=result.allocation.principal,
        recorded_by=recorded_by,
    )
    db.add(repayment)
    return repayment


async def reverse_repayment(
    db: AsyncSession,
    *,
    repayment: Repayment,
    loan: Loan,
    product: LoanProduct,
    loan_repayments: list[Repayment],
    reason: str,
) -> None:
    repayment.reversed = True
    repayment.reversal_reason = reason

    remaining = [
        r
        for r in sorted(loan_repayments, key=lambda r: r.date)
        if not r.reversed and r.id != repayment.id
    ]

    fresh_rows = generate_schedule(product, float(loan.principal), len(loan.schedule), loan.created_at)
    for r in remaining:
        fresh_rows = allocate_payment(product, fresh_rows, float(r.amount)).schedule

    _apply_allocation_result(loan.schedule, fresh_rows)
    loan.outstanding_balance = _outstanding(loan.schedule)
    if loan.outstanding_balance > 0 and loan.status == LoanStatus.closed:
        loan.status = LoanStatus.active
