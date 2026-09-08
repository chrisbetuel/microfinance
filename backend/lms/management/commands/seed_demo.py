"""Populate a ready-to-explore demo workspace.

    python manage.py seed_demo            # create it
    python manage.py seed_demo --reset    # wipe and recreate

Everything runs through the same services the API uses, so the numbers are real.
"""

import random
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from lms.enums import ApplicationStatus, ApprovalDecisionType, StaffRole
from lms.models import (
    Application,
    ApprovalDecision,
    AuditLogEntry,
    Borrower,
    Branch,
    CollectionActivity,
    Lender,
    Loan,
    LoanProduct,
    Notification,
    Repayment,
    SavingsAccount,
    SavingsTransaction,
    Staff,
    TillReconciliation,
)
from lms.services import aging
from lms.services import applications as application_service
from lms.services import loans as loan_service
from lms.services import notify
from lms.services.audit import record as audit_record

DEMO_LENDER = "Sele Microfinance"

PRODUCTS = [
    dict(name="Biashara Working Capital", code="BWC", interest_method="reducing", interest_rate=4,
         interest_period="monthly", repayment_frequency="monthly", min_amount=200_000, max_amount=5_000_000,
         min_term_instalments=3, max_term_instalments=12, penalty_kind="percent", penalty_value=1,
         penalty_cap=50_000, compulsory_savings_percent=5,
         allocation_order=["penalty", "fee", "interest", "principal"],
         security_required=["guarantors"],
         fees=[dict(name="Processing fee", kind="percent", value=2, timing="deducted"),
               dict(name="Insurance", kind="fixed", value=15_000, timing="added")],
         levels=[dict(min_amount=0, max_amount=1_000_000, required_role="branch_manager"),
                 dict(min_amount=1_000_000, max_amount=None, required_role="credit_committee")]),
    dict(name="Micro Daily Trader", code="MDT", interest_method="flat", interest_rate=0.4,
         interest_period="daily", repayment_frequency="daily", min_amount=50_000, max_amount=500_000,
         min_term_instalments=20, max_term_instalments=60, penalty_kind="fixed", penalty_value=500,
         penalty_cap=10_000, allocation_order=["penalty", "fee", "interest", "principal"],
         security_required=["none"],
         fees=[dict(name="Application fee", kind="fixed", value=3_000, timing="deducted")],
         levels=[dict(min_amount=0, max_amount=None, required_role="branch_manager")]),
    dict(name="Asset Finance - Equipment", code="AFE", interest_method="reducing", interest_rate=3.5,
         interest_period="monthly", repayment_frequency="monthly", min_amount=1_000_000, max_amount=20_000_000,
         min_term_instalments=6, max_term_instalments=24, grace_period_days=30, grace_period_applies_to="principal",
         penalty_kind="percent", penalty_value=1.5, penalty_cap=100_000,
         allocation_order=["penalty", "fee", "interest", "principal"], security_required=["collateral", "guarantors"],
         fees=[dict(name="Processing fee", kind="percent", value=1.5, timing="deducted")],
         levels=[dict(min_amount=0, max_amount=5_000_000, required_role="branch_manager"),
                 dict(min_amount=5_000_000, max_amount=None, required_role="credit_committee")]),
]

FIRST = ["Halima", "John", "Zainab", "Daudi", "Amina", "Joseph", "Neema", "Rehema", "Peter", "Grace",
         "Salim", "Fatuma", "Baraka", "Mwajuma", "Emanuel", "Rukia"]
LAST = ["Said", "Mgaya", "Omary", "Kessy", "Rashidi", "Mwakalinga", "Shirima", "Juma", "Kway", "Mushi",
        "Mrisho", "Kilonzo", "Hassan", "Ally", "Massawe", "Ndosi"]
OCCUPATIONS = ["Retail trader", "Tailor", "Carpenter", "Farmer", "Shop owner", "Fishmonger", "Mechanic", "Baker"]


