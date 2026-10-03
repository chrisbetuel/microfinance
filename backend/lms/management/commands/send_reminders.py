from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from lms.enums import LoanStatus
from lms.models import CollectionActivity, Loan, Repayment
from lms.services import notify
from lms.services.collections import promise_status


class Command(BaseCommand):
    help = (
        "Send SMS reminders: an arrears reminder for every loan at least --min-days overdue, "
        "and an upcoming-payment reminder for instalments due within --upcoming-days."
    )

    def add_arguments(self, parser):
        parser.add_argument("--min-days", type=int, default=1)
        parser.add_argument("--upcoming-days", type=int, default=3, help="0 disables upcoming reminders")
        parser.add_argument("--lender", help="restrict to one lender id")

    def handle(self, *args, **opts):
        base = Loan.objects.filter(status=LoanStatus.ACTIVE).select_related("lender", "borrower")
        if opts.get("lender"):
            base = base.filter(lender_id=opts["lender"])

        sent = failed = 0

        def tally(n):
            nonlocal sent, failed
            if n.status == "sent":
                sent += 1
            else:
                failed += 1

        for loan in base.filter(days_in_arrears__gte=opts["min_days"]):
            tally(notify.arrears_reminder(loan.lender, loan.borrower, loan))

        upcoming = 0
        if opts["upcoming_days"] > 0:
            today = timezone.localdate()
            horizon = today + timedelta(days=opts["upcoming_days"])
            for loan in base.filter(days_in_arrears=0).prefetch_related("schedule"):
                inst = next(
                    (i for i in loan.schedule.all() if i.status != "paid" and today <= i.due_date <= horizon),
                    None,
                )
                if inst is not None:
                    upcoming += 1
                    tally(notify.upcoming(loan.lender, loan.borrower, loan, inst))

        # promise-to-pay day: remind the borrower of what they promised
        promised = 0
        today = timezone.localdate()
        promises = CollectionActivity.objects.filter(kind="promise", promised_date=today, loan__status=LoanStatus.ACTIVE) \
            .select_related("lender", "borrower")
        if opts.get("lender"):
            promises = promises.filter(lender_id=opts["lender"])
        for p in promises:
            if promise_status(p, Repayment.objects.filter(loan_id=p.loan_id, reversed=False)) == "pending":
                promised += 1
                tally(notify.promise_reminder(p.lender, p.borrower, p))

        self.stdout.write(
            f"reminders: {sent} sent, {failed} not sent ({upcoming} upcoming-payment, {promised} promise-to-pay)"
        )
