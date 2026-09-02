"""Outbound notifications (SMS / email).

Every message is persisted as a `Notification` so the workspace keeps a log,
then handed to the configured delivery backend. In dev the backend just prints;
in production point `LMS_NOTIFICATIONS_BACKEND` at a real gateway integration.
"""

import logging

from django.conf import settings
from django.utils import timezone

from lms.models import Notification

log = logging.getLogger("lms.notifications")


def _console(notification: Notification) -> None:
    print(f"[notify:{notification.channel}] -> {notification.to}: {notification.body}")


def _logging(notification: Notification) -> None:
    log.info("notify %s -> %s: %s", notification.channel, notification.to, notification.body)


def _noop(notification: Notification) -> None:
    return None


_BACKENDS = {"console": _console, "logging": _logging, "noop": _noop}


def _deliver(notification: Notification) -> None:
    backend = _BACKENDS.get(getattr(settings, "LMS_NOTIFICATIONS_BACKEND", "console"), _console)
    backend(notification)


def send(lender, *, to: str, kind: str, body: str, borrower=None, channel: str = Notification.Channel.SMS) -> Notification:
    notification = Notification.objects.create(
        lender=lender, borrower=borrower, channel=channel, to=to or "", kind=kind, body=body
    )
    if not to:
        notification.status = Notification.Status.FAILED
        notification.error = "no destination address"
        notification.save(update_fields=["status", "error"])
        return notification

    if channel == Notification.Channel.SMS and lender.sms_balance <= 0:
        notification.status = Notification.Status.FAILED
        notification.error = "SMS balance exhausted"
        notification.save(update_fields=["status", "error"])
        return notification

    try:
        _deliver(notification)
    except Exception as exc:  # pragma: no cover - backend-specific
        notification.status = Notification.Status.FAILED
        notification.error = str(exc)[:250]
        notification.save(update_fields=["status", "error"])
        return notification

    notification.status = Notification.Status.SENT
    notification.sent_at = timezone.now()
    notification.save(update_fields=["status", "sent_at"])
    if channel == Notification.Channel.SMS:
        lender.sms_balance = max(lender.sms_balance - 1, 0)
        lender.save(update_fields=["sms_balance"])
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
            f"{_money(loan.arrears_amount, lender.currency)} due. Please pay at any branch or via mobile money."
        ),
    )
