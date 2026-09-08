"""Loan restructuring — reschedule the remaining balance of an active loan.

The unpaid principal is carried forward; accrued interest, fees and (unless
waived as a concession) penalty are capitalised into the new principal, and a
fresh schedule is generated at the product rate over the new term. Done
in-place: the loan keeps its identity, the schedule is replaced.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.utils import timezone

from lms.enums import LoanStatus
from lms.models import ScheduleInstalment
from lms.services.loan_math import generate_schedule


def preview(*, loan, waive_penalties: bool) -> dict:
    repayments = [r for r in loan.repayments.all() if not r.reversed]
    principal_repaid = sum(float(r.allocation_principal) for r in repayments)
    remaining_principal = max(float(loan.schedule_principal or loan.principal) - principal_repaid, 0.0)
    outstanding = float(loan.outstanding_balance)
    carried = max(outstanding - remaining_principal, 0.0)

    accrued_penalty = sum(float(i.penalty_due) for i in loan.schedule.all())
    waived = min(accrued_penalty, carried) if waive_penalties else 0.0
    carried_after = max(carried - waived, 0.0)

    return {
        "remaining_principal": round(remaining_principal, 2),
        "carried_arrears": round(carried_after, 2),
        "penalty_waived": round(waived, 2),
        "new_principal": round(remaining_principal + carried_after, 2),
    }


def restructure_loan(
    *, loan, product, new_term: int, first_due_date: date | None = None,
    waive_penalties: bool = False, by_name: str,
):
    if loan.status != LoanStatus.ACTIVE:
        raise ValueError("Only an active loan can be restructured")

    figures = preview(loan=loan, waive_penalties=waive_penalties)
    new_principal = figures["new_principal"]
    if new_principal <= 0:
        raise ValueError("Nothing outstanding to restructure")

    now = timezone.now()
    # generate_schedule advances one period from start_date before the first
    # due date, so step back one period when an explicit first due date is given.
    rows = generate_schedule(product, new_principal, new_term, now)
    if first_due_date is not None:
        shift = (first_due_date - rows[0].due_date).days
        for r in rows:
            r.due_date = r.due_date + timedelta(days=shift)

    loan.schedule.all().delete()
    ScheduleInstalment.objects.bulk_create(
        ScheduleInstalment(
            loan=loan, period=r.period, due_date=r.due_date,
            principal_due=r.principal_due, interest_due=r.interest_due,
            fees_due=r.fees_due, penalty_due=r.penalty_due, total_due=r.total_due,
            paid_amount=0.0, balance_after=r.balance_after, status="upcoming",
        )
        for r in rows
    )

    loan.schedule_principal = new_principal
    loan.outstanding_balance = sum(r.total_due for r in rows)
    loan.restructure_count += 1
    loan.restructured_at = now
    loan.days_in_arrears = 0
    loan.arrears_amount = 0
    loan.aged_at = None
    loan.save(update_fields=[
        "schedule_principal", "outstanding_balance", "restructure_count",
        "restructured_at", "days_in_arrears", "arrears_amount", "aged_at",
    ])
    return loan, figures
