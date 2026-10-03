"""Recording repayments, correcting them, group payments and reconciliation.

Every payment is a transaction: it is allocated to the schedule and the loan's
balance is recalculated from the allocation — never edited by hand. Mistakes are
reversed (the original stays, with the reason) and optionally re-recorded as a
corrected payment linked to it. Reconciliation then matches recorded payments
to the money that actually arrived on bank / mobile-money statements and in the
cash drawer.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from lms.enums import LoanStatus
from lms.models import GroupMembership, GroupPayment, Loan, LoanProduct, Repayment, StatementLine
from lms.services import audit, notify
from lms.services import loans as loan_service

REFERENCE_REQUIRED = {"bank", "mobile_money", "other"}
STATEMENT_SOURCE = {"bank": "bank", "mobile_money": "mobile_money", "cash": "cash", "field": "cash", "other": "bank"}
SOURCES = ("bank", "mobile_money", "cash")


class RepaymentError(Exception):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def _check(loan, *, amount, channel, reference, payment_date, group_payment=None):
    if loan.status != LoanStatus.ACTIVE:
        raise RepaymentError("This loan is not active", 409)
    if amount <= 0:
        raise RepaymentError("Amount must be positive")
    if amount > float(loan.outstanding_balance) + 0.01:
        raise RepaymentError(f"Payment exceeds the outstanding balance of {float(loan.outstanding_balance):,.0f}")
    if payment_date > timezone.localdate():
        raise RepaymentError("The payment date can't be in the future")
    if loan.disbursement_date and payment_date < timezone.localtime(loan.disbursement_date).date():
        raise RepaymentError("The payment date is before the loan was disbursed")
    reference = (reference or "").strip()
    if channel in REFERENCE_REQUIRED and not reference:
        raise RepaymentError("Enter the transaction reference for a bank, mobile-money or other payment")
    if reference:
        dup = Repayment.objects.filter(
            lender=loan.lender, reference__iexact=reference, reversed=False,
            channel__in=[c for c, src in STATEMENT_SOURCE.items() if src == STATEMENT_SOURCE.get(channel)],
        )
        if group_payment is not None:
            dup = dup.exclude(group_payment=group_payment)
        if dup.exists():
            raise RepaymentError(f"Reference {reference} is already recorded (receipt {dup.first().receipt_number})", 409)
    return reference


def record(staff, loan, *, amount: float, channel: str, payment_date=None, reference: str = "", received_by=None,
           branch_id=None, collection_point: str = "", notes: str = "", group_payment=None, corrects=None,
           collection_activity=None, notify_borrower: bool = True) -> Repayment:
    payment_date = payment_date or timezone.localdate()
    reference = _check(loan, amount=amount, channel=channel, reference=reference, payment_date=payment_date,
                       group_payment=group_payment)
    product = LoanProduct.objects.prefetch_related("fees").get(pk=loan.product_id)
    with transaction.atomic():
        repayment = loan_service.post_repayment(
            loan=loan, product=product, amount=amount, channel=channel, recorded_by=staff.name,
            payment_date=payment_date, reference=reference, received_by=received_by or staff,
            branch_id=branch_id or staff.branch_id or loan.branch_id, collection_point=collection_point,
            notes=notes, group_payment=group_payment, corrects=corrects, collection_activity=collection_activity,
        )
        audit.record(
            staff, "recorded", "repayment", repayment.id,
            f"{amount:,.0f} via {channel.replace('_', ' ')}"
            + (f" ref {reference}" if reference else "")
            + f", receipt {repayment.receipt_number}"
            + (f" (corrects {corrects.receipt_number})" if corrects else ""),
        )
    loan.refresh_from_db()
    if notify_borrower:
        _after(loan.pk, repayment.pk)
    return repayment


def _after(loan_id, repayment_id):
    loan = Loan.objects.select_related("borrower", "lender").get(pk=loan_id)
    notify.receipt(loan.lender, loan.borrower, Repayment.objects.get(pk=repayment_id))
    if loan.status == LoanStatus.CLOSED:
        notify.completed(loan.lender, loan.borrower, loan)


def reverse(staff, repayment, *, reason: str, corrected: dict | None = None):
    """Reverse a payment (kept on record with the reason) and optionally record the corrected one."""
    if repayment.reversed:
        raise RepaymentError("This payment has already been reversed", 409)
    if not reason.strip():
        raise RepaymentError("Give the reason for the reversal")
    loan = Loan.objects.prefetch_related("schedule").get(pk=repayment.loan_id)
    product = LoanProduct.objects.prefetch_related("fees").get(pk=loan.product_id)
    with transaction.atomic():
        loan_service.reverse_repayment(
            repayment=repayment, loan=loan, product=product,
            loan_repayments=list(Repayment.objects.filter(loan=loan)), reason=reason.strip(), by_name=staff.name,
        )
        repayment.reversed_by = staff.name
        repayment.reversed_at = timezone.now()
        repayment.save(update_fields=["reversed_by", "reversed_at"])
        StatementLine.objects.filter(repayment=repayment).update(status=StatementLine.Status.UNMATCHED, repayment=None)
        audit.record(staff, "reversed", "repayment", repayment.id,
                     f"Receipt {repayment.receipt_number} reversed: {reason.strip()}")
        new = None
        if corrected:
            loan = Loan.objects.prefetch_related("schedule").get(pk=loan.pk)
            new = record(
                staff, loan, amount=float(corrected["amount"]), channel=corrected.get("channel") or repayment.channel,
                payment_date=corrected.get("payment_date") or repayment.payment_date,
                reference=corrected.get("reference", ""), received_by=repayment.received_by,
                branch_id=repayment.branch_id, collection_point=repayment.collection_point,
                notes=corrected.get("notes") or f"Correction of {repayment.receipt_number}: {reason.strip()}",
                corrects=repayment,
            )
    return repayment, new


# ------------------------------------------------------------------ group payments

def _next_group_number(lender) -> str:
    return f"GPY-{GroupPayment.objects.filter(lender=lender).count() + 1:06d}"


def record_group_payment(staff, group, *, channel, payment_date=None, reference="", collection_point="", notes="",
                         contributions: list[dict]) -> GroupPayment:
    """One payment by the group, split into member contributions on their loans."""
    contributions = [c for c in contributions if float(c.get("amount") or 0) > 0]
    if not contributions:
        raise RepaymentError("Enter at least one member contribution")
    payment_date = payment_date or timezone.localdate()
    members = set(GroupMembership.objects.filter(group=group).values_list("borrower_id", flat=True))
    loans = {}
    for c in contributions:
        loan = Loan.objects.filter(pk=c["loan_id"], lender=group.lender).prefetch_related("schedule").first()
        if loan is None or loan.borrower_id not in members:
            raise RepaymentError("Every contribution must be for a loan of a member of this group")
        if loan.pk in loans:
            raise RepaymentError("A member's loan appears twice")
        loans[loan.pk] = loan
    total = round(sum(float(c["amount"]) for c in contributions), 2)
    with transaction.atomic():
        gp = GroupPayment.objects.create(
            lender=group.lender, group=group, number=_next_group_number(group.lender), amount=total,
            payment_date=payment_date, channel=channel, reference=(reference or "").strip(), received_by=staff,
            collection_point=collection_point, notes=notes, recorded_by=staff.name,
        )
        for c in contributions:
            record(staff, loans[c["loan_id"]], amount=float(c["amount"]), channel=channel, payment_date=payment_date,
                   reference=reference, collection_point=collection_point or group.meeting_location,
                   notes=f"Group payment {gp.number}" + (f" — {notes}" if notes else ""), group_payment=gp)
        audit.record(staff, "recorded", "group_payment", gp.id,
                     f"{group.name}: {total:,.0f} from {len(contributions)} member(s) ({gp.number})")
    return gp


# ------------------------------------------------------------------ reconciliation

def _mark(repayments, *, by: str, note: str):
    Repayment.objects.filter(pk__in=[r.pk for r in repayments]).update(
        reconciliation_status="reconciled", reconciled_at=timezone.now(), reconciled_by=by, reconciliation_note=note[:250],
    )


def _unreconciled(lender, source):
    channels = [c for c, src in STATEMENT_SOURCE.items() if src == source]
    return Repayment.objects.filter(lender=lender, channel__in=channels, reversed=False, reconciliation_status="unreconciled")


def _match_line(line: StatementLine, by: str) -> bool:
    """Try to match one statement line: a group payment by reference and total,
    then a single payment by reference and amount, then by amount within ±3 days."""
    pool = _unreconciled(line.lender, line.source)
    amount = float(line.amount)
    if line.reference:
        gp = GroupPayment.objects.filter(lender=line.lender, reference__iexact=line.reference, amount=line.amount,
                                         statement_line__isnull=True).first()
        if gp and STATEMENT_SOURCE.get(gp.channel) == line.source:
            line.status, line.group_payment = StatementLine.Status.MATCHED, gp
            line.save(update_fields=["status", "group_payment"])
            _mark(gp.repayments.filter(reversed=False), by=by, note=f"Statement {line.date} {line.reference} ({gp.number})")
            return True
        hit = pool.filter(reference__iexact=line.reference, amount=line.amount, group_payment__isnull=True).first()
        if hit:
            return _link(line, hit, by)
    near = [r for r in pool.filter(amount=line.amount, group_payment__isnull=True)
            if abs((r.payment_date - line.date).days) <= 3 and (not line.reference or not r.reference)]
    if len(near) == 1:
        return _link(line, near[0], by)
    return False


def _link(line, repayment, by) -> bool:
    line.status, line.repayment = StatementLine.Status.MATCHED, repayment
    line.save(update_fields=["status", "repayment"])
    _mark([repayment], by=by, note=f"Statement {line.date} {line.reference or line.description}")
    return True


def import_statement(staff, lender, *, source: str, lines: list[dict]) -> dict:
    if source not in SOURCES:
        raise RepaymentError("Unknown statement source")
    batch = f"{source.upper()}-{timezone.now():%Y%m%d%H%M%S}"
    created, duplicates = [], 0
    with transaction.atomic():
        for row in lines:
            amount = round(float(row.get("amount") or 0), 2)
            if amount <= 0:
                continue  # debits / fees are not repayments
            ref = str(row.get("reference") or "").strip()[:100]
            if ref and StatementLine.objects.filter(lender=lender, source=source, reference__iexact=ref, amount=amount).exists():
                duplicates += 1
                continue
            created.append(StatementLine.objects.create(
                lender=lender, source=source, date=row["date"], reference=ref, amount=amount,
                description=str(row.get("description") or "")[:250], batch=batch, imported_by=staff.name,
            ))
        matched = sum(1 for line in created if _match_line(line, staff.name))
        audit.record(staff, "imported", "statement", None,
                     f"{source} statement {batch}: {len(created)} line(s), {matched} matched, {duplicates} duplicate(s) skipped")
    return {"batch": batch, "imported": len(created), "matched": matched, "duplicates": duplicates}


def rematch(staff, lender, source: str) -> int:
    lines = StatementLine.objects.filter(lender=lender, source=source, status=StatementLine.Status.UNMATCHED)
    with transaction.atomic():
        return sum(1 for line in lines if _match_line(line, staff.name))


def match(staff, line: StatementLine, repayment: Repayment):
    if line.status != StatementLine.Status.UNMATCHED:
        raise RepaymentError("This statement line is already matched or ignored", 409)
    if repayment.reversed or repayment.reconciliation_status == "reconciled":
        raise RepaymentError("That payment is reversed or already reconciled", 409)
    if STATEMENT_SOURCE.get(repayment.channel) != line.source:
        raise RepaymentError("The payment's method doesn't match the statement")
    if abs(float(repayment.amount) - float(line.amount)) > 0.01:
        raise RepaymentError("Amounts differ — reverse and correct the payment first")
    with transaction.atomic():
        _link(line, repayment, staff.name)
        audit.record(staff, "matched", "statement", line.id, f"{line.reference or line.date} matched to {repayment.receipt_number}")


def ignore(staff, line: StatementLine, note: str):
    if line.status != StatementLine.Status.UNMATCHED:
        raise RepaymentError("Only an unmatched line can be ignored", 409)
    if not note.strip():
        raise RepaymentError("Say why this line isn't a repayment")
    line.status, line.note = StatementLine.Status.IGNORED, note.strip()[:250]
    line.save(update_fields=["status", "note"])
    audit.record(staff, "ignored", "statement", line.id, f"{line.reference or line.date}: {line.note}")


def unmatch(staff, line: StatementLine):
    if line.status == StatementLine.Status.UNMATCHED:
        raise RepaymentError("This line isn't matched", 409)
    with transaction.atomic():
        targets = []
        if line.repayment_id:
            targets.append(line.repayment_id)
        if line.group_payment_id:
            targets += list(line.group_payment.repayments.values_list("pk", flat=True))
        Repayment.objects.filter(pk__in=targets).update(
            reconciliation_status="unreconciled", reconciled_at=None, reconciled_by="", reconciliation_note="",
        )
        line.status, line.repayment, line.group_payment = StatementLine.Status.UNMATCHED, None, None
        line.save(update_fields=["status", "repayment", "group_payment"])
        audit.record(staff, "unmatched", "statement", line.id, f"{line.reference or line.date} unmatched")


def reconcile_till(lender, cashier_name: str, business_date, till_id) -> int:
    """Closing the drawer proves the day's cash: mark that cashier's cash payments reconciled."""
    rows = Repayment.objects.filter(
        lender=lender, channel__in=["cash", "field"], reversed=False, recorded_by=cashier_name,
        date__date=business_date, reconciliation_status="unreconciled",
    )
    count = rows.count()
    rows.update(reconciliation_status="reconciled", reconciled_at=timezone.now(), reconciled_by=cashier_name,
                reconciliation_note=f"Cash drawer closed for {business_date}")
    return count


def summary(lender, source: str) -> dict:
    channels = [c for c, src in STATEMENT_SOURCE.items() if src == source]
    recorded = Repayment.objects.filter(lender=lender, channel__in=channels, reversed=False)
    lines = StatementLine.objects.filter(lender=lender, source=source)
    latest = lines.order_by("-date").values_list("date", flat=True).first()
    unreconciled = recorded.filter(reconciliation_status="unreconciled")
    missing = unreconciled.filter(payment_date__lt=latest - timedelta(days=3)) if latest else unreconciled.none()

    def total(qs, field="amount"):
        return round(sum(float(getattr(x, field)) for x in qs), 2)

    return {
        "source": source,
        "recorded_count": recorded.count(),
        "recorded_amount": total(recorded),
        "reconciled_count": recorded.filter(reconciliation_status="reconciled").count(),
        "reconciled_amount": total(recorded.filter(reconciliation_status="reconciled")),
        "unreconciled_count": unreconciled.count(),
        "unreconciled_amount": total(unreconciled),
        "missing_from_statement_count": missing.count(),
        "missing_from_statement_amount": total(missing),
        "statement_unmatched_count": lines.filter(status="unmatched").count(),
        "statement_unmatched_amount": total(lines.filter(status="unmatched")),
        "latest_statement_date": latest,
    }
