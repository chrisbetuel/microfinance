"""Daily loan aging: move instalments through due -> overdue, accrue penalties,
refresh each loan's arrears position, and close loans that are fully repaid.

Idempotent — running it twice on the same day changes nothing.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.utils import timezone

from lms.enums import InstalmentStatus, LoanStatus
from lms.models import Loan, ScheduleInstalment
from lms.services.loan_math import calculate_penalty, round2


@dataclass
class LoanAging:
    loan_id: str
    days_in_arrears: int
    arrears_amount: float
    outstanding: float
    closed: bool


def age_loan(loan: Loan, *, as_of=None) -> LoanAging:
    today = as_of or timezone.localdate()
    product = loan.product
    schedule = list(loan.schedule.all())

    max_days = 0
    arrears = 0.0
    outstanding = 0.0

    for inst in schedule:
        base_due = float(inst.principal_due) + float(inst.interest_due) + float(inst.fees_due)
        paid = float(inst.paid_amount)
        fully_paid = paid >= base_due + float(inst.penalty_due) - 0.01

        if fully_paid:
            inst.status = InstalmentStatus.PAID
        elif inst.due_date < today:
            days_late = (today - inst.due_date).days
            penalty = calculate_penalty(product, base_due, days_late)
            inst.penalty_due = penalty
            inst.total_due = round2(base_due + penalty)
            inst.status = InstalmentStatus.PARTIAL if paid > 0 else InstalmentStatus.OVERDUE
            max_days = max(max_days, days_late)
            arrears += max(float(inst.total_due) - paid, 0.0)
        elif inst.due_date == today:
            inst.status = InstalmentStatus.DUE
        else:
            inst.status = InstalmentStatus.PARTIAL if paid > 0 else InstalmentStatus.UPCOMING

        outstanding += max(float(inst.total_due) - paid, 0.0)

    ScheduleInstalment.objects.bulk_update(schedule, ["status", "penalty_due", "total_due"])

    now = timezone.now()
    loan.days_in_arrears = max_days
    loan.arrears_amount = round2(arrears)
    loan.outstanding_balance = round2(outstanding)
    loan.aged_at = now
    closed = False
    if outstanding <= 0.01 and loan.status == LoanStatus.ACTIVE:
        loan.status = LoanStatus.CLOSED
        loan.closed_at = now
        loan.closure_reason = "Repaid in full"
        closed = True
    loan.save(update_fields=["days_in_arrears", "arrears_amount", "outstanding_balance", "aged_at", "status", "closed_at", "closure_reason"])

    return LoanAging(str(loan.id), max_days, loan.arrears_amount, loan.outstanding_balance, closed)


def age_all(*, lender=None, as_of=None) -> list[LoanAging]:
    qs = Loan.objects.filter(status=LoanStatus.ACTIVE).select_related("product").prefetch_related("schedule")
    if lender is not None:
        qs = qs.filter(lender=lender)
    return [age_loan(loan, as_of=as_of) for loan in qs]
