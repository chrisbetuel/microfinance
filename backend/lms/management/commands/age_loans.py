from datetime import date

from django.core.management.base import BaseCommand

from lms.models import Lender
from lms.services import aging
from lms.services.audit import record


class Command(BaseCommand):
    help = "Age active loans: mark instalments overdue, accrue penalties, refresh arrears. Run daily."

    def add_arguments(self, parser):
        parser.add_argument("--as-of", help="YYYY-MM-DD, defaults to today")
        parser.add_argument("--lender", help="restrict to one lender id")

    def handle(self, *args, **opts):
        as_of = date.fromisoformat(opts["as_of"]) if opts.get("as_of") else None
        lenders = Lender.objects.all()
        if opts.get("lender"):
            lenders = lenders.filter(pk=opts["lender"])

        for lender in lenders:
            results = aging.age_all(lender=lender, as_of=as_of)
            if not results:
                continue
            in_arrears = [r for r in results if r.days_in_arrears > 0]
            closed = [r for r in results if r.closed]
            admin = lender.staff.filter(role__in=("lender_admin", "platform_admin")).first()
            if admin:
                record(
                    admin, "aged", "portfolio", lender.id,
                    f"{len(results)} loan(s) aged · {len(in_arrears)} in arrears · {len(closed)} closed",
                )
            self.stdout.write(
                f"{lender.name}: {len(results)} aged, {len(in_arrears)} in arrears, {len(closed)} closed"
            )
