"""Controlled loan disbursement.

    approved application → prepared → under verification → authorised
        → processing (money released) → successful (transaction confirmed)

with failed / cancelled / reversed as the other outcomes. An approved loan is
not a disbursed loan: the Loan, its repayment schedule and its ledger postings
are only created when the transfer is confirmed — by the payment gateway's
callback for mobile money, or by the cashier recording the transaction
reference for bank, cash and wallet payments.
"""

from __future__ import annotations

import re

from django.db import transaction
from django.utils import timezone

from lms.enums import ApplicationStatus, DisbursementChannel, LoanStatus, StaffRole
from lms.integrations import payments
from lms.models import (
    ApplicationEvent,
    Collateral,
    Disbursement,
    DisbursementEvent,
    LoanProduct,
    PaymentTransaction,
    Repayment,
    SavingsTransaction,
)
from lms.services import audit, ledger, notify
from lms.services import loans as loan_service
from lms.services import savings as savings_service

S = Disbursement.Status
OPEN = (S.PENDING, S.UNDER_VERIFICATION, S.APPROVED, S.PROCESSING)
EDITABLE = (S.PENDING, S.UNDER_VERIFICATION)
AUTHORISER_ROLES = (StaffRole.LENDER_ADMIN, StaffRole.BRANCH_MANAGER, StaffRole.CREDIT_COMMITTEE)
NETWORKS = {"mpesa": "M-Pesa", "tigopesa": "Tigo Pesa", "airtel": "Airtel Money", "halopesa": "HaloPesa"}


class DisbursementError(Exception):
    """A request the workflow doesn't allow. `status` is the HTTP code to answer with."""

    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


# ----------------------------------------------------------------- helpers

def _event(d, action: str, staff=None, note: str = "", changes: dict | None = None, by: str = ""):
    DisbursementEvent.objects.create(
        disbursement=d, status=d.status, action=action, note=note or "", changes=changes or {},
        by=by or (staff.name if staff else ""),
    )


def _next_number(lender) -> str:
    return f"DIS-{Disbursement.objects.filter(lender=lender).count() + 1:06d}"


def _digits(value: str) -> str:
    d = re.sub(r"\D", "", value or "")
    return d[-9:]  # compare the subscriber part, so +255 / 0 prefixes match


def _name_tokens(name: str) -> set[str]:
    return {t for t in re.split(r"[^a-z]+", (name or "").lower()) if len(t) > 1}


def _approver_name(application) -> str:
    last = application.approvals.filter(decision="approved").last()
    return last.approver_name if last else ""


def breakdown(application, *, insurance=0, other_deductions=()) -> dict:
    """Approved amount less fees, insurance, compulsory savings and other deductions."""
    product = LoanProduct.objects.prefetch_related("fees").get(pk=application.product_id)
    amount = float(application.amount)
    fees = [
        {"name": f.name, "amount": round(amount * float(f.value) / 100 if f.kind == "percent" else float(f.value), 2)}
        for f in product.fees.all() if f.timing == "deducted"
    ]
    others = [
        {"label": str(x.get("label") or "Deduction")[:80], "amount": round(float(x.get("amount") or 0), 2)}
        for x in other_deductions if float(x.get("amount") or 0) > 0
    ]
    fees_total = round(sum(f["amount"] for f in fees), 2)
    savings = round(amount * float(product.compulsory_savings_percent) / 100, 2)
    insurance = round(float(insurance or 0), 2)
    net = round(amount - fees_total - insurance - savings - sum(o["amount"] for o in others), 2)
    return {
        "approved_amount": amount, "fees": fees, "fees_total": fees_total, "insurance": insurance,
        "savings_deducted": savings, "other_deductions": others, "net_amount": net,
    }


def destination_warnings(application, *, method, recipient_type, name, provider, account) -> list[str]:
    """Where the money is going versus what we know about the borrower."""
    b = application.borrower
    warnings = []
    if recipient_type == "third_party":
        warnings.append("Paying a third party, not the borrower. Confirm the borrower's written authorisation.")
    elif method != DisbursementChannel.WALLET:
        theirs, ours = _name_tokens(name), _name_tokens(b.full_name)
        if not theirs or len(theirs & ours) < min(2, len(ours)):
            warnings.append(f'Account holder "{name or "—"}" does not match the borrower "{b.full_name}"')
    if method == DisbursementChannel.MOBILE_MONEY:
        known = {_digits(p) for p in (b.phone, b.alt_phone, b.mobile_money_number) if _digits(p)}
        if recipient_type == "borrower" and _digits(account) not in known:
            warnings.append("Phone number is not one of the borrower's registered numbers")
        if recipient_type == "borrower" and _digits(account) == _digits(b.phone) and not b.phone_verified:
            warnings.append("The borrower's phone number has not been verified")
        if provider not in NETWORKS:
            warnings.append("Choose the mobile-money network")
    if method in (DisbursementChannel.BANK_TRANSFER, DisbursementChannel.SUPPLIER):
        if not account:
            warnings.append("Bank account number is missing")
        elif recipient_type == "borrower" and b.bank_account and _digits(account) != _digits(b.bank_account):
            warnings.append("Bank account differs from the one on the borrower's profile")
        elif recipient_type == "borrower" and not b.bank_account:
            warnings.append("No bank account on the borrower's profile to compare with")
    if not b.verified:
        warnings.append("The borrower's profile is not verified")
    return warnings