class Command(BaseCommand):
    help = "Create the Sele Microfinance demo workspace"

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true")

    @staticmethod
    def _wipe(lender):
        """Tear a workspace down in dependency order (several FKs are PROTECT)."""
        Repayment.objects.filter(lender=lender).delete()
        Loan.objects.filter(lender=lender).delete()
        CollectionActivity.objects.filter(lender=lender).delete()
        SavingsTransaction.objects.filter(account__lender=lender).delete()
        SavingsAccount.objects.filter(lender=lender).delete()
        TillReconciliation.objects.filter(lender=lender).delete()
        ApprovalDecision.objects.filter(application__lender=lender).delete()
        Application.objects.filter(lender=lender).delete()
        Borrower.objects.filter(lender=lender).delete()
        LoanProduct.objects.filter(lender=lender).delete()
        Notification.objects.filter(lender=lender).delete()
        AuditLogEntry.objects.filter(lender=lender).delete()
        lender.holidays.all().delete()
        Staff.objects.filter(lender=lender).delete()
        Branch.objects.filter(lender=lender).delete()
        lender.delete()

    @transaction.atomic
    def handle(self, *args, **opts):
        rng = random.Random(42)
        existing = Lender.objects.filter(name=DEMO_LENDER).first()
        if existing is not None:
            if not opts["reset"]:
                self.stderr.write(f'"{DEMO_LENDER}" already exists. Pass --reset to rebuild.')
                return
            self._wipe(existing)

        lender = Lender.objects.create(
            name=DEMO_LENDER, licence_number="BOT/MFI/T2/00214", address="Plot 44, Uhuru Street, Dar es Salaam",
            phone="+255 22 211 4400", email="info@sele.co.tz", logo_initials="SM", brand_color="#EE0033",
            currency="TZS", language="sw", plan_level="growth", staff_limit=25, active_loan_limit=2000,
            sms_balance=18_420, sms_sender_name="SELE", sms_sender_approved=True,
        )

        branches = [
            Branch.objects.create(lender=lender, name=n, code=c, location=loc,
                                  opened_on=timezone.localdate() - timedelta(days=d))
            for n, c, loc, d in [("Kariakoo", "KRK", "Dar es Salaam", 1500),
                                 ("Mwanza City", "MWZ", "Mwanza", 900),
                                 ("Arusha Central", "ARS", "Arusha", 400)]
        ]

        def staff(name, role, branch, email, limit=0):
            return Staff.objects.create_user(
                email=email, password="password123", lender=lender, name=name, role=role,
                branch=branch, approval_limit=limit, phone="+255 754 100 000",
            )

        admin = staff("Grace Mushi", StaffRole.LENDER_ADMIN, None, "admin@sele.co", 100_000_000)
        managers = [
            staff("Elias Mrema", StaffRole.BRANCH_MANAGER, branches[0], "elias@sele.co", 3_000_000),
            staff("Amina Rashidi", StaffRole.BRANCH_MANAGER, branches[1], "amina@sele.co", 3_000_000),
            staff("Salim Massawe", StaffRole.BRANCH_MANAGER, branches[2], "salim@sele.co", 3_000_000),
        ]
        officers = [
            staff("Fatuma Kilonzo", StaffRole.LOAN_OFFICER, branches[0], "fatuma@sele.co"),
            staff("Joseph Mwakalinga", StaffRole.LOAN_OFFICER, branches[1], "joseph@sele.co"),
            staff("Baraka Ally", StaffRole.LOAN_OFFICER, branches[2], "baraka@sele.co"),
        ]
        committee = staff("Neema Shirima", StaffRole.CREDIT_COMMITTEE, None, "neema@sele.co", 50_000_000)
        cashier = staff("Rehema Juma", StaffRole.CASHIER, branches[0], "rehema@sele.co")
        staff("Peter Kway", StaffRole.AUDITOR, None, "peter@sele.co")

        products = []
        for spec in PRODUCTS:
            fields = {k: v for k, v in spec.items() if k not in ("fees", "levels")}
            prod = LoanProduct.objects.create(lender=lender, **fields)
            for f in spec["fees"]:
                prod.fees.create(**f)
            for level in spec["levels"]:
                prod.approval_levels.create(**level)
            products.append(prod)

        borrowers = []
        for i in range(14):
            branch = rng.choice(branches)
            officer = next(o for o in officers if o.branch_id == branch.id)
            is_business = i % 4 == 0
            name = f"{FIRST[i]} {LAST[i]}"
            borrowers.append(Borrower.objects.create(
                lender=lender, branch=branch, officer=officer,
                type="business" if is_business else "individual",
                full_name=name,
                business_name=f"{LAST[i]} Enterprises" if is_business else None,
                sector="General trade" if is_business else None,
                years_trading=rng.randint(2, 9) if is_business else None,
                national_id=f"19{rng.randint(70, 99)}{rng.randint(1000, 9999)}-000{i}",
                phone=f"+255 71{rng.randint(2, 9)} {rng.randint(100, 999)} {rng.randint(100, 999)}",
                residence=f"{branch.location}", occupation=rng.choice(OCCUPATIONS),
                monthly_income=rng.choice([350_000, 500_000, 850_000, 1_200_000, 2_400_000]),
                next_of_kin="Family member",
                blacklisted=(i == 13),
                blacklist_reason="Defaulted on a prior loan, 130 days overdue" if i == 13 else None,
            ))
            borrowers[-1].history.create(label="File opened", detail=f"Registered at {branch.name} branch")
            audit_record(officer, "created", "borrower", borrowers[-1].id, f'Borrower "{name}" registered')

        now = timezone.now()
        ref_n = 0

        def make_application(borrower, product, amount, term, days_ago, decision=None, disburse_days_ago=None):
            nonlocal ref_n
            ref_n += 1
            income = float(borrower.monthly_income)
            expenses = income * rng.uniform(0.3, 0.55)
            a = application_service.assess(
                product=product, borrower=borrower, amount=amount, term_instalments=term,
                declared_income=income, declared_expenses=expenses, has_duplicate_national_id=False,
            )
            app = Application.objects.create(
                lender=lender, branch=borrower.branch, reference=f"APP-{now.year}-{ref_n:04d}",
                borrower=borrower, product=product, amount=amount, term_instalments=term,
                purpose=rng.choice(["Restock inventory", "Buy equipment", "Working capital", "Expand shop"]),
                status=ApplicationStatus.PENDING_APPROVAL,
                declared_income=income, declared_expenses=expenses,
                affordability_pass=a.affordability_pass, blacklist_check_pass=a.blacklist_check_pass,
                credit_bureau_consent=True, score=a.score, score_recommendation=a.score_recommendation,
                required_approver_role=a.required_approver_role, created_by=borrower.officer,
                created_at=now - timedelta(days=days_ago),
            )
            audit_record(borrower.officer, "created", "application", app.id,
                         f"Application {app.reference} submitted for {borrower.full_name}")
            approver = None
            if decision:
                approver = committee if a.required_approver_role == "credit_committee" else next(
                    (m for m in managers if m.branch_id == borrower.branch_id), admin
                )
                app.status = ApplicationStatus.APPROVED if decision == "approved" else ApplicationStatus.DECLINED
                app.decline_reason = None if decision == "approved" else "Insufficient repayment capacity"
                app.save(update_fields=["status", "decline_reason"])
                ApprovalDecision.objects.create(
                    application=app, approver=approver, approver_name=approver.name, role=approver.role,
                    decision=ApprovalDecisionType.APPROVED if decision == "approved" else ApprovalDecisionType.DECLINED,
                    comment="Strong history." if decision == "approved" else "Declined by committee.",
                    date=now - timedelta(days=days_ago - 1),
                )
                audit_record(approver, decision, "application", app.id, f"Application {decision} by {approver.name}")
                notify.decision(lender, borrower, app)
            if disburse_days_ago is not None:
                disbursed_on = now - timedelta(days=disburse_days_ago)
                loan = loan_service.create_loan_from_application(
                    application=app, product=product, channel="mobile_money",
                    reference=f"MM-{ref_n:05d}", approved_by=approver.name, disbursed_by=cashier.name,
                    disbursed_on=disbursed_on,
                )
                app.status = ApplicationStatus.DISBURSED
                app.save(update_fields=["status"])
                audit_record(cashier, "disbursed", "loan", loan.id,
                             f"{loan.net_disbursed:,.0f} disbursed via mobile money")
                notify.disbursed(lender, borrower, loan)
                return app, loan
            return app, None

        healthy = [b for b in borrowers if not b.blacklisted]

        # a spread of pending / declined applications
        for b in healthy[:3]:
            prod = products[0]
            make_application(b, prod, rng.choice([600_000, 1_200_000, 2_000_000]), 6, days_ago=rng.randint(1, 10))
        make_application(healthy[3], products[2], 6_500_000, 18, days_ago=8)  # pending, committee level
        make_application(healthy[4], products[1], 100_000, 20, days_ago=6, decision="declined")

        # disbursed loans, some current, some overdue
        plans = [
            (healthy[5], products[0], 1_200_000, 6, 40, 3),
            (healthy[6], products[0], 800_000, 6, 75, 4),
            (healthy[7], products[2], 3_000_000, 12, 95, 5),
            (healthy[8], products[1], 300_000, 30, 20, 0),
            (healthy[9], products[0], 1_500_000, 6, 130, 2),   # will be well overdue
            (healthy[10], products[0], 500_000, 4, 15, 1),
        ]
        for borrower, prod, amount, term, disb_days, instalments_paid in plans:
            _, loan = make_application(
                borrower, prod, amount, term, days_ago=disb_days + 3, decision="approved",
                disburse_days_ago=disb_days,
            )
            for _ in range(instalments_paid):
                nxt = loan.schedule.exclude(status="paid").order_by("period").first()
                if not nxt:
                    break
                rp = loan_service.post_repayment(
                    loan=loan, product=prod, amount=float(nxt.total_due),
                    channel=rng.choice(["mobile_money", "cash", "bank"]), recorded_by=cashier.name,
                )
                audit_record(cashier, "recorded", "repayment", rp.id,
                             f"{float(rp.amount):,.0f} received, receipt {rp.receipt_number}")
                notify.receipt(lender, borrower, rp)

        result = aging.age_all(lender=lender)
        in_arrears = sum(1 for r in result if r.days_in_arrears > 0)
        audit_record(admin, "aged", "portfolio", lender.id,
                     f"{len(result)} loans aged, {in_arrears} in arrears")
        for loan in lender.loans.filter(status="active", days_in_arrears__gte=1).select_related("borrower"):
            notify.arrears_reminder(lender, loan.borrower, loan)

        self.stdout.write(self.style.SUCCESS(
            f"Seeded {DEMO_LENDER}: {len(branches)} branches, {Staff.objects.filter(lender=lender).count()} staff, "
            f"{len(products)} products, {len(borrowers)} borrowers, {lender.loans.count()} loans "
            f"({in_arrears} in arrears). Sign in as admin@sele.co / password123."
        ))
