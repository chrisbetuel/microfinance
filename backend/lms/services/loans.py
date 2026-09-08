"""Disbursement and repayment posting.

Ported from disburseLoan / recordRepayment / reverseRepayment in
src/store/useStore.ts. The schedule and every allocation are computed here and
never trusted from the client.
"""

from __future__ import annotations

from django.utils import timezone

from lms.enums import InstalmentStatus, LoanStatus
from lms.models import Loan, Repayment, ScheduleInstalment
from lms.services.loan_math import allocate_payment, generate_schedule, total_fee_amount


def _outstanding(schedule) -> float:
    return max(sum(float(i.total_due) - float(i.paid_amount) for i in schedule), 0.0)


def create_loan_from_application(
    *, application, product, channel, reference, approved_by, disbursed_by, disbursed_on=None
) -> Loan:
    amount = float(application.amount)
    now = disbursed_on or timezone.now()
    rows = generate_schedule(product, amount, application.term_instalments, now)
    fees_deducted = total_fee_amount(product, amount, "deducted")

    loan = Loan.objects.create(
        lender=application.lender,
        branch=application.branch,
        application=application,
        borrower=application.borrower,
        product=application.product,
        principal=amount,
        schedule_principal=amount,
        net_disbursed=amount - fees_deducted,
        fees_deducted=fees_deducted,
        status=LoanStatus.ACTIVE,
        outstanding_balance=sum(r.total_due for r in rows),
        disbursement_channel=channel,
        disbursement_date=now,
        disbursement_reference=reference,
        disbursement_approved_by=approved_by,
        disbursement_disbursed_by=disbursed_by,
        created_at=now,
    )
    ScheduleInstalment.objects.bulk_create(
        ScheduleInstalment(
            loan=loan,
            period=r.period,
            due_date=r.due_date,
            principal_due=r.principal_due,
            interest_due=r.interest_due,
            fees_due=r.fees_due,
            penalty_due=r.penalty_due,
            total_due=r.total_due,
            paid_amount=r.paid_amount,
            balance_after=r.balance_after,
            status=r.status,
        )
        for r in rows
    )
    return loan


def _next_receipt_number(lender) -> str:
    count = Repayment.objects.filter(lender=lender).count()
    return f"RCT-{100000 + count + 1}"


def _apply_allocation_result(schedule, result_rows) -> None:
    by_period = {row.period: row for row in result_rows}
    for inst in schedule:
        row = by_period.get(inst.period)
        if row is None:
            continue
        inst.paid_amount = row.paid_amount
        inst.status = row.status
    ScheduleInstalment.objects.bulk_update(schedule, ["paid_amount", "status"])


def post_repayment(*, loan, product, amount: float, channel, recorded_by: str) -> Repayment:
    schedule = list(loan.schedule.all())
    result = allocate_payment(product, schedule, amount)
    _apply_allocation_result(schedule, result.schedule)

    loan.outstanding_balance = _outstanding(schedule)
    fields = ["outstanding_balance", "status"]
    if loan.outstanding_balance <= 0.01 and loan.status == LoanStatus.ACTIVE:
        loan.status = LoanStatus.CLOSED
        loan.closed_at = timezone.now()
        loan.closure_reason = "Repaid in full"
        fields += ["closed_at", "closure_reason"]
    loan.save(update_fields=fields)

    return Repayment.objects.create(
        lender=loan.lender,
        loan=loan,
        amount=amount,
        date=timezone.now(),
        channel=channel,
        receipt_number=_next_receipt_number(loan.lender),
        allocation_penalty=result.allocation.penalty,
        allocation_fees=result.allocation.fees,
        allocation_interest=result.allocation.interest,
        allocation_principal=result.allocation.principal,
        allocation_remainder=result.remainder,
        recorded_by=recorded_by,
    )


def reverse_repayment(*, repayment, loan, product, loan_repayments, reason: str) -> None:
    repayment.reversed = True
    repayment.reversal_reason = reason
    repayment.save(update_fields=["reversed", "reversal_reason"])

    remaining = sorted(
        (r for r in loan_repayments if not r.reversed and r.id != repayment.id),
        key=lambda r: r.date,
    )

    schedule = list(loan.schedule.all())
    # A restructure replaces the schedule, so only replay payments made against
    # the current schedule, off the principal it was built from.
    origin = loan.restructured_at or loan.created_at
    if loan.restructure_count > 0:
        remaining = [r for r in remaining if r.date >= origin]
    base_principal = float(loan.schedule_principal or loan.principal)
    fresh_rows = generate_schedule(product, base_principal, len(schedule), origin)
    for r in remaining:
        fresh_rows = allocate_payment(product, fresh_rows, float(r.amount)).schedule

    _apply_allocation_result(schedule, fresh_rows)
    loan.outstanding_balance = _outstanding(schedule)
    if loan.outstanding_balance > 0 and loan.status == LoanStatus.CLOSED:
        loan.status = LoanStatus.ACTIVE
        loan.closed_at = None
        loan.closure_reason = ""
    loan.save(update_fields=["outstanding_balance", "status", "closed_at", "closure_reason"])


def write_off(*, loan, reason: str, by_name: str) -> None:
    loan.status = LoanStatus.WRITTEN_OFF
    loan.closed_at = timezone.now()
    loan.closure_reason = f"Written off: {reason}"
    loan.save(update_fields=["status", "closed_at", "closure_reason"])
