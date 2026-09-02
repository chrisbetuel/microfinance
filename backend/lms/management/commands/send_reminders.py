from django.core.management.base import BaseCommand

from lms.enums import LoanStatus
from lms.models import Loan
from lms.services import notify


class Command(BaseCommand):
    help = "Send an SMS reminder for every loan that is at least N days in arrears."

    def add_arguments(self, parser):
        parser.add_argument("--min-days", type=int, default=1)
        parser.add_argument("--lender", help="restrict to one lender id")

    def handle(self, *args, **opts):
        qs = (
            Loan.objects.filter(status=LoanStatus.ACTIVE, days_in_arrears__gte=opts["min_days"])
            .select_related("lender", "borrower")
        )
        if opts.get("lender"):
            qs = qs.filter(lender_id=opts["lender"])

        sent = failed = 0
        for loan in qs:
            n = notify.arrears_reminder(loan.lender, loan.borrower, loan)
            if n.status == "sent":
                sent += 1
            else:
                failed += 1
        self.stdout.write(f"reminders: {sent} sent, {failed} not sent")
