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
    ApplicationDocument,
    ApplicationEvent,
    ApprovalDecision,
    AuditLogEntry,
    Borrower,
    BorrowerGroup,
    Branch,
    Collateral,
    CollectionActivity,
    CollectionCase,
    Disbursement,
    LedgerEntry,
    GroupAttendance,
    GroupHistoryEvent,
    GroupMeeting,
    GroupMembership,
    Lender,
    Loan,
    LoanProduct,
    Notification,
    PaymentTransaction,
    Repayment,
    SavingsAccount,
    SavingsTransaction,
    Staff,
    TillReconciliation,
)
from lms.services import aging, collection_cases
from lms.services import applications as application_service
from lms.services import disbursements as disbursement_service
from lms.services import loans as loan_service
from lms.services import notify
from lms.services.audit import record as audit_record

DEMO_LENDER = "Sele Microfinance"

PRODUCTS = [
    dict(name="Biashara Working Capital", code="BL-001", category="business", interest_method="reducing", interest_rate=4,
         description="Business capital for traders and small enterprises.", default_amount=1_000_000, default_term=6,
         min_age=18, min_guarantors=1, max_active_loans=1, max_increase_percent=50, max_open_applications=1,
         required_documents=["Identification", "Income evidence"], penalty_grace_days=3,
         interest_period="monthly", repayment_frequency="monthly", min_amount=200_000, max_amount=5_000_000,
         min_term_instalments=3, max_term_instalments=12, penalty_kind="percent", penalty_value=1,
         penalty_cap=50_000, compulsory_savings_percent=5,
         allocation_order=["penalty", "fee", "interest", "principal"],
         security_required=["guarantors"],
         fees=[dict(name="Processing fee", kind="percent", value=2, timing="deducted", fee_type="processing"),
               dict(name="Insurance", kind="fixed", value=15_000, timing="added", fee_type="insurance")],
         levels=[dict(min_amount=0, max_amount=1_000_000, required_role="branch_manager"),
                 dict(min_amount=1_000_000, max_amount=None, required_role="credit_committee")]),
    dict(name="Micro Daily Trader", code="MD-001", category="business", interest_method="flat", interest_rate=0.4,
         description="Small daily-repayment loans for market traders.", min_age=18, max_active_loans=1,
         interest_period="daily", repayment_frequency="daily", min_amount=50_000, max_amount=500_000,
         min_term_instalments=20, max_term_instalments=60, penalty_kind="fixed", penalty_value=500,
         penalty_cap=10_000, allocation_order=["penalty", "fee", "interest", "principal"],
         security_required=["none"],
         fees=[dict(name="Application fee", kind="fixed", value=3_000, timing="deducted")],
         levels=[dict(min_amount=0, max_amount=None, required_role="branch_manager")]),
    dict(name="Asset Finance - Equipment", code="AF-001", category="business", interest_method="reducing", interest_rate=3.5,
         description="Finance to buy business equipment, secured on the asset.", min_collateral_percent=100,
         min_guarantors=1, disbursement_methods=["supplier", "bank_transfer"],
         interest_period="monthly", repayment_frequency="monthly", min_amount=1_000_000, max_amount=20_000_000,
         min_term_instalments=6, max_term_instalments=24, grace_period_days=30, grace_period_applies_to="principal",
         penalty_kind="percent", penalty_value=1.5, penalty_cap=100_000,
         allocation_order=["penalty", "fee", "interest", "principal"], security_required=["collateral", "guarantors"],
         fees=[dict(name="Processing fee", kind="percent", value=1.5, timing="deducted")],
         levels=[dict(min_amount=0, max_amount=5_000_000, required_role="branch_manager"),
                 dict(min_amount=5_000_000, max_amount=None, required_role="credit_committee")]),
    dict(name="Emergency Loan", code="EM-001", category="emergency", interest_method="flat", interest_rate=5,
         description="Quick help for urgent personal needs such as medical or school costs.",
         interest_period="monthly", repayment_frequency="monthly", min_amount=50_000, max_amount=1_000_000,
         default_amount=200_000, min_term_instalments=1, max_term_instalments=6, default_term=3,
         penalty_kind="percent", penalty_value=1, penalty_cap=30_000, penalty_grace_days=3,
         allocation_order=["penalty", "fee", "interest", "principal"], security_required=["none"],
         min_age=18, min_membership_days=90, max_active_loans=1, max_open_applications=1,
         disbursement_methods=["mobile_money", "cash"],
         fees=[dict(name="Application fee", kind="fixed", value=5_000, timing="deducted", fee_type="application")],
         levels=[dict(min_amount=0, max_amount=None, required_role="branch_manager")]),
    dict(name="Kilimo Agriculture Loan", code="AG-001", category="agriculture", interest_method="reducing",
         description="Seasonal finance for farming inputs, repaid after harvest.", interest_rate=2.5,
         interest_period="monthly", repayment_frequency="monthly", min_amount=500_000, max_amount=10_000_000,
         min_term_instalments=6, max_term_instalments=18, grace_period_days=90, grace_period_applies_to="principal",
         penalty_kind="percent", penalty_value=1, penalty_cap=100_000, penalty_grace_days=7,
         allocation_order=["penalty", "fee", "interest", "principal"], security_required=["guarantors"],
         min_guarantors=2, min_age=18, max_active_loans=1,
         fees=[dict(name="Processing fee", kind="percent", value=1.5, timing="deducted", fee_type="processing"),
               dict(name="Crop insurance", kind="percent", value=2, timing="deducted", fee_type="insurance")],
         levels=[dict(min_amount=0, max_amount=2_000_000, required_role="branch_manager",
                      required_roles=["loan_officer", "branch_manager"]),
                 dict(min_amount=2_000_000, max_amount=None, required_role="credit_committee",
                      required_roles=["branch_manager", "credit_committee"])]),
    dict(name="Salary Advance", code="SL-001", category="salary", interest_method="flat", interest_rate=3,
         description="Salary-based borrowing for employed customers, repaid from pay.",
         interest_period="monthly", repayment_frequency="monthly", min_amount=100_000, max_amount=5_000_000,
         min_term_instalments=1, max_term_instalments=12, penalty_kind="percent", penalty_value=1, penalty_cap=50_000,
         allocation_order=["penalty", "fee", "interest", "principal"], security_required=["none"],
         min_age=21, min_monthly_income=300_000, required_documents=["Identification", "Income evidence"],
         first_repayment_rule="day_of_month", first_repayment_day=25, disbursement_methods=["bank_transfer", "mobile_money"],
         fees=[dict(name="Processing fee", kind="percent", value=1, timing="deducted", fee_type="processing")],
         levels=[dict(min_amount=0, max_amount=None, required_role="branch_manager")]),
    dict(name="Group Solidarity Loan", code="GL-001", category="group", loan_type="group", min_group_members=3,
         description="Loans to members of a solidarity group, backed by joint liability.", interest_method="flat",
         interest_rate=3, interest_period="monthly", repayment_frequency="weekly", min_amount=500_000,
         max_amount=20_000_000, min_term_instalments=12, max_term_instalments=72, penalty_kind="fixed",
         penalty_value=1_000, penalty_cap=20_000, allocation_order=["penalty", "fee", "interest", "principal"],
         security_required=["group_guarantee"], max_group_exposure=20_000_000, required_documents=["Identification", "Group agreement"],
         fees=[dict(name="Processing fee", kind="percent", value=1, timing="deducted", fee_type="processing")],
         levels=[dict(min_amount=0, max_amount=None, required_role="branch_manager")]),
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
        LedgerEntry.objects.filter(lender=lender).delete()
        Disbursement.objects.filter(lender=lender).delete()
        Repayment.objects.filter(lender=lender).delete()
        Loan.objects.filter(lender=lender).delete()
        CollectionActivity.objects.filter(lender=lender).delete()
        Collateral.objects.filter(lender=lender).delete()
        PaymentTransaction.objects.filter(lender=lender).delete()
        SavingsTransaction.objects.filter(account__lender=lender).delete()
        SavingsAccount.objects.filter(lender=lender).delete()
        TillReconciliation.objects.filter(lender=lender).delete()
        GroupMembership.objects.filter(group__lender=lender).delete()
        BorrowerGroup.objects.filter(lender=lender).delete()
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
                customer_number=f"CUS-{i + 1:05d}",
                verified=i % 5 != 4, phone_verified=i % 5 != 4,
                verified_by=officer.name if i % 5 != 4 else "", verified_at=timezone.now() if i % 5 != 4 else None,
                dependents=rng.randint(0, 5),
                status="blacklisted" if i == 13 else "active",
                gender="female" if i % 2 == 0 else "male",
                marital_status=rng.choice(["single", "married", "married", "widowed"]),
                region=branch.location.split(",")[0] if branch.location else "Dar es Salaam",
                district=branch.name, ward=rng.choice(["Mchikichini", "Kisutu", "Gerezani", "Upanga"]),
                income_source="business" if is_business or i % 3 else "employed",
                monthly_expenses=rng.choice([150_000, 250_000, 400_000, 600_000]),
                mobile_money_provider=rng.choice(["M-Pesa", "Tigo Pesa", "Airtel Money"]),
                mobile_money_number=f"+255 7{rng.randint(10, 99)} {rng.randint(100, 999)} {rng.randint(100, 999)}",
                emergency_name=f"{FIRST[(i + 5) % len(FIRST)]} {LAST[i]}",
                emergency_relationship=rng.choice(["Spouse", "Sibling", "Parent"]),
                emergency_phone=f"+255 75{rng.randint(1, 9)} {rng.randint(100, 999)} {rng.randint(100, 999)}",
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

        # A solidarity group at the Mwanza City branch
        group_branch = branches[1]
        group_officer = next(o for o in officers if o.branch_id == group_branch.id)
        group_members = [b for b in borrowers if b.branch_id == group_branch.id and not b.blacklisted][:4]
        grp = None
        if len(group_members) >= 3:
            formed = (timezone.now() - timedelta(days=120)).date()
            grp = BorrowerGroup.objects.create(
                lender=lender, branch=group_branch, officer=group_officer, name="Umoja Solidarity Group",
                group_number="GRP-0001", group_type="women",
                purpose="Members run small retail stalls at Mwanza central market and borrow to restock together.",
                region="Mwanza", district="Nyamagana", ward="Mirongo", location="Mwanza central market",
                meeting_location="St. Joseph community hall", meeting_day="Wednesday", meeting_frequency="weekly",
                meeting_time="10:00", loan_limit=8_000_000, formed_on=formed, status="active",
            )
            GroupHistoryEvent.objects.create(group=grp, label="Group formed", detail="Umoja Solidarity Group (GRP-0001)",
                                             by=group_officer.name, date=timezone.now() - timedelta(days=120))
            memberships = []
            for idx, member in enumerate(group_members):
                role = ["chair", "secretary", "treasurer", "member"][min(idx, 3)]
                memberships.append(GroupMembership.objects.create(
                    group=grp, borrower=member, role=role, membership_number=f"GRP-0001-{idx + 1:02d}", joined_on=formed,
                ))
            for weeks_ago in (3, 2, 1):
                meeting = GroupMeeting.objects.create(
                    group=grp, date=(timezone.now() - timedelta(weeks=weeks_ago)).date(), location=grp.meeting_location,
                    notes=rng.choice(["Reviewed repayments; all on track.", "Discussed stock prices and a joint purchase.",
                                      "One member late — group agreed to follow up."]),
                    recorded_by=group_officer.name,
                )
                total = 0
                for m in memberships:
                    present = rng.random() > 0.15
                    amount = rng.choice([5_000, 10_000, 10_000, 20_000]) if present else 0
                    total += amount
                    GroupAttendance.objects.create(meeting=meeting, membership=m, present=present, contribution=amount)
                meeting.collection_amount = total
                meeting.save(update_fields=["collection_amount"])
            audit_record(group_officer, "created", "group", grp.id, 'Group "Umoja Solidarity Group" formed')

        now = timezone.now()
        ref_n = 0

        assessment_of = {"recommend": "recommended", "caution": "further_review", "decline": "not_recommended"}

        def release_through_workflow(app, borrower, upto, when):
            """Prepare → verify → authorise → release → confirm, by different people, stopping at `upto`."""
            allowed = app.product.disbursement_methods or []
            if not allowed or "mobile_money" in allowed:
                details = {"method": "mobile_money", "recipient_type": "borrower", "recipient_name": borrower.full_name,
                           "recipient_provider": "mpesa", "recipient_account": borrower.phone}
            else:  # e.g. asset finance paid straight to the equipment supplier
                details = {"method": allowed[0], "recipient_type": "third_party", "recipient_name": "Mwanza Machinery Ltd",
                           "recipient_provider": "CRDB", "recipient_account": "0150448812001",
                           "authorisation_note": "Borrower's signed instruction to pay the supplier"}
            prep = disbursement_service.prepare(cashier, app, details)
            steps = ["pending", "under_verification", "approved", "successful"]
            if steps.index(upto) >= 1:
                disbursement_service.submit(cashier, prep)
            if steps.index(upto) >= 2:
                disbursement_service.verify(admin, prep, destination_confirmed=True,
                                            override_reason="Identity and phone confirmed in person at the branch")
                disbursement_service.authorise(admin, prep)
            if upto == "successful":
                disbursement_service.release(cashier, prep)
                prep.refresh_from_db()
                tx = prep.payment
                if tx is None:  # bank / supplier transfer confirmed by its bank reference
                    disbursement_service.complete(prep, reference=f"CRDB{when:%y%m%d}{ref_n:04d}", by=cashier,
                                                  disbursed_on=when)
                else:
                    tx.status = PaymentTransaction.Status.SUCCESS
                    tx.receipt = f"MP{when:%y%m%d}{ref_n:04d}"
                    tx.completed_at = when
                    tx.save(update_fields=["status", "receipt", "completed_at"])
                    disbursement_service.complete(prep, reference=tx.receipt, by=cashier, disbursed_on=when)
                    tx.loan = prep.loan
                    tx.created_at = when
                    tx.save(update_fields=["loan", "created_at"])
                ApplicationEvent.objects.filter(application=app, stage="disbursed").update(at=when)
            Disbursement.objects.filter(pk=prep.pk).update(
                prepared_at=when - timedelta(hours=5), created_at=when - timedelta(hours=5),
                verified_at=when - timedelta(hours=3) if steps.index(upto) >= 2 else None,
                authorised_at=when - timedelta(hours=2) if steps.index(upto) >= 2 else None,
                processed_at=when - timedelta(minutes=5) if upto == "successful" else None,
            )
            for i, ev in enumerate(prep.events.order_by("at")):
                ev.at = when - timedelta(hours=5) + timedelta(minutes=50 * i)
                ev.save(update_fields=["at"])
            prep.refresh_from_db()
            return prep

        def make_application(borrower, product, amount, term, days_ago, decision=None, disburse_days_ago=None,
                             stage="pending_approval"):
            """Walk an application through the workflow up to `stage` (or the decision)."""
            nonlocal ref_n
            ref_n += 1
            income = float(borrower.monthly_income)
            expenses = round(income * rng.uniform(0.3, 0.55), -3)
            other_income = rng.choice([0, 0, 50_000, 100_000])
            existing = float(borrower.existing_loan_payments or 0)
            a = application_service.assess(
                product=product, borrower=borrower, amount=amount, term_instalments=term,
                declared_income=income + other_income, declared_expenses=expenses, has_duplicate_national_id=False,
                external_repayments=existing, dependents=borrower.dependents or 0,
            )
            submitted_at = now - timedelta(days=days_ago)
            officer = borrower.officer
            app = Application.objects.create(
                lender=lender, branch=borrower.branch, reference=f"APP-{now.year}-{ref_n:04d}",
                borrower=borrower, product=product, amount=amount, term_instalments=term,
                requested_amount=amount, requested_term=term,
                purpose=rng.choice(["Restock inventory", "Buy equipment", "Working capital", "Expand shop"]),
                status=ApplicationStatus.SUBMITTED,
                declared_income=income, declared_expenses=expenses, other_income=other_income,
                existing_repayments=existing, dependents=borrower.dependents or 0,
                loan_officer=officer, application_date=submitted_at.date(), disbursement_method="mobile_money",
                affordability_pass=a.affordability_pass, blacklist_check_pass=a.blacklist_check_pass,
                credit_bureau_consent=True, score=a.score, score_recommendation=a.score_recommendation,
                risk=a.risk, needs_review=a.needs_review,
                required_approver_role=a.required_approver_role, created_by=officer,
                created_at=submitted_at,
            )
            ApplicationEvent.objects.create(application=app, stage="submitted", label="Application submitted",
                                            by=officer.name, at=submitted_at)
            ApplicationDocument.objects.create(application=app, type="Identification", name="nida-card.jpg",
                                               uploaded_by=officer.name, uploaded_at=submitted_at,
                                               status="verified", verified_by=officer.name, verified_at=submitted_at)
            ApplicationDocument.objects.create(application=app, type="Income evidence", name="mpesa-statement-3m.pdf",
                                               uploaded_by=officer.name, uploaded_at=submitted_at,
                                               status="verified" if decision else "pending",
                                               verified_by=officer.name if decision else "",
                                               verified_at=submitted_at if decision else None)
            audit_record(officer, "created", "application", app.id,
                         f"Application {app.reference} submitted for {borrower.full_name}")
            if decision or stage in ("under_assessment", "pending_approval"):
                ApplicationEvent.objects.create(application=app, stage="under_assessment", label="Assessment started",
                                                by=officer.name, at=submitted_at + timedelta(hours=2))
                app.status = ApplicationStatus.UNDER_ASSESSMENT
            if decision or stage == "pending_approval":
                result = assessment_of.get(a.score_recommendation, "recommended")
                if result == "further_review":
                    result = "recommended"
                label = {"recommended": "Recommended", "not_recommended": "Not recommended"}[result]
                notes = ("Business visited; stock and sales records match the declared income."
                         if result == "recommended" else "Repayment capacity is thin for the requested amount.")
                app.assessment_result = result
                app.assessed_amount = amount
                app.recommended_term = term
                app.assessment_notes = notes
                app.assessed_by = officer
                app.assessed_at = submitted_at + timedelta(hours=20)
                app.status = ApplicationStatus.PENDING_APPROVAL
                ApplicationEvent.objects.create(application=app, stage="pending_approval",
                                                label=f"Assessed: {label} — forwarded for approval",
                                                note=notes, by=officer.name, at=app.assessed_at)
            app.save()
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
                ApplicationEvent.objects.create(
                    application=app, stage=app.status, by=approver.name, at=now - timedelta(days=days_ago - 1),
                    label=f"Approved — {amount:,.0f} over {term} instalments" if decision == "approved" else "Declined",
                    note="Strong history." if decision == "approved" else "Declined by committee.",
                )
                audit_record(approver, decision, "application", app.id, f"Application {decision} by {approver.name}")
                notify.decision(lender, borrower, app)
            if disburse_days_ago is not None:
                disbursed_on = now - timedelta(days=disburse_days_ago)
                d = release_through_workflow(app, borrower, upto="successful", when=disbursed_on)
                return app, d.loan
            return app, None

        healthy = [b for b in borrowers if not b.blacklisted]

        # a spread of pending / declined applications
        for b, stage in zip(healthy[:3], ["submitted", "under_assessment", "pending_approval"]):
            prod = products[0]
            make_application(b, prod, rng.choice([600_000, 1_200_000, 2_000_000]), 6, days_ago=rng.randint(1, 10),
                             stage=stage)
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
                channel = rng.choice(["mobile_money", "cash", "bank"])
                paid_on = min(nxt.due_date - timedelta(days=rng.randint(0, 3)), now.date())
                ref = {"mobile_money": f"MP{paid_on:%y%m%d}{rng.randint(1000, 9999)}",
                       "bank": f"NMB{rng.randint(100000, 999999)}", "cash": ""}[channel]
                rp = loan_service.post_repayment(
                    loan=loan, product=prod, amount=float(nxt.total_due), channel=channel, recorded_by=cashier.name,
                    payment_date=paid_on, reference=ref, received_by=cashier, branch_id=loan.branch_id,
                    collection_point={"cash": "Branch till", "bank": "NMB deposit", "mobile_money": "M-Pesa"}[channel],
                )
                audit_record(cashier, "recorded", "repayment", rp.id,
                             f"{float(rp.amount):,.0f} received, receipt {rp.receipt_number}")
                notify.receipt(lender, borrower, rp)

        # approved loans waiting at different points of the disbursement workflow
        for borrower, stage in zip(healthy[11:13], ["approved", "under_verification"]):
            app, _ = make_application(borrower, products[0], 900_000, 6, days_ago=4, decision="approved")
            if stage == "under_verification":
                release_through_workflow(app, borrower, upto="under_verification", when=now - timedelta(days=1))

        if grp is not None:  # members' loans were taken as group loans
            member_ids = [m.borrower_id for m in grp.memberships.all()]
            Application.objects.filter(lender=lender, borrower_id__in=member_ids).update(group=grp)
            for group_app in Application.objects.filter(group=grp):
                group_app.group_members.set([group_app.borrower_id])
            Loan.objects.filter(lender=lender, borrower_id__in=member_ids).update(group=grp)

        result = aging.age_all(lender=lender)
        in_arrears = sum(1 for r in result if r.days_in_arrears > 0)
        audit_record(admin, "aged", "portfolio", lender.id,
                     f"{len(result)} loans aged, {in_arrears} in arrears")
        for loan in lender.loans.filter(status="active", days_in_arrears__gte=1).select_related("borrower"):
            notify.arrears_reminder(lender, loan.borrower, loan)

        # collection cases for the arrears, with a realistic follow-up history
        collection_cases.sync(lender)
        today = timezone.localdate()
        for n, case in enumerate(CollectionCase.objects.filter(lender=lender).select_related("loan__borrower").order_by("-loan__days_in_arrears")):
            officer = case.loan.borrower.officer
            amount = round(float(case.loan.arrears_amount), -3)

            def log(days_ago, **kw):
                a = CollectionActivity.objects.create(
                    lender=lender, loan=case.loan, borrower=case.loan.borrower, case=case,
                    created_by=officer.name, **kw,
                )
                CollectionActivity.objects.filter(pk=a.pk).update(created_at=now - timedelta(days=days_ago))
                a.refresh_from_db()
                collection_cases.apply_activity(case, a, officer)

            log(9, kind="call", outcome="no_answer", note="Phone off.", next_follow_up=today - timedelta(days=8))
            log(8, kind="call", outcome="promised", note="Business slow after market closure; will pay end of week.")
            if n == 0:
                log(8, kind="promise", outcome="promised", promised_amount=amount, promised_date=today - timedelta(days=4),
                    reason="Market stall closed for repairs", next_action="Check payment on promise date")
                log(0, kind="visit", outcome="", visit_status="scheduled", visit_date=today, location="Borrower's shop",
                    purpose="Follow up the missed promise", next_action="Field visit")
            else:
                log(1, kind="promise", outcome="promised", promised_amount=amount, promised_date=today + timedelta(days=2),
                    reason="Waiting for a customer to pay an invoice", next_action="Confirm payment")
        collection_cases.sync(lender)

        self.stdout.write(self.style.SUCCESS(
            f"Seeded {DEMO_LENDER}: {len(branches)} branches, {Staff.objects.filter(lender=lender).count()} staff, "
            f"{len(products)} products, {len(borrowers)} borrowers, {lender.loans.count()} loans "
            f"({in_arrears} in arrears). Sign in as admin@sele.co / password123."
        ))
