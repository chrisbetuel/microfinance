"""Online payments: start collections/payouts and settle them on callback."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from lms.enums import LoanStatus
from lms.integrations import payments
from lms.models import Loan, LoanProduct, PaymentTransaction
from lms.services import audit, disbursements, notify
from lms.services import loans as loan_service

NETWORKS = {"mpesa": "M-Pesa", "tigopesa": "Tigo Pesa", "airtel": "Airtel Money", "halopesa": "HaloPesa", "bank": "Bank"}


class GatewayError(Exception):
    pass


def _reference(lender, prefix: str) -> str:
    n = PaymentTransaction.objects.filter(lender=lender).count() + 1
    return f"{prefix}-{n:06d}"


def start_collection(*, staff, loan: Loan, phone: str, amount: float, network: str) -> PaymentTransaction:
    """Ask the customer to pay `amount` toward `loan` from their mobile wallet."""
    if loan.status != LoanStatus.ACTIVE:
        raise GatewayError("This loan is not active")
    if amount <= 0:
        raise GatewayError("Amount must be positive")
    if amount > float(loan.outstanding_balance) + 0.01:
        raise GatewayError(f"Amount exceeds the outstanding balance of {float(loan.outstanding_balance):,.0f}")
    provider = payments.get_provider()
    tx = PaymentTransaction.objects.create(
        lender=loan.lender, reference=_reference(loan.lender, "PAY"), direction=PaymentTransaction.Direction.INBOUND,
        network=network, provider=provider.name, phone=phone, amount=amount,
        borrower=loan.borrower, loan=loan, initiated_by=staff,
    )
    result = provider.collect(phone, amount, tx.reference, network)
    _record_start(tx, result)
    audit.record(staff, "requested", "payment", tx.id,
                 f"{NETWORKS.get(network, network)} payment request of {amount:,.0f} sent to {phone} ({tx.reference})")
    return tx


def _record_start(tx: PaymentTransaction, result) -> None:
    if result.accepted:
        tx.provider_ref = result.provider_ref[:100]
        tx.save(update_fields=["provider_ref"])
    else:
        tx.status = PaymentTransaction.Status.FAILED
        tx.failure_reason = (result.error or "Rejected by the payment gateway")[:250]
        tx.completed_at = timezone.now()
        tx.save(update_fields=["status", "failure_reason", "completed_at"])


def settle(tx: PaymentTransaction, *, success: bool, receipt: str = "", reason: str = "", payload: dict | None = None) -> PaymentTransaction:
    """Apply the gateway's final answer. Safe to call twice — only a pending
    transaction changes."""
    with transaction.atomic():
        tx = PaymentTransaction.objects.select_for_update().get(pk=tx.pk)
        if tx.status != PaymentTransaction.Status.PENDING:
            return tx
        tx.callback_payload = payload or {}
        tx.receipt = (receipt or "")[:100]
        tx.completed_at = timezone.now()
        if not success:
            tx.status = PaymentTransaction.Status.FAILED
            tx.failure_reason = (reason or "Declined or timed out")[:250]
            tx.save(update_fields=["status", "failure_reason", "receipt", "completed_at", "callback_payload"])
            if tx.direction == PaymentTransaction.Direction.OUTBOUND:
                disbursements.on_payout_settled(tx, success=False, reason=tx.failure_reason)
            return tx

        tx.status = PaymentTransaction.Status.SUCCESS
        if tx.direction == PaymentTransaction.Direction.INBOUND:
            _apply_collection(tx)
        else:
            _apply_payout(tx)
        tx.save()
    return tx


def _apply_collection(tx: PaymentTransaction) -> None:
    loan = Loan.objects.select_related("borrower").prefetch_related("schedule").get(pk=tx.loan_id)
    if loan.status != LoanStatus.ACTIVE:
        tx.failure_reason = "Money received but the loan is no longer active — refund or reallocate manually"
        return
    amount = min(float(tx.amount), float(loan.outstanding_balance))
    if amount < float(tx.amount):
        tx.failure_reason = f"{float(tx.amount) - amount:,.0f} received above the balance — refund manually"
    product = LoanProduct.objects.prefetch_related("fees").get(pk=loan.product_id)
    repayment = loan_service.post_repayment(
        loan=loan, product=product, amount=amount, channel="mobile_money",
        recorded_by=f"{NETWORKS.get(tx.network, tx.network)} ({tx.receipt or tx.provider_ref})",
        reference=tx.receipt or tx.provider_ref, received_by=tx.initiated_by, branch_id=loan.branch_id,
        collection_point=NETWORKS.get(tx.network, tx.network),
        reconciliation_status="reconciled", reconciled_at=timezone.now(), reconciled_by="Payment gateway",
        reconciliation_note=f"Confirmed by the payment gateway ({tx.reference})",
    )
    tx.repayment = repayment
    audit.record(tx.initiated_by, "received", "payment", tx.id,
                 f"{amount:,.0f} received via {NETWORKS.get(tx.network, tx.network)} {tx.receipt}, receipt {repayment.receipt_number}")
    transaction.on_commit(lambda: _after_collection(tx.lender_id, loan.pk, repayment.pk))


def _after_collection(lender_id, loan_id, repayment_id):
    from lms.models import Repayment

    loan = Loan.objects.select_related("borrower", "lender").get(pk=loan_id)
    notify.receipt(loan.lender, loan.borrower, Repayment.objects.get(pk=repayment_id))
    if loan.status == LoanStatus.CLOSED:
        notify.completed(loan.lender, loan.borrower, loan)


def _apply_payout(tx: PaymentTransaction) -> None:
    """A payout started by a disbursement's release: confirming it opens the loan."""
    tx.save()
    disbursements.on_payout_settled(tx, success=True)
    tx.refresh_from_db()