def checks(d) -> dict:
    """The verification checklist shown before authorisation."""
    application = d.application
    docs = list(application.documents.all())
    verified_types = {x.type for x in docs if x.status == "verified"}
    return {
        "loan_approved": application.status == ApplicationStatus.APPROVED,
        "borrower_verified": bool(application.borrower.verified),
        "documents_complete": {"Identification", "Income evidence"} <= verified_types
        and not any(x.status == "rejected" for x in docs),
        "destination_verified": bool(d.destination_verified),
        "net_amount_positive": float(d.net_amount) > 0,
    }


CHECK_LABELS = {
    "loan_approved": "Loan approved",
    "borrower_verified": "Borrower verified",
    "documents_complete": "Documents complete (ID and income evidence verified)",
    "destination_verified": "Destination verified",
    "net_amount_positive": "Net amount is positive",
}


# ----------------------------------------------------------------- workflow

def _apply_details(d, data):
    method = data.get("method", d.method)
    rtype = data.get("recipient_type", d.recipient_type)
    b = d.application.borrower
    if method == DisbursementChannel.WALLET:
        data = {**data, "recipient_type": "borrower", "recipient_name": b.full_name,
                "recipient_provider": "Internal savings wallet", "recipient_account": b.customer_number}
    elif method == DisbursementChannel.CASH and rtype == "borrower":
        data = {**data, "recipient_provider": "Cash at branch", "recipient_account": data.get("recipient_account", "") or b.national_id}
    for field in ("method", "recipient_type", "recipient_name", "recipient_provider", "recipient_account", "authorisation_note"):
        if field in data:
            setattr(d, field, data[field] or "")
    parts = breakdown(
        d.application,
        insurance=data.get("insurance", d.insurance),
        other_deductions=data.get("other_deductions", d.other_deductions or []),
    )
    for k, v in parts.items():
        setattr(d, k, v)
    if parts["net_amount"] <= 0:
        raise DisbursementError("Deductions leave nothing to disburse", 422)
    product = d.application.product
    if product.disbursement_methods and d.method not in product.disbursement_methods:
        raise DisbursementError(f"{d.get_method_display()} is not an allowed disbursement method for {product.name}", 422)
    if product.max_disbursement_amount and parts["net_amount"] > float(product.max_disbursement_amount):
        raise DisbursementError(f"Net amount exceeds the product's maximum disbursement of {float(product.max_disbursement_amount):,.0f}", 422)
    d.warnings = destination_warnings(
        d.application, method=d.method, recipient_type=d.recipient_type, name=d.recipient_name,
        provider=d.recipient_provider, account=d.recipient_account,
    )
    threshold = float(d.lender.dual_authorisation_threshold or 0)
    d.requires_dual_authorisation = threshold > 0 and float(d.approved_amount) >= threshold


def prepare(staff, application, data) -> Disbursement:
    if application.status != ApplicationStatus.APPROVED:
        raise DisbursementError("Only an approved application can be disbursed")
    if Disbursement.objects.filter(application=application, status__in=OPEN).exists():
        raise DisbursementError("A disbursement for this application is already in progress")
    with transaction.atomic():
        d = Disbursement(lender=application.lender, application=application, number=_next_number(application.lender),
                         prepared_by=staff, prepared_at=timezone.now())
        _apply_details(d, data)
        d.save()
        _event(d, "Prepared", staff, f"Net {float(d.net_amount):,.0f} by {d.get_method_display()}")
        audit.record(staff, "prepared", "disbursement", d.id,
                     f"{d.number} prepared for {application.reference}: net {float(d.net_amount):,.0f}")
    return d


