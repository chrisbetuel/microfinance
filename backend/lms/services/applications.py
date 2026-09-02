"""Application intake checks, scoring and approval routing.

Ported from createApplication in src/store/useStore.ts — the frontend keeps a
local copy for instant feedback, but this is the copy that decides the routing
and gets persisted.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.utils import timezone

from lms.enums import ScoreRecommendation, StaffRole
from lms.models import Application


@dataclass
class Assessment:
    affordability_pass: bool
    duplicate_check_pass: bool
    blacklist_check_pass: bool
    score: int
    score_recommendation: str
    required_approver_role: str


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
    score = max(0, min(100, round((disposable / max(declared_income, 1)) * 100)))
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
    )


def next_reference(lender) -> str:
    year = timezone.now().year
    count = Application.objects.filter(lender=lender).count()
    return f"APP-{year}-{str(count + 1).zfill(4)}"
