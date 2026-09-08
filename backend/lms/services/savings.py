"""Compulsory-savings account movements."""

from __future__ import annotations

from lms.models import SavingsAccount, SavingsTransaction


def account_for(lender, borrower) -> SavingsAccount:
    account, _ = SavingsAccount.objects.get_or_create(lender=lender, borrower=borrower)
    return account


def post(account: SavingsAccount, *, kind: str, amount: float, by_name: str, note: str = "") -> SavingsTransaction:
    amount = round(float(amount), 2)
    if kind in (SavingsTransaction.Kind.WITHDRAWAL, SavingsTransaction.Kind.RELEASE):
        if amount > float(account.balance) + 1e-6:
            raise ValueError("Amount exceeds the available savings balance")
        account.balance = round(float(account.balance) - amount, 2)
    else:
        account.balance = round(float(account.balance) + amount, 2)
    account.save(update_fields=["balance"])
    return SavingsTransaction.objects.create(
        account=account, kind=kind, amount=amount, balance_after=account.balance,
        note=note, created_by=by_name,
    )
