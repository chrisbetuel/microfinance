"""Application intake checks, scoring and approval routing.

Ported from createApplication in src/store/useStore.ts — the frontend keeps a
local copy for instant feedback, but this is the copy that decides the routing
and gets persisted.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.utils import timezone

from lms.enums import ScoreRecommendation, StaffRole
from lms.models import Application, Loan
from lms.services.loan_math import generate_schedule


@dataclass
class Assessment:
    affordability_pass: bool
    duplicate_check_pass: bool
    blacklist_check_pass: bool
    score: int
    score_recommendation: str
    required_approver_role: str
    risk: dict
    needs_review: bool


def _required_role(product, amount: float) -> str:
    for level in product.approval_levels.all():
        min_amount = float(level.min_amount)
        max_amount = None if level.max_amount is None else float(level.max_amount)
        if amount >= min_amount and (max_amount is None or amount < max_amount):
            return level.required_role
    return StaffRole.BRANCH_MANAGER


def assess(
    *,
    product,
    borrower,
    amount: float,
    term_instalments: int,
    declared_income: float,
    declared_expenses: float,
    has_duplicate_national_id: bool,
) -> Assessment:
    disposable = declared_income - declared_expenses
    affordability_pass = disposable > 0 and amount / max(term_instalments, 1) < disposable * 0.6
    risk = risk_profile(
        product=product, borrower=borrower, amount=amount, term_instalments=term_instalments,
        income=declared_income, expenses=declared_expenses, has_duplicate_national_id=has_duplicate_national_id,
    )
    score = round((disposable / max(declared_income, 1)) * 100)
    score += min(risk["completed_loans"] * 5, 15)
    score -= risk["defaults"] * 15 + min(risk["late_instalments"] * 3, 30)
    if risk["debt_to_income"] > 0.5:
        score -= 10
    score = max(0, min(100, score))
    if score >= 60:
        recommendation = ScoreRecommendation.RECOMMEND
    elif score >= 35:
        recommendation = ScoreRecommendation.CAUTION
    else:
        recommendation = ScoreRecommendation.DECLINE

    return Assessment(
        affordability_pass=affordability_pass,
        duplicate_check_pass=not has_duplicate_national_id,
        blacklist_check_pass=not borrower.blacklisted,
        score=score,
        score_recommendation=str(recommendation),
        required_approver_role=str(_required_role(product, amount)),
        risk=risk,
        needs_review=bool(risk["flags"]),
    )


def risk_profile(*, product, borrower, amount, term_instalments, income, expenses, has_duplicate_national_id=False) -> dict:
    """Indicators an approver should see before deciding. The system flags
    concerns for additional review — it never decides on its own."""
    loans = list(Loan.objects.filter(borrower=borrower).prefetch_related("schedule")) if borrower.pk else []
    active = [l for l in loans if l.status == "active"]

    def next_due(loan):
        for inst in loan.schedule.all():
            if inst.status != "paid":
                return float(inst.total_due) - float(inst.paid_amount)
        return 0.0

    internal_repayments = sum(next_due(l) for l in active)
    external_repayments = float(getattr(borrower, "existing_loan_payments", 0) or 0)
    existing_repayments = internal_repayments + external_repayments
    try:
        new_instalment = float(generate_schedule(product, amount, term_instalments, timezone.now())[0].total_due)
    except Exception:  # pragma: no cover - malformed product
        new_instalment = amount / max(term_instalments, 1)

    income = max(float(income), 0.0)
    dti = (existing_repayments + new_instalment) / income if income else 1.0
    lti = amount / income if income else float("inf")
    disposable_after = income - float(expenses) - existing_repayments - new_instalment

    late = sum(1 for l in loans for i in l.schedule.all() if i.was_late)
    defaults = sum(1 for l in loans if l.status == "written_off")
    completed = sum(1 for l in loans if l.status == "closed")
    in_arrears = [l for l in active if l.days_in_arrears > 0]
    existing_debt = sum(float(l.outstanding_balance) for l in active)

    flags = []
    if defaults:
        flags.append(f"Has {defaults} written-off loan(s)")
    if in_arrears:
        flags.append(f"Currently {max(l.days_in_arrears for l in in_arrears)} days in arrears on another loan")
    if late >= 3:
        flags.append(f"Repeated late payments ({late} instalments)")
    if disposable_after < 0:
        flags.append("Repayment exceeds disposable income")
    if dti > 0.5:
        flags.append(f"Debt-to-income {dti:.0%} (above 50%)")
    if lti > 6:
        flags.append(f"Loan is {lti:.1f}× monthly income")
    if active:
        flags.append(f"Already has {len(active)} active loan(s)")
    if "guarantors" in (product.security_required or []) and not borrower.guarantors.exists():
        flags.append("Product requires a guarantor — none recorded")
    if "collateral" in (product.security_required or []) and not borrower.collateral.exclude(status="released").exists():
        flags.append("Product requires collateral — none recorded")
    if not getattr(borrower, "verified", True):
        flags.append("Borrower profile not yet verified")
    if has_duplicate_national_id:
        flags.append("NIDA number shared with another borrower")

    return {
        "monthly_income": round(income, 2),
        "monthly_expenses": round(float(expenses), 2),
        "existing_repayments": round(existing_repayments, 2),
        "new_instalment": round(new_instalment, 2),
        "disposable_after": round(disposable_after, 2),
        "debt_to_income": round(dti, 3),
        "loan_to_income": round(lti, 2) if lti != float("inf") else None,
        "existing_debt": round(existing_debt, 2),
        "previous_loans": len(loans),
        "completed_loans": completed,
        "active_loans": len(active),
        "late_instalments": late,
        "defaults": defaults,
        "flags": flags,
    }


def next_reference(lender) -> str:
    year = timezone.now().year
    count = Application.objects.filter(lender=lender).count()
    return f"APP-{year}-{str(count + 1).zfill(4)}"
