"""Group portal: a read-only login for a solidarity group's leaders.

Portal tokens are signed with Django's signing framework (not staff JWTs), so a
portal login can never reach the staff API, and a staff token can't be used on
the portal endpoints.
"""

from __future__ import annotations

from django.core import signing
from django.utils import timezone

from lms.enums import LoanStatus
from lms.models import Loan, PortalAccount, Repayment

SALT = "lms-group-portal"
MAX_AGE = 12 * 60 * 60  # seconds


def issue_token(account: PortalAccount) -> str:
    return signing.dumps({"pa": str(account.pk)}, salt=SALT)


def account_from_header(header: str) -> PortalAccount | None:
    """`Authorization: Portal <token>` → the active account, or None."""
    if not header or not header.startswith("Portal "):
        return None
    try:
        data = signing.loads(header[len("Portal "):], salt=SALT, max_age=MAX_AGE)
    except signing.BadSignature:  # includes expiry
        return None
    return PortalAccount.objects.select_related("group", "lender").filter(pk=data.get("pa"), active=True).first()


def payment_instructions(lender) -> dict:
    return {
        "number": lender.mobile_money_number,
        "network": lender.mobile_money_network,
        "account_name": lender.mobile_money_account_name or lender.name,
    }


def snapshot(account: PortalAccount) -> dict:
    """What the group sees: its members' loans, payments, savings and meetings."""
    group = account.group
    lender = account.lender
    today = timezone.localdate()
    members = list(group.memberships.select_related("borrower").filter(active=True))
    loans = list(
        Loan.objects.filter(group=group).exclude(status=LoanStatus.REVERSED)
        .select_related("borrower").prefetch_related("schedule")
    )
    member_rows = []
    for m in members:
        own = [l for l in loans if l.borrower_id == m.borrower_id and l.status == LoanStatus.ACTIVE]
        nxt = min((i for l in own for i in l.schedule.all() if i.status != "paid"), key=lambda i: i.due_date, default=None)
        member_rows.append({
            "name": m.borrower.full_name,
            "role": m.role,
            "membership_number": m.membership_number,
            "loan_numbers": [l.loan_number for l in own],
            "outstanding": round(sum(float(l.outstanding_balance) for l in own), 2),
            "overdue": round(sum(float(l.arrears_amount) for l in own if l.days_in_arrears > 0), 2),
            "days_overdue": max((l.days_in_arrears for l in own), default=0),
            "next_due_date": nxt.due_date if nxt else None,
            "next_payment": round(float(nxt.total_due) - float(nxt.paid_amount), 2) if nxt else 0,
        })
    payments = (
        Repayment.objects.filter(loan__group=group, reversed=False)
        .select_related("loan__borrower").order_by("-payment_date", "-date")[:30]
    )
    meetings = group.meetings.prefetch_related("attendance").order_by("-date")[:10]
    active = [l for l in loans if l.status == LoanStatus.ACTIVE]
    paid_total = sum(float(r.amount) for r in Repayment.objects.filter(loan__group=group, reversed=False))
    return {
        "group": {
            "name": group.name, "number": group.group_number, "status": group.status,
            "meeting": f"{group.meeting_frequency} on {group.meeting_day}".strip(), "meeting_location": group.meeting_location,
        },
        "lender": {"name": lender.name, "phone": lender.phone, "currency": lender.currency},
        "as_of": today,
        "totals": {
            "members": len(members),
            "active_loans": len(active),
            "outstanding": round(sum(float(l.outstanding_balance) for l in active), 2),
            "overdue": round(sum(float(l.arrears_amount) for l in active if l.days_in_arrears > 0), 2),
            "repaid": round(paid_total, 2),
            "savings": round(sum(float(getattr(m.borrower, "savings_account").balance) for m in members
                                 if hasattr(m.borrower, "savings_account")), 2),
        },
        "members": member_rows,
        "payments": [
            {"date": r.payment_date, "member": r.loan.borrower.full_name, "loan_number": r.loan.loan_number,
             "amount": float(r.amount), "receipt": r.receipt_number, "method": r.channel}
            for r in payments
        ],
        "meetings": [
            {"date": mt.date, "present": sum(1 for a in mt.attendance.all() if a.present),
             "members": len(mt.attendance.all()), "collected": float(mt.collection_amount)}
            for mt in meetings
        ],
        "pay_to": payment_instructions(lender),
    }