def update(staff, d, data) -> Disbursement:
    if d.status not in EDITABLE:
        raise DisbursementError("Only a disbursement that hasn't been authorised can be changed")
    before = {f: getattr(d, f) for f in ("method", "recipient_name", "recipient_provider", "recipient_account",
                                         "recipient_type", "insurance", "net_amount")}
    with transaction.atomic():
        _apply_details(d, data)
        changes = {k: {"from": str(v), "to": str(getattr(d, k))} for k, v in before.items() if str(v) != str(getattr(d, k))}
        reset = d.status == S.UNDER_VERIFICATION or d.verified_by_id or d.authorised_by_id
        # any change sends it back to preparation: verification and authorisation must be redone
        d.status = S.PENDING
        d.verified_by = d.authorised_by = d.second_authorised_by = None
        d.verified_at = d.authorised_at = d.second_authorised_at = None
        d.checks = {}
        d.destination_verified = False
        d.save()
        _event(d, "Changed" + (" — verification reset" if reset else ""), staff, changes=changes)
        audit.record(staff, "updated", "disbursement", d.id, f"{d.number} changed", changes=changes)
    return d


def submit(staff, d) -> Disbursement:
    if d.status != S.PENDING:
        raise DisbursementError("Only a prepared disbursement can be sent for verification")
    d.status = S.UNDER_VERIFICATION
    d.save(update_fields=["status"])
    _event(d, "Sent for verification", staff)
    return d


def verify(staff, d, *, destination_confirmed: bool, override_reason: str = "") -> Disbursement:
    if d.status != S.UNDER_VERIFICATION:
        raise DisbursementError("This disbursement is not awaiting verification")
    if d.prepared_by_id == staff.id:
        raise DisbursementError("You prepared this disbursement — a different person must verify it", 403)
    d.destination_verified = bool(destination_confirmed)
    result = checks(d)
    if not result["loan_approved"]:
        raise DisbursementError("The application is no longer approved")
    failing = [CHECK_LABELS[k] for k, ok in result.items() if not ok]
    if failing and not override_reason.strip():
        raise DisbursementError("Verification incomplete: " + "; ".join(failing) + ". Resolve or give an override reason.", 422)
    with transaction.atomic():
        d.checks = result
        d.override_reason = override_reason.strip() if failing else ""
        d.verified_by = staff
        d.verified_at = timezone.now()
        d.save()
        _event(d, "Verified" + (" with override" if failing else ""), staff, d.override_reason)
        audit.record(staff, "verified", "disbursement", d.id,
                     f"{d.number} verified" + (f" — override: {d.override_reason}" if failing else ""))
    return d


def authorise(staff, d) -> Disbursement:
    if d.status != S.UNDER_VERIFICATION or not d.verified_by_id:
        raise DisbursementError("Verify the disbursement before authorising it")
    if staff.role not in AUTHORISER_ROLES:
        raise DisbursementError("Only a branch manager, credit committee member or administrator can authorise", 403)
    if d.prepared_by_id == staff.id:
        raise DisbursementError("You prepared this disbursement — a different person must authorise it", 403)
    with transaction.atomic():
        if d.authorised_by_id is None:
            d.authorised_by = staff
            d.authorised_at = timezone.now()
            if d.requires_dual_authorisation:
                d.save()
                _event(d, "First authorisation — a second authoriser is required", staff)
                audit.record(staff, "authorised", "disbursement", d.id, f"{d.number} first authorisation")
                return d
        else:
            if d.authorised_by_id == staff.id:
                raise DisbursementError("A second, different person must give the second authorisation", 403)
            d.second_authorised_by = staff
            d.second_authorised_at = timezone.now()
        d.status = S.APPROVED
        d.save()
        _event(d, "Authorised for release", staff)
        audit.record(staff, "authorised", "disbursement", d.id, f"{d.number} authorised for release")
    return d


