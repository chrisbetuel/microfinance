"""Loan product rules applied to a borrower and a requested loan.

A product holds the rules; an application is checked against them. Intake
checks (eligibility and limits) must pass before an application is accepted;
security checks (guarantors, collateral, documents) must pass before a loan
officer can forward it as recommended for approval.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.db.models import Sum
from django.utils import timezone

from lms.enums import ApplicationStatus, LoanStatus

OPEN_APPLICATION = (
    ApplicationStatus.DRAFT, ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_ASSESSMENT,
    ApplicationStatus.PENDING_APPROVAL,
)


def _check(rule: str, ok: bool, detail: str, stage: str = "intake") -> dict:
    return {"rule": rule, "ok": bool(ok), "detail": detail, "stage": stage}


def _age(dob: date, on: date) -> int:
    return on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))


def intake_checks(product, borrower, *, amount: float, term: int, group=None, income: float | None = None,
                  exclude_application=None) -> list[dict]:
    """Eligibility and borrowing limits, checked when the application is captured."""
    from lms.models import Application, GroupMembership, Loan, SavingsAccount

    today = timezone.localdate()
    out = [
        _check("Product status", product.status == "active", f"Product is {product.status}"),
        _check("Amount", float(product.min_amount) <= amount <= float(product.max_amount),
               f"{float(product.min_amount):,.0f} – {float(product.max_amount):,.0f}"),
        _check("Repayment period", product.min_term_instalments <= term <= product.max_term_instalments,
               f"{product.min_term_instalments} – {product.max_term_instalments} instalments"),
    ]
    if product.min_age:
        dob = borrower.date_of_birth
        out.append(_check("Minimum age", dob is not None and _age(dob, today) >= product.min_age,
                          f"At least {product.min_age} years" + ("" if dob else " — date of birth not recorded")))
    if product.min_membership_days:
        days = (today - timezone.localtime(borrower.created_at).date()).days
        out.append(_check("Membership period", days >= product.min_membership_days,
                          f"Customer for {days} of the required {product.min_membership_days} days"))
    if product.min_savings:
        acct = SavingsAccount.objects.filter(borrower=borrower).first()
        bal = float(acct.balance) if acct else 0.0
        out.append(_check("Minimum savings", bal >= float(product.min_savings),
                          f"Savings {bal:,.0f} of the required {float(product.min_savings):,.0f}"))
    if product.min_monthly_income:
        inc = float(income if income is not None else borrower.monthly_income or 0)
        out.append(_check("Required income", inc >= float(product.min_monthly_income),
                          f"Monthly income {inc:,.0f} of the required {float(product.min_monthly_income):,.0f}"))
    if product.loan_type == "group":
        member = group is not None and GroupMembership.objects.filter(group=group, borrower=borrower, active=True).exists()
        out.append(_check("Group membership", member, "This is a group product — apply through the borrower's group"))
        if group is not None and product.min_group_members:
            n = GroupMembership.objects.filter(group=group, active=True).count()
            out.append(_check("Group size", n >= product.min_group_members,
                              f"{n} active members of the required {product.min_group_members}"))

    loans = Loan.objects.filter(borrower=borrower)
    active = loans.filter(status=LoanStatus.ACTIVE)
    if product.max_active_loans is not None:
        n = active.count()
        out.append(_check("Active loans", n < product.max_active_loans,
                          f"{n} active loan(s); this product allows {product.max_active_loans} before a new one"))
    if product.max_total_outstanding:
        owed = float(active.aggregate(t=Sum("outstanding_balance"))["t"] or 0)
        out.append(_check("Total outstanding", owed + amount <= float(product.max_total_outstanding),
                          f"{owed:,.0f} owed + {amount:,.0f} requested vs limit {float(product.max_total_outstanding):,.0f}"))
    if product.max_increase_percent is not None:
        previous = loans.filter(status=LoanStatus.CLOSED).order_by("-principal").first()
        if previous is not None:
            cap = float(previous.principal) * (1 + float(product.max_increase_percent) / 100)
            out.append(_check("Step-up from previous loan", amount <= cap + 0.01,
                              f"Up to {cap:,.0f} ({float(product.max_increase_percent):g}% above the previous {float(previous.principal):,.0f})"))
    if product.max_group_exposure and group is not None:
        exposure = float(Loan.objects.filter(group=group, product=product, status=LoanStatus.ACTIVE)
                         .aggregate(t=Sum("outstanding_balance"))["t"] or 0)
        out.append(_check("Group exposure", exposure + amount <= float(product.max_group_exposure),
                          f"Group owes {exposure:,.0f} on this product; limit {float(product.max_group_exposure):,.0f}"))
    if product.max_open_applications is not None:
        pending = Application.objects.filter(borrower=borrower, status__in=OPEN_APPLICATION)
        if exclude_application is not None:
            pending = pending.exclude(pk=exclude_application.pk)
        n = pending.count()
        out.append(_check("Open applications", n < product.max_open_applications,
                          f"{n} application(s) already in progress; limit {product.max_open_applications}"))
    return out


def security_checks(product, application) -> list[dict]:
    """Guarantors, collateral and documents required before forwarding for approval."""
    out = []
    security = product.security_required or []
    need_guarantors = max(product.min_guarantors or 0, 1 if "guarantors" in security else 0)
    if need_guarantors:
        n = application.guarantors.count()
        out.append(_check("Guarantors", n >= need_guarantors, f"{n} of {need_guarantors} attached", "security"))
    if "collateral" in security or product.min_collateral_percent:
        value = float(application.collateral.aggregate(t=Sum("estimated_value"))["t"] or 0)
        need = float(application.amount) * float(product.min_collateral_percent or 0) / 100
        ok = value > 0 and value >= need
        out.append(_check("Collateral", ok,
                          f"Value {value:,.0f}" + (f" of the required {need:,.0f} ({float(product.min_collateral_percent):g}% of the loan)" if need else ""),
                          "security"))
    for doc in product.required_documents or []:
        has = application.documents.filter(type__iexact=doc).exclude(status="rejected").exists()
        out.append(_check(f"Document: {doc}", has, "Attached" if has else "Not attached", "security"))
    return out


def failures(checks: list[dict]) -> list[str]:
    return [f"{c['rule']}: {c['detail']}" for c in checks if not c["ok"]]


def first_repayment_date(product, application_date: date) -> date | None:
    """Default first repayment date under the product's rule (None = one period after disbursement)."""
    if product.first_repayment_rule != "day_of_month" or not product.first_repayment_day:
        return None
    day = min(int(product.first_repayment_day), 28)
    candidate = application_date.replace(day=day)
    while candidate < application_date + timedelta(days=14):
        month = candidate.month % 12 + 1
        year = candidate.year + (1 if candidate.month == 12 else 0)
        candidate = candidate.replace(year=year, month=month)
    return candidate
