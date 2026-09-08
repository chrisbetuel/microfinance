"""Collections helpers — promise-to-pay status resolution.

A promise is "kept" once repayments dated on/after it total at least the
promised amount (by the promised date if one was given); "broken" once the
promised date has passed without that; otherwise "pending".
"""

from __future__ import annotations

from datetime import date

from django.utils import timezone


def promise_status(activity, repayments) -> str | None:
    """`repayments` is an iterable of that loan's non-reversed Repayment rows."""
    if activity.kind != "promise" or activity.promised_amount is None:
        return None
    since = activity.created_at
    paid = sum(
        float(r.amount)
        for r in repayments
        if not r.reversed and r.date >= since
    )
    if paid + 1e-6 >= float(activity.promised_amount):
        return "kept"
    today = timezone.now().date()
    due: date | None = activity.promised_date
    if due is not None and today > due:
        return "broken"
    return "pending"
