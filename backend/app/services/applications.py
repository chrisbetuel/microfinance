"""Application intake checks, scoring and approval routing.

Ported from the frontend's createApplication in src/store/useStore.ts — the
frontend keeps a local copy for instant feedback, but this is the copy that
actually decides the routing and gets persisted.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Application, Borrower, LoanProduct
from app.models.enums import ScoreRecommendation, StaffRole


@dataclass
class Assessment:
    affordability_pass: bool
    duplicate_check_pass: bool
    blacklist_check_pass: bool
    score: int
    score_recommendation: ScoreRecommendation
    required_approver_role: StaffRole


def _required_role(product: LoanProduct, amount: float) -> StaffRole:
    for level in sorted(product.approval_levels, key=lambda level: float(level.min_amount)):
        min_amount = float(level.min_amount)
        max_amount = None if level.max_amount is None else float(level.max_amount)
        if amount >= min_amount and (max_amount is None or amount < max_amount):
            return level.required_role
    return StaffRole.branch_manager


def assess(
    *,
    product: LoanProduct,
    borrower: Borrower,
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
        recommendation = ScoreRecommendation.recommend
    elif score >= 35:
        recommendation = ScoreRecommendation.caution
    else:
        recommendation = ScoreRecommendation.decline

    return Assessment(
        affordability_pass=affordability_pass,
        duplicate_check_pass=not has_duplicate_national_id,
        blacklist_check_pass=not borrower.blacklisted,
        score=score,
        score_recommendation=recommendation,
        required_approver_role=_required_role(product, amount),
    )


async def next_reference(db: AsyncSession, lender_id: str) -> str:
    year = datetime.now(timezone.utc).year
    count = await db.scalar(
        select(func.count()).select_from(Application).where(Application.lender_id == lender_id)
    )
    return f"APP-{year}-{str((count or 0) + 1).zfill(4)}"
