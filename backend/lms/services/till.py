"""Cashier cash-drawer position for a given day.

Cash in  = cash repayments the cashier recorded that day.
Cash out = cash disbursements the cashier released that day.
Opening float carries from that cashier's last reconciliation's counted close.
"""

from __future__ import annotations

from datetime import date

from lms.models import Loan, Repayment, TillReconciliation


def position(lender, cashier_name: str, business_date: date) -> dict:
    cash_in = sum(
        float(r.amount)
        for r in Repayment.objects.filter(
            lender=lender, channel="cash", reversed=False, recorded_by=cashier_name, date__date=business_date
        )
    )
    cash_out = sum(
        float(l.net_disbursed)
        for l in Loan.objects.filter(
            lender=lender, disbursement_channel="cash", disbursement_disbursed_by=cashier_name,
            disbursement_date__date=business_date,
        )
    )
    last = (
        TillReconciliation.objects.filter(lender=lender, cashier_name=cashier_name, business_date__lt=business_date)
        .order_by("-business_date")
        .first()
    )
    opening = float(last.counted_close) if last else 0.0
    already = TillReconciliation.objects.filter(
        lender=lender, cashier_name=cashier_name, business_date=business_date
    ).first()

    return {
        "business_date": business_date,
        "cashier_name": cashier_name,
        "opening_float": round(opening, 2),
        "cash_in": round(cash_in, 2),
        "cash_out": round(cash_out, 2),
        "expected_close": round(opening + cash_in - cash_out, 2),
        "closed": already is not None,
        "counted_close": float(already.counted_close) if already else None,
        "variance": float(already.variance) if already else None,
    }
