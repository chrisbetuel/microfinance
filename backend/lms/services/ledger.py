"""Double-entry ledger for the loan book.

Every money movement posts a balanced journal: disbursements, repayments,
their reversals and write-offs. The loan-portfolio account then holds the
outstanding principal, so Approved → Disbursed → Repaid → Outstanding can be
reconciled from postings rather than from balances someone edited.
Interest, fees and penalties are recognised as income when they are received.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from django.db.models import Sum

from lms.models import LedgerEntry

ACCOUNTS = {
    "loan_portfolio": "Loan portfolio (principal)",
    "cash": "Cash on hand",
    "bank": "Bank",
    "mobile_money": "Mobile-money float",
    "savings_deposits": "Client savings & wallets",
    "fee_income": "Fee income",
    "interest_income": "Interest income",
    "penalty_income": "Penalty income",
    "insurance_payable": "Insurance payable",
    "other_payable": "Other deductions payable",
    "write_off_expense": "Loans written off",
    "suspense": "Suspense (unallocated)",
}

# where the money for each channel moves
CHANNEL_ACCOUNT = {
    "mobile_money": "mobile_money",
    "bank_transfer": "bank",
    "bank": "bank",
    "supplier": "bank",
    "cash": "cash",
    "field": "cash",
    "wallet": "savings_deposits",
}


class UnbalancedJournal(Exception):
    pass


def _d(value) -> Decimal:
    return Decimal(str(round(float(value or 0), 2)))


def _next_journal(lender) -> str:
    last = LedgerEntry.objects.filter(lender=lender).order_by("-journal").values_list("journal", flat=True).first()
    n = int(last.split("-")[1]) + 1 if last else 1
    return f"JNL-{n:06d}"


def post(*, lender, lines, description: str, reference: str = "", by: str = "", date=None,
         loan=None, disbursement=None, repayment=None) -> str:
    """Post one balanced journal. `lines` is [(account, debit, credit)]; zero lines are skipped."""
    rows = [(acc, _d(dr), _d(cr)) for acc, dr, cr in lines if _d(dr) or _d(cr)]
    if not rows:
        return ""
    debits = sum(r[1] for r in rows)
    credits = sum(r[2] for r in rows)
    if debits != credits:
        raise UnbalancedJournal(f"{description}: debits {debits} ≠ credits {credits}")
    journal = _next_journal(lender)
    extra = {"date": date} if date else {}
    LedgerEntry.objects.bulk_create(
        LedgerEntry(
            lender=lender, journal=journal, account=acc, debit=dr, credit=cr, description=description,
            reference=reference, created_by=by, loan=loan, disbursement=disbursement, repayment=repayment, **extra,
        )
        for acc, dr, cr in rows
    )
    return journal


def _mirror(lines):
    return [(acc, cr, dr) for acc, dr, cr in lines]


def disbursement_lines(d) -> list:
    others = sum(float(x["amount"]) for x in d.other_deductions or [])
    channel = CHANNEL_ACCOUNT.get(d.method, "bank")
    return [
        ("loan_portfolio", d.approved_amount, 0),
        (channel, 0, d.net_amount),
        ("fee_income", 0, d.fees_total),
        ("insurance_payable", 0, d.insurance),
        ("savings_deposits", 0, d.savings_deducted),
        ("other_payable", 0, others),
    ]


def post_disbursement(d, loan, by: str, date=None) -> str:
    return post(
        lender=d.lender, lines=disbursement_lines(d), loan=loan, disbursement=d, by=by, date=date,
        description=f"Loan {loan.loan_number} disbursed ({d.number})", reference=d.transaction_reference,
    )


def reverse_disbursement(d, loan, by: str) -> str:
    return post(
        lender=d.lender, lines=_mirror(disbursement_lines(d)), loan=loan, disbursement=d, by=by,
        description=f"Reversal of {d.number} for loan {loan.loan_number}", reference=d.transaction_reference,
    )


def repayment_lines(r) -> list:
    allocated = _d(r.allocation_principal) + _d(r.allocation_interest) + _d(r.allocation_fees) + _d(r.allocation_penalty)
    return [
        (CHANNEL_ACCOUNT.get(r.channel, "cash"), r.amount, 0),
        ("loan_portfolio", 0, r.allocation_principal),
        ("interest_income", 0, r.allocation_interest),
        ("fee_income", 0, r.allocation_fees),
        ("penalty_income", 0, r.allocation_penalty),
        # overpayment plus any cent lost rounding the allocation
        ("suspense", 0, _d(r.amount) - allocated),
    ]


def post_repayment(r, loan, date=None) -> str:
    return post(
        lender=r.lender, lines=repayment_lines(r), loan=loan, repayment=r, by=r.recorded_by, date=date,
        description=f"Repayment {r.receipt_number} on loan {loan.loan_number}", reference=r.receipt_number,
    )


def reverse_repayment(r, loan, by: str) -> str:
    return post(
        lender=r.lender, lines=_mirror(repayment_lines(r)), loan=loan, repayment=r, by=by,
        description=f"Reversal of repayment {r.receipt_number}", reference=r.receipt_number,
    )


def outstanding_principal(loan) -> float:
    agg = LedgerEntry.objects.filter(loan=loan, account="loan_portfolio").aggregate(dr=Sum("debit"), cr=Sum("credit"))
    return float((agg["dr"] or 0) - (agg["cr"] or 0))


def post_write_off(loan, by: str) -> str:
    principal = outstanding_principal(loan)
    return post(
        lender=loan.lender, loan=loan, by=by, description=f"Loan {loan.loan_number} written off",
        lines=[("write_off_expense", principal, 0), ("loan_portfolio", 0, principal)],
    )


def balances(lender) -> dict:
    """Debit-minus-credit balance per account."""
    out = defaultdict(float)
    for row in LedgerEntry.objects.filter(lender=lender).values("account").annotate(dr=Sum("debit"), cr=Sum("credit")):
        out[row["account"]] = float((row["dr"] or 0) - (row["cr"] or 0))
    return {acc: round(out.get(acc, 0.0), 2) for acc in ACCOUNTS}


def reconciliation(lender) -> dict:
    """Approved → Disbursed → Repaid → Outstanding, from the ledger, checked against the loan records."""
    from lms.enums import ApplicationStatus, LoanStatus
    from lms.models import Application, Loan, Repayment

    portfolio = LedgerEntry.objects.filter(lender=lender, account="loan_portfolio")
    disbursed = float(portfolio.filter(disbursement__isnull=False, debit__gt=0).aggregate(t=Sum("debit"))["t"] or 0) \
        - float(portfolio.filter(disbursement__isnull=False, credit__gt=0).aggregate(t=Sum("credit"))["t"] or 0)
    repaid = float(portfolio.filter(repayment__isnull=False).aggregate(t=Sum("credit"))["t"] or 0) \
        - float(portfolio.filter(repayment__isnull=False).aggregate(t=Sum("debit"))["t"] or 0)
    written_off = float(LedgerEntry.objects.filter(lender=lender, account="write_off_expense").aggregate(t=Sum("debit"))["t"] or 0)
    outstanding_ledger = balances(lender)["loan_portfolio"]

    approved_waiting = float(
        Application.objects.filter(lender=lender, status=ApplicationStatus.APPROVED).aggregate(t=Sum("amount"))["t"] or 0
    )
    active = Loan.objects.filter(lender=lender, status=LoanStatus.ACTIVE)
    repaid_principal = {
        row["loan_id"]: float(row["t"] or 0)
        for row in Repayment.objects.filter(loan__in=active, reversed=False).values("loan_id").annotate(t=Sum("allocation_principal"))
    }
    outstanding_loans = sum(float(l.principal) - repaid_principal.get(l.id, 0.0) for l in active)
    return {
        "approved_awaiting_disbursement": round(approved_waiting, 2),
        "disbursed_principal": round(disbursed, 2),
        "repaid_principal": round(repaid, 2),
        "written_off_principal": round(written_off, 2),
        "outstanding_principal_ledger": round(outstanding_ledger, 2),
        "outstanding_principal_loans": round(outstanding_loans, 2),
        "difference": round(outstanding_ledger - outstanding_loans, 2),
    }