def release(staff, d, *, reference: str = "") -> Disbursement:
    """Send the money. Mobile money goes through the gateway; other methods wait
    for the cashier to confirm the transaction."""
    if d.status != S.APPROVED:
        raise DisbursementError("Only an authorised disbursement can be released")
    application = d.application
    if application.created_by_id == staff.id:
        raise DisbursementError("You created this application — a different person must release the funds", 403)
    if application.approvals.filter(decision="approved", approver_id=staff.id).exists():
        raise DisbursementError("The approver and the person releasing funds must be different people", 403)
    with transaction.atomic():
        d.status = S.PROCESSING
        d.processed_by = staff
        d.processed_at = timezone.now()
        d.transaction_reference = (reference or "").strip()[:100]
        d.save()
        if d.method == DisbursementChannel.MOBILE_MONEY:
            provider = payments.get_provider()
            tx = PaymentTransaction.objects.create(
                lender=d.lender, reference=d.number, direction=PaymentTransaction.Direction.OUTBOUND,
                network=d.recipient_provider, provider=provider.name, phone=d.recipient_account,
                amount=d.net_amount, borrower=application.borrower, application=application, initiated_by=staff,
            )
            d.payment = tx
            d.save(update_fields=["payment"])
            result = provider.payout(d.recipient_account, float(d.net_amount), tx.reference, d.recipient_provider)
            if result.accepted:
                tx.provider_ref = result.provider_ref[:100]
                tx.save(update_fields=["provider_ref"])
                _event(d, f"Sent to {NETWORKS.get(d.recipient_provider, d.recipient_provider)} — awaiting confirmation", staff)
            else:
                reason = (result.error or "Rejected by the payment gateway")[:250]
                tx.status = PaymentTransaction.Status.FAILED
                tx.failure_reason = reason
                tx.completed_at = timezone.now()
                tx.save(update_fields=["status", "failure_reason", "completed_at"])
                _fail(d, reason, by=staff.name)
        else:
            _event(d, "Money released — awaiting transaction confirmation", staff, d.transaction_reference)
        audit.record(staff, "released", "disbursement", d.id,
                     f"{d.number}: {float(d.net_amount):,.0f} released by {d.get_method_display()}")
    return d


def confirm(staff, d, *, success: bool, reference: str = "", reason: str = "") -> Disbursement:
    if d.status != S.PROCESSING:
        raise DisbursementError("Only a disbursement being processed can be confirmed")
    if d.method == DisbursementChannel.MOBILE_MONEY:
        raise DisbursementError("Mobile-money payouts are confirmed by the payment gateway")
    if success:
        ref = (reference or d.transaction_reference).strip()
        if not ref:
            raise DisbursementError("Enter the transaction reference (bank ref, cash voucher or receipt)", 422)
        return complete(d, reference=ref, by=staff)
    if not reason.strip():
        raise DisbursementError("Give the reason the transfer failed", 422)
    with transaction.atomic():
        _fail(d, reason.strip(), by=staff.name)
        audit.record(staff, "failed", "disbursement", d.id, f"{d.number} failed: {reason.strip()}")
    return d


def _fail(d, reason: str, by: str):
    d.status = S.FAILED
    d.failure_reason = reason[:250]
    d.save(update_fields=["status", "failure_reason"])
    _event(d, "Failed", note=reason, by=by)


def complete(d, *, reference: str, by=None, by_name: str = "", disbursed_on=None) -> Disbursement:
    """The transfer is confirmed: open the loan, activate its schedule and post the ledger."""
    application = d.application
    product = LoanProduct.objects.prefetch_related("fees", "approval_levels").get(pk=application.product_id)
    name = by.name if by else by_name
    with transaction.atomic():
        others = sum(float(x["amount"]) for x in d.other_deductions or [])
        loan = loan_service.create_loan_from_application(
            application=application, product=product, channel=d.method, reference=reference,
            approved_by=_approver_name(application) or "—", disbursed_by=d.processed_by.name if d.processed_by else name,
            fees_deducted=float(d.fees_total) + float(d.insurance) + others, net_disbursed=float(d.net_amount),
            disbursed_on=disbursed_on,
        )
        application.status = ApplicationStatus.DISBURSED
        application.save(update_fields=["status"])
        ApplicationEvent.objects.create(application=application, stage=ApplicationStatus.DISBURSED, by=name,
                                        label=f"Disbursed — {d.number}", note=f"Reference {reference}")
        pledged = application.collateral.filter(loan__isnull=True)
        if not pledged.exists():
            pledged = Collateral.objects.filter(borrower=application.borrower, status=Collateral.Status.PLEDGED, loan__isnull=True)
        Collateral.objects.filter(pk__in=list(pledged.values_list("pk", flat=True))).update(loan=loan, status=Collateral.Status.ACTIVE)
        if d.method == DisbursementChannel.WALLET:
            account = savings_service.account_for(application.lender, application.borrower)
            savings_service.post(account, kind=SavingsTransaction.Kind.DEPOSIT, amount=float(d.net_amount), by_name=name,
                                 note=f"Loan {loan.loan_number} disbursed to wallet ({d.number})")
        d.status = S.SUCCESSFUL
        d.loan = loan
        d.transaction_reference = reference[:100]
        d.confirmed_at = disbursed_on or timezone.now()
        d.confirmed_by = by
        d.save()
        ledger.post_disbursement(d, loan, by=name, date=disbursed_on)
        _event(d, f"Transaction confirmed — loan {loan.loan_number} active, schedule started", by, reference, by=name)
        if by is not None:
            audit.record(by, "disbursed", "loan", loan.id,
                         f"{loan.loan_number}: {float(d.net_amount):,.0f} disbursed via {d.get_method_display()} (ref {reference})")
    notify.disbursed(application.lender, application.borrower, loan)
    return d


