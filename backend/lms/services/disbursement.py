"""Releasing an approved application as a loan — shared by the cashier
'Disburse' action, batch disbursement and the mobile-money payout callback."""

from __future__ import annotations

from django.db import transaction

from lms.enums import ApplicationStatus
from lms.models import ApplicationEvent, Collateral, Loan, LoanProduct
from lms.services import audit, notify
from lms.services import loans as loan_service
from lms.services.loan_math import total_fee_amount


class DisburseError(Exception):
    """The application can't be released (wrong state or four-eyes rule)."""


def check(staff, application) -> str:
    """Raise DisburseError if `staff` may not release `application`; return the approver's name."""
    if application.status != ApplicationStatus.APPROVED:
        raise DisburseError("Only an approved application can be disbursed")
    if Loan.objects.filter(application=application).exists():
        raise DisburseError("This application has already been disbursed")
    last = application.approvals.all().last()
    approver = last.approver_name if last else "Unknown"
    if approver == staff.name:
        raise DisburseError("The approver and the person releasing funds must be different people")
    if application.created_by_id == staff.id:
        raise DisburseError("You created this application — a different person must release the funds")
    return approver


def net_amount(application) -> float:
    product = LoanProduct.objects.prefetch_related("fees").get(pk=application.product_id)
    amount = float(application.amount)
    fees = total_fee_amount(product, amount, "deducted")
    savings = round(amount * float(product.compulsory_savings_percent) / 100, 2)
    return round(amount - fees - savings, 2)


def disburse(staff, application, channel: str, reference: str) -> Loan:
    approver = check(staff, application)
    product = LoanProduct.objects.prefetch_related("fees", "approval_levels").get(pk=application.product_id)
    with transaction.atomic():
        loan = loan_service.create_loan_from_application(
            application=application, product=product, channel=channel, reference=reference,
            approved_by=approver, disbursed_by=staff.name,
        )
        application.status = ApplicationStatus.DISBURSED
        application.save(update_fields=["status"])
        pledged = application.collateral.filter(loan__isnull=True)
        if not pledged.exists():  # nothing linked on the application: secure with what the borrower pledged
            pledged = Collateral.objects.filter(
                borrower=application.borrower, status=Collateral.Status.PLEDGED, loan__isnull=True
            )
        Collateral.objects.filter(pk__in=list(pledged.values_list("pk", flat=True))).update(
            loan=loan, status=Collateral.Status.ACTIVE
        )
        ApplicationEvent.objects.create(
            application=application, stage=ApplicationStatus.DISBURSED, by=staff.name,
            label=f"Disbursed via {channel.replace('_', ' ')}", note=f"Reference {reference}",
        )
        audit.record(
            staff, "disbursed", "loan", loan.id,
            f"{loan.net_disbursed:,.0f} disbursed via {channel} (ref {reference})",
        )
    notify.disbursed(staff.lender, application.borrower, loan)
    return loan
