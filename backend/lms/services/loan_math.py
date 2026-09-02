"""Loan scheduling, fee and repayment-allocation math.

A direct port of the frontend's src/lib/loanMath.ts, kept in lockstep with it:
the backend must compute the same numbers the frontend prototype does, and must
never trust a client-submitted schedule or allocation.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from dateutil.relativedelta import relativedelta

PERIOD_DAYS = {"daily": 1, "weekly": 7, "monthly": 30}
FREQUENCY_DAYS = {"daily": 1, "weekly": 7, "fortnightly": 14, "monthly": 30}


def round2(value: float) -> float:
    return round(value + 1e-9, 2)


def _add_period(d: date, frequency: str) -> date:
    if frequency == "daily":
        return d + relativedelta(days=1)
    if frequency == "weekly":
        return d + relativedelta(weeks=1)
    if frequency == "fortnightly":
        return d + relativedelta(weeks=2)
    if frequency == "monthly":
        return d + relativedelta(months=1)
    raise ValueError(f"unknown repayment frequency: {frequency}")


def _rate_per_instalment(product) -> float:
    daily_rate = float(product.interest_rate) / 100 / PERIOD_DAYS[product.interest_period]
    return daily_rate * FREQUENCY_DAYS[product.repayment_frequency]


def _fees(product):
    fees = product.fees
    return fees.all() if hasattr(fees, "all") else fees


def total_fee_amount(product, principal: float, timing: str | None = None) -> float:
    total = 0.0
    for fee in _fees(product):
        if timing is not None and fee.timing != timing:
            continue
        if fee.kind == "percent":
            total += principal * float(fee.value) / 100
        else:
            total += float(fee.value)
    return total


@dataclass
class ScheduleRow:
    period: int
    due_date: date
    principal_due: float
    interest_due: float
    fees_due: float
    penalty_due: float
    total_due: float
    paid_amount: float = 0.0
    balance_after: float = 0.0
    status: str = "upcoming"


def generate_schedule(product, principal: float, term_instalments: int, start_date: datetime | date) -> list[ScheduleRow]:
    if isinstance(start_date, datetime):
        start_date = start_date.date()

    rate = _rate_per_instalment(product)
    added_fees = total_fee_amount(product, principal, "added")

    grace_on_principal = product.grace_period_days > 0 and product.grace_period_applies_to in ("principal", "both")
    grace_on_interest = product.grace_period_days > 0 and product.grace_period_applies_to in ("interest", "both")

    principal_periods = term_instalments - 1 if grace_on_principal else term_instalments
    base_principal_portion = principal / max(principal_periods, 1)

    schedule: list[ScheduleRow] = []
    balance = principal
    due_date = start_date

    for period in range(1, term_instalments + 1):
        due_date = _add_period(due_date, product.repayment_frequency)
        is_grace_period = period == 1 and product.grace_period_days > 0

        if product.interest_method == "reducing":
            interest_due = 0.0 if (is_grace_period and grace_on_interest) else balance * rate
        else:
            flat_interest_per_period = principal * (float(product.interest_rate) / 100)
            interest_due = 0.0 if (is_grace_period and grace_on_interest) else flat_interest_per_period

        principal_due = 0.0 if (is_grace_period and grace_on_principal) else base_principal_portion
        fees_due = added_fees if period == 1 else 0.0

        balance = max(balance - principal_due, 0.0)

        schedule.append(
            ScheduleRow(
                period=period,
                due_date=due_date,
                principal_due=round2(principal_due),
                interest_due=round2(interest_due),
                fees_due=round2(fees_due),
                penalty_due=0.0,
                total_due=round2(principal_due + interest_due + fees_due),
                paid_amount=0.0,
                balance_after=round2(balance),
                status="upcoming",
            )
        )

    return schedule


def calculate_penalty(product, overdue_amount: float, days_late: int) -> float:
    if days_late <= 0:
        return 0.0
    if product.penalty_kind == "fixed":
        raw = float(product.penalty_value) * days_late
    else:
        raw = overdue_amount * (float(product.penalty_value) / 100) * days_late
    return round2(min(raw, float(product.penalty_cap)))


@dataclass
class Allocation:
    penalty: float = 0.0
    fees: float = 0.0
    interest: float = 0.0
    principal: float = 0.0


@dataclass
class AllocationResult:
    schedule: list[ScheduleRow]
    allocation: Allocation
    remainder: float


def allocate_payment(product, schedule: list[ScheduleRow], amount: float) -> AllocationResult:
    """Applies a payment across a schedule in the product's configured bucket order,
    oldest unpaid instalment first. Mirrors allocatePayment in loanMath.ts exactly."""

    # `schedule` may be ScheduleRow copies or ORM instalments (DecimalField
    # columns yield Decimal), so every amount is coerced to float up front.
    next_schedule = [
        ScheduleRow(
            period=row.period,
            due_date=row.due_date,
            principal_due=float(row.principal_due),
            interest_due=float(row.interest_due),
            fees_due=float(row.fees_due),
            penalty_due=float(row.penalty_due),
            total_due=float(row.total_due),
            paid_amount=float(row.paid_amount),
            balance_after=float(row.balance_after),
            status=str(row.status),
        )
        for row in schedule
    ]
    allocation = Allocation()
    remaining = round2(amount)

    for inst in next_schedule:
        if remaining <= 0:
            break
        inst_remaining = round2(inst.total_due - inst.paid_amount)
        if inst_remaining <= 0:
            continue

        pay_for_inst = round2(min(inst_remaining, remaining))
        bucket_due = {
            "penalty": inst.penalty_due,
            "fee": inst.fees_due,
            "interest": inst.interest_due,
            "principal": inst.principal_due,
        }

        already_paid = inst.paid_amount
        bucket_paid_so_far = {"penalty": 0.0, "fee": 0.0, "interest": 0.0, "principal": 0.0}
        for bucket in product.allocation_order:
            take = min(bucket_due[bucket], already_paid)
            bucket_paid_so_far[bucket] = take
            already_paid = round2(already_paid - take)

        to_apply = pay_for_inst
        for bucket in product.allocation_order:
            if to_apply <= 0:
                break
            capacity = round2(bucket_due[bucket] - bucket_paid_so_far[bucket])
            take = min(capacity, to_apply)
            if take <= 0:
                continue
            to_apply = round2(to_apply - take)
            if bucket == "fee":
                allocation.fees += take
            elif bucket == "penalty":
                allocation.penalty += take
            elif bucket == "interest":
                allocation.interest += take
            else:
                allocation.principal += take

        inst.paid_amount = round2(inst.paid_amount + pay_for_inst)
        inst.status = "paid" if inst.paid_amount >= inst.total_due - 0.01 else "partial"
        remaining = round2(remaining - pay_for_inst)

    return AllocationResult(schedule=next_schedule, allocation=allocation, remainder=round2(remaining))