def on_payout_settled(tx: PaymentTransaction, *, success: bool, reason: str = "") -> None:
    """Gateway callback for a payout started by `release`."""
    d = Disbursement.objects.filter(payment=tx).select_related("application", "processed_by").first()
    if d is None or d.status != S.PROCESSING:
        return
    if not success:
        _fail(d, reason or "Declined or timed out", by="Payment gateway")
        return
    d = complete(d, reference=tx.receipt or tx.provider_ref or tx.reference, by=d.processed_by)
    tx.loan = d.loan
    tx.save(update_fields=["loan"])


def cancel(staff, d, *, reason: str) -> Disbursement:
    if d.status not in (S.PENDING, S.UNDER_VERIFICATION, S.APPROVED):
        raise DisbursementError("Only a disbursement that hasn't been released can be cancelled")
    if not reason.strip():
        raise DisbursementError("Give a reason for cancelling", 422)
    d.status = S.CANCELLED
    d.cancel_reason = reason.strip()[:250]
    d.save(update_fields=["status", "cancel_reason"])
    _event(d, "Cancelled", staff, d.cancel_reason)
    audit.record(staff, "cancelled", "disbursement", d.id, f"{d.number} cancelled: {d.cancel_reason}")
    return d


def reverse(staff, d, *, reason: str) -> Disbursement:
    """Undo a confirmed disbursement whose money came back (e.g. bounced transfer)."""
    if d.status != S.SUCCESSFUL or d.loan is None:
        raise DisbursementError("Only a successful disbursement can be reversed")
    if staff.role not in AUTHORISER_ROLES:
        raise DisbursementError("Only a manager or administrator can reverse a disbursement", 403)
    if d.processed_by_id == staff.id:
        raise DisbursementError("The person who released the funds can't reverse them", 403)
    if not reason.strip():
        raise DisbursementError("Give the reason for the reversal", 422)
    loan = d.loan
    if Repayment.objects.filter(loan=loan, reversed=False).exists():
        raise DisbursementError("Repayments have been posted on this loan — reverse them first")
    try:
        return _reverse(staff, d, loan, reason)
    except ValueError as exc:  # savings already withdrawn by the client
        raise DisbursementError(f"Can't take back the savings or wallet credit: {exc}")


def _reverse(staff, d, loan, reason: str) -> Disbursement:
    with transaction.atomic():
        loan.status = LoanStatus.REVERSED
        loan.outstanding_balance = 0
        loan.closed_at = timezone.now()
        loan.closure_reason = f"Disbursement reversed: {reason.strip()}"[:250]
        loan.save(update_fields=["status", "outstanding_balance", "closed_at", "closure_reason"])
        loan.collateral.filter(status=Collateral.Status.ACTIVE).update(status=Collateral.Status.PLEDGED, loan=None)
        if float(loan.savings_deducted or 0) > 0:
            account = savings_service.account_for(loan.lender, loan.borrower)
            savings_service.post(account, kind=SavingsTransaction.Kind.WITHDRAWAL, amount=float(loan.savings_deducted),
                                 by_name=staff.name, note=f"Reversal of {d.number}")
        if d.method == DisbursementChannel.WALLET:
            account = savings_service.account_for(loan.lender, loan.borrower)
            savings_service.post(account, kind=SavingsTransaction.Kind.WITHDRAWAL, amount=float(d.net_amount),
                                 by_name=staff.name, note=f"Reversal of {d.number}")
        application = d.application
        application.status = ApplicationStatus.APPROVED  # can be disbursed again
        application.save(update_fields=["status"])
        ApplicationEvent.objects.create(application=application, stage=ApplicationStatus.APPROVED, by=staff.name,
                                        label=f"Disbursement {d.number} reversed", note=reason.strip())
        d.status = S.REVERSED
        d.reversal_reason = reason.strip()[:250]
        d.reversed_by = staff
        d.reversed_at = timezone.now()
        d.save()
        ledger.reverse_disbursement(d, loan, by=staff.name)
        _event(d, "Reversed", staff, d.reversal_reason)
        audit.record(staff, "reversed", "disbursement", d.id, f"{d.number} reversed: {d.reversal_reason}")
    return d
