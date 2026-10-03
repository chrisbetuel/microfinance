"""Outbound notifications (SMS / email).

Every message is persisted as a `Notification` so the workspace keeps a log,
then handed to the configured delivery backend. In dev the backend just prints;
in production point `LMS_NOTIFICATIONS_BACKEND` at a real gateway integration.
"""

from django.conf import settings
from django.utils import timezone

from lms.integrations import sms
from lms.models import Notification


def _sender_id(lender) -> str:
    """The gateway's configured (approved) sender ID wins; a lender's own name is used only when none is set."""
    return settings.LMS_SMS_SENDER_ID or lender.sms_sender_name


def send(
    lender, *, to: str, kind: str, body: str, borrower=None, channel: str = Notification.Channel.SMS,
    sent_by: str = "System", batch: str = "",
) -> Notification:
    parts = sms.segments(body)
    notification = Notification.objects.create(
        lender=lender, borrower=borrower, channel=channel, to=to or "", kind=kind, body=body,
        segments=parts, sent_by=sent_by, batch=batch,
    )
    if not to:
        return _fail(notification, "no destination address")
    if channel == Notification.Channel.SMS and lender.sms_balance < parts:
        return _fail(notification, "SMS balance exhausted")

    try:
        result = sms.get_provider().send(to, body, sender_id=_sender_id(lender))
    except Exception as exc:  # pragma: no cover - provider-specific
        return _fail(notification, str(exc)[:250])
    if not result.ok:
        return _fail(notification, result.error[:250] or "rejected by SMS gateway")

    notification.status = Notification.Status.SENT
    notification.sent_at = timezone.now()
    notification.provider_ref = result.provider_ref[:100]
    notification.save(update_fields=["status", "sent_at", "provider_ref"])
    if channel == Notification.Channel.SMS:
        lender.sms_balance = max(lender.sms_balance - parts, 0)
        lender.save(update_fields=["sms_balance"])
    return notification


def _fail(notification: Notification, error: str) -> Notification:
    notification.status = Notification.Status.FAILED
    notification.error = error
    notification.save(update_fields=["status", "error"])
    return notification


# --- message templates ----------------------------------------------------

def _money(amount, currency="TZS") -> str:
    return f"{currency} {round(float(amount)):,}"


def receipt(lender, borrower, repayment) -> Notification:
    return send(
        lender, to=borrower.phone, borrower=borrower, kind="receipt",
        body=(
            f"Asante {borrower.full_name}. Received {_money(repayment.amount, lender.currency)}, "
            f"receipt {repayment.receipt_number}."
        ),
    )


def disbursed(lender, borrower, loan) -> Notification:
    return send(
        lender, to=borrower.phone, borrower=borrower, kind="disbursed",
        body=(
            f"{borrower.full_name}, {_money(loan.net_disbursed, lender.currency)} has been disbursed to you "
            f"via {loan.disbursement_channel.replace('_', ' ')}."
        ),
    )


def decision(lender, borrower, application) -> Notification:
    verdict = "approved" if application.status == "approved" else "not approved"
    return send(
        lender, to=borrower.phone, borrower=borrower, kind="decision",
        body=f"{borrower.full_name}, your loan application {application.reference} has been {verdict}.",
    )


def arrears_reminder(lender, borrower, loan) -> Notification:
    return send(
        lender, to=borrower.phone, borrower=borrower, kind="arrears_reminder",
        body=(
            f"{borrower.full_name}, your loan is {loan.days_in_arrears} day(s) overdue with "
            f"{_money(loan.arrears_amount, lender.currency)} due. Please pay at any branch"
            + (f" or{_pay_hint(lender, loan)[4:]}" if lender.mobile_money_number else " or via mobile money.")
        ),
    )


def _pay_hint(lender, loan=None) -> str:
    """ " Pay by mobile money to 0618750312 (ref LN-000012)." — empty if no number is set."""
    if not lender.mobile_money_number:
        return ""
    network = f"{lender.mobile_money_network} " if lender.mobile_money_network else ""
    ref = f" (ref {loan.loan_number})" if loan is not None and getattr(loan, "loan_number", "") else ""
    return f" Pay by {network}mobile money to {lender.mobile_money_number}{ref}."


def upcoming(lender, borrower, loan, instalment) -> Notification:
    due = float(instalment.total_due) - float(instalment.paid_amount)
    return send(
        lender, to=borrower.phone, borrower=borrower, kind="upcoming_payment",
        body=(
            f"{borrower.full_name}, a payment of {_money(due, lender.currency)} is due on "
            f"{instalment.due_date:%d %b %Y}.{_pay_hint(lender, loan)} Thank you for paying on time."
        ),
    )


def promise_reminder(lender, borrower, activity) -> Notification:
    """Reminder on the day a borrower promised to pay."""
    body = (
        f"{borrower.full_name}, this is a reminder of your promise to pay "
        f"{_money(activity.promised_amount, lender.currency)} today.{_pay_hint(lender, activity.loan)} Thank you — {lender.name}."
    )
    return send(lender, borrower=borrower, to=borrower.phone, kind="promise_reminder", body=body)


def completed(lender, borrower, loan) -> Notification:
    return send(
        lender, to=borrower.phone, borrower=borrower, kind="loan_completed",
        body=(
            f"Hongera {borrower.full_name}! Your loan of {_money(loan.principal, lender.currency)} "
            f"is fully paid. Thank you for banking with {lender.name}."
        ),
    )
