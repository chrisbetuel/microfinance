"""Collection cases: what we are doing about payments that are due or overdue.

A case opens automatically when an instalment falls due unpaid, follows the
lender's configurable stages, can be assigned to a collection officer, and
closes by itself once the arrears are cleared (resolved) or the loan is repaid
(paid). Every follow-up is a CollectionActivity on the case; payments taken
during collection stay separate Repayment records linked to the activity.

Statuses describe what happened; nothing here labels a borrower "high risk" —
priorities come from objective figures (days overdue, amount, broken promises)
and staff review.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from django.db import transaction
from django.utils import timezone

from lms.enums import LoanStatus
from lms.models import (
    CollectionActivity,
    CollectionCase,
    CollectionCaseEvent,
    Loan,
    Notification,
    Repayment,
    ScheduleInstalment,
)
from lms.services.collections import promise_status

DEFAULT_STAGES = [
    "payment_due", "reminder", "overdue", "contact_attempt", "promise_to_pay",
    "follow_up", "field_visit", "escalation", "resolution",
]
STATUSES = [
    "pending_follow_up", "contacted", "promise_to_pay", "promise_kept", "promise_broken",
    "field_visit_required", "under_review", "escalated", "resolved", "paid",
]
CLOSED = ("resolved", "paid")
AGING_BUCKETS = [("1–7 days", 1, 7), ("8–30 days", 8, 30), ("31–60 days", 31, 60), ("61–90 days", 61, 90), ("90+ days", 91, 10**6)]
SIGNIFICANT_OVERDUE = 1_000_000  # manager alert threshold (lender currency)


def stages_for(lender) -> list[str]:
    return list(lender.collection_stages or DEFAULT_STAGES)


def _event(case, label: str, by: str = "System", note: str = ""):
    CollectionCaseEvent.objects.create(case=case, label=label, note=note, by=by)


def _next_number(lender) -> str:
    return f"COL-{CollectionCase.objects.filter(lender=lender).count() + 1:06d}"


def _stage(lender, preferred: str, current: str = "") -> str:
    stages = stages_for(lender)
    if preferred in stages:
        # never move a case backwards through the stages automatically
        if current in stages and stages.index(current) > stages.index(preferred):
            return current
        return preferred
    return current or stages[0]


# ------------------------------------------------------------------ sync

def sync(lender) -> None:
    """Open cases for loans due/overdue, update promise outcomes, close cleared ones."""
    today = timezone.localdate()
    due_today = set(
        ScheduleInstalment.objects.filter(
            loan__lender=lender, loan__status=LoanStatus.ACTIVE, due_date=today,
        ).exclude(status="paid").values_list("loan_id", flat=True)
    )
    loans = {l.pk: l for l in Loan.objects.filter(lender=lender, status=LoanStatus.ACTIVE)}
    needing = {pk for pk, l in loans.items() if l.days_in_arrears > 0} | due_today
    open_cases = {c.loan_id: c for c in CollectionCase.objects.filter(lender=lender).exclude(status__in=CLOSED)}

    with transaction.atomic():
        for loan_id in needing - set(open_cases):
            loan = loans[loan_id]
            overdue = loan.days_in_arrears > 0
            case = CollectionCase.objects.create(
                lender=lender, loan=loan, number=_next_number(lender), status="pending_follow_up",
                stage=_stage(lender, "overdue" if overdue else "payment_due"),
                next_follow_up=today, next_action="Contact the borrower",
                assigned_to_id=loan.borrower.officer_id,
            )
            _event(case, "Case opened", note=f"{loan.days_in_arrears} days overdue" if overdue else "Instalment due today")
            open_cases[loan_id] = case

        closed_or_gone = {
            c.loan_id: c for c in open_cases.values() if c.loan_id not in loans or c.loan_id not in needing
        }
        for loan_id, case in closed_or_gone.items():
            loan = Loan.objects.get(pk=loan_id)
            case.status = "paid" if loan.status == LoanStatus.CLOSED else "resolved"
            case.stage = _stage(lender, "resolution", case.stage)
            case.closed_at = timezone.now()
            case.resolution_note = case.resolution_note or (
                "Loan fully repaid" if case.status == "paid" else
                "Arrears cleared" if loan.status == LoanStatus.ACTIVE else f"Loan {loan.status.replace('_', ' ')}"
            )
            case.save()
            _event(case, "Case closed — " + case.resolution_note)

        # promise outcomes drive the case status
        for case in open_cases.values():
            if case.status in CLOSED or case.loan_id not in loans:
                continue
            loan = loans[case.loan_id]
            if case.stage in ("payment_due",) and loan.days_in_arrears > 0:
                case.stage = _stage(lender, "overdue", case.stage)
                case.save(update_fields=["stage"])
            promise = (
                CollectionActivity.objects.filter(loan_id=case.loan_id, kind="promise", created_at__gte=case.opened_at)
                .order_by("-created_at").first()
            )
            if promise is None or case.status not in ("promise_to_pay", "promise_kept", "promise_broken"):
                continue
            outcome = promise_status(promise, Repayment.objects.filter(loan_id=case.loan_id, reversed=False))
            new = {"kept": "promise_kept", "broken": "promise_broken"}.get(outcome)
            if new and new != case.status:
                case.status = new
                if new == "promise_broken":
                    case.stage = _stage(lender, "follow_up", case.stage)
                    case.next_follow_up = today
                    case.next_action = "Promise missed — follow up"
                case.save()
                _event(case, "Promise kept" if new == "promise_kept" else "Promise missed",
                       note=f"{float(promise.promised_amount or 0):,.0f} promised for {promise.promised_date}")


# ------------------------------------------------------------------ activity → case

ACTIVITY_EFFECT = {
    # kind: (status, stage)
    "call": ("contacted", "contact_attempt"),
    "message": (None, "reminder"),
    "visit": ("contacted", "field_visit"),
    "promise": ("promise_to_pay", "promise_to_pay"),
    "escalation": ("escalated", "escalation"),
    "note": (None, None),
}


def apply_activity(case, activity, staff) -> None:
    if case is None or case.status in CLOSED:
        return
    status, stage = ACTIVITY_EFFECT.get(activity.kind, (None, None))
    if activity.kind == "call" and activity.outcome == "no_answer":
        status = case.status if case.status != "pending_follow_up" else "pending_follow_up"
    if activity.kind == "visit" and activity.visit_status == "scheduled":
        status = "field_visit_required"
    if activity.kind == "visit" and activity.outcome == "promised":
        status = "promise_to_pay"
    if status:
        case.status = status
    if stage:
        case.stage = _stage(case.lender, stage, case.stage)
    if activity.next_follow_up:
        case.next_follow_up = activity.next_follow_up
    elif activity.kind == "promise" and activity.promised_date:
        case.next_follow_up = activity.promised_date
    elif activity.kind == "visit" and activity.visit_status == "scheduled" and activity.visit_date:
        case.next_follow_up = activity.visit_date
    if activity.next_action:
        case.next_action = activity.next_action
    case.last_contact_at = activity.created_at
    case.save()


def update(case, staff, data: dict) -> None:
    changes = []
    if "assigned_to" in data and data["assigned_to"] != case.assigned_to:
        case.assigned_to = data["assigned_to"]
        case.assigned_by = staff.name
        case.assigned_at = timezone.now()
        changes.append(f"Assigned to {case.assigned_to.name if case.assigned_to else 'nobody'}")
    for field in ("status", "stage", "next_action", "next_follow_up", "resolution_note"):
        if field in data and data[field] != getattr(case, field):
            old = getattr(case, field)
            setattr(case, field, data[field])
            if field in ("status", "stage"):
                changes.append(f"{field.title()}: {str(old).replace('_', ' ')} → {str(data[field]).replace('_', ' ')}")
    if case.status in CLOSED and case.closed_at is None:
        case.closed_at = timezone.now()
    elif case.status not in CLOSED:
        case.closed_at = None
    case.save()
    for c in changes:
        _event(case, c, by=staff.name)


# ------------------------------------------------------------------ figures

def case_figures(case) -> dict:
    """The loan figures a collection officer needs on the case."""
    loan = case.loan
    today = timezone.localdate()
    schedule = list(loan.schedule.all())
    live = loan.status == LoanStatus.ACTIVE
    missed = [i for i in schedule if i.status != "paid" and i.due_date < today] if live else []
    upcoming = next((i for i in schedule if i.status != "paid"), None) if live else None
    reps = list(Repayment.objects.filter(loan=loan, reversed=False))
    last = max(reps, key=lambda r: (r.payment_date, r.date), default=None)
    promises = sorted(
        CollectionActivity.objects.filter(loan=loan, kind="promise", created_at__gte=case.opened_at),
        key=lambda p: p.created_at, reverse=True,
    )
    outcomes = [(p, promise_status(p, reps)) for p in promises]
    open_promise = next((p for p, s in outcomes if s == "pending"), None)
    return {
        "outstanding": float(loan.outstanding_balance) if live else 0.0,
        "overdue_amount": float(loan.arrears_amount) if live else 0.0,
        "days_overdue": loan.days_in_arrears if live else 0,
        "missed_instalments": len(missed),
        "next_due_date": upcoming.due_date if upcoming else None,
        "last_payment_date": last.payment_date if last else None,
        "last_payment_amount": float(last.amount) if last else None,
        "open_promise": {"amount": float(open_promise.promised_amount or 0), "date": open_promise.promised_date}
        if open_promise else None,
        "broken_promises": sum(1 for _, s in outcomes if s == "broken"),
    }


def _due_instalments(lender, start: date, end: date):
    return ScheduleInstalment.objects.filter(
        loan__lender=lender, loan__status__in=[LoanStatus.ACTIVE, LoanStatus.CLOSED], due_date__gte=start, due_date__lte=end,
    )


def dashboard(lender, staff) -> dict:
    sync(lender)
    today = timezone.localdate()
    month_start = today.replace(day=1)
    active = list(Loan.objects.filter(lender=lender, status=LoanStatus.ACTIVE))
    overdue = [l for l in active if l.days_in_arrears > 0]
    due_today = _due_instalments(lender, today, today).exclude(status="paid").values("loan_id").distinct().count()

    month_activities = list(CollectionActivity.objects.filter(lender=lender, created_at__date__gte=month_start))
    all_promises = list(CollectionActivity.objects.filter(lender=lender, kind="promise"))
    repayments_by_loan = defaultdict(list)
    for r in Repayment.objects.filter(lender=lender, reversed=False, loan_id__in={p.loan_id for p in all_promises}):
        repayments_by_loan[r.loan_id].append(r)
    outcomes = [(p, promise_status(p, repayments_by_loan[p.loan_id])) for p in all_promises]
    month_promises = [(p, o) for p, o in outcomes if p.created_at.date() >= month_start]
    promises_due_today = sum(1 for p, o in outcomes if p.promised_date == today and o == "pending")

    case_loans = set(CollectionCase.objects.filter(lender=lender).values_list("loan_id", flat=True))
    recovered = sum(
        float(r.amount) for r in Repayment.objects.filter(
            lender=lender, reversed=False, payment_date__gte=month_start, loan_id__in=case_loans,
        )
    )
    due_rows = list(_due_instalments(lender, month_start, today))
    due_total = sum(float(i.total_due) for i in due_rows)
    collected = sum(min(float(i.paid_amount), float(i.total_due)) for i in due_rows)

    aging = []
    for label, lo, hi in AGING_BUCKETS:
        rows = [l for l in overdue if lo <= l.days_in_arrears <= hi]
        aging.append({"bucket": label, "loans": len(rows), "amount": round(sum(float(l.arrears_amount) for l in rows), 2),
                      "outstanding": round(sum(float(l.outstanding_balance) for l in rows), 2)})

    officers = defaultdict(lambda: {"calls": 0, "visits": 0, "messages": 0, "promises": 0, "escalations": 0, "total": 0})
    for a in month_activities:
        o = officers[a.created_by]
        key = {"call": "calls", "visit": "visits", "message": "messages", "promise": "promises", "escalation": "escalations"}.get(a.kind)
        if key:
            o[key] += 1
        o["total"] += 1
    open_cases = CollectionCase.objects.filter(lender=lender).exclude(status__in=CLOSED).select_related("assigned_to")
    for c in open_cases:
        name = c.assigned_to.name if c.assigned_to_id else "Unassigned"
        officers[name].setdefault("open_cases", 0)
        officers[name]["open_cases"] = officers[name].get("open_cases", 0) + 1

    visits_today = CollectionActivity.objects.filter(lender=lender, kind="visit", visit_date=today).count()
    return {
        "due_today": due_today,
        "overdue_loans": len(overdue),
        "overdue_amount": round(sum(float(l.arrears_amount) for l in overdue), 2),
        "overdue_outstanding": round(sum(float(l.outstanding_balance) for l in overdue), 2),
        "promises_due_today": promises_due_today,
        "field_visits_today": visits_today,
        "recovered_this_month": round(recovered, 2),
        "collection_rate": round(collected / due_total * 100, 1) if due_total else None,
        "due_this_month": round(due_total, 2),
        "collected_this_month": round(collected, 2),
        "promises": {
            "made": len(month_promises),
            "fulfilled": sum(1 for _, o in month_promises if o == "kept"),
            "missed": sum(1 for _, o in month_promises if o == "broken"),
            "pending": sum(1 for _, o in month_promises if o == "pending"),
        },
        "aging": aging,
        "officer_activity": [{"officer": k, **v} for k, v in sorted(officers.items())],
        "open_cases": open_cases.count(),
        "escalated_cases": open_cases.filter(status="escalated").count(),
        "significant_overdue": sum(1 for l in overdue if float(l.arrears_amount) >= SIGNIFICANT_OVERDUE),
        "stages": stages_for(lender),
    }


def timeline(loan) -> list[dict]:
    """Everything that happened on this loan's collection, oldest first."""
    today = timezone.localdate()
    events = []
    for i in loan.schedule.all():
        if i.due_date <= today:
            events.append({"at": f"{i.due_date}T00:00:00", "kind": "due",
                           "label": f"Instalment {i.period} due — {float(i.total_due):,.0f}", "by": ""})
    for n in Notification.objects.filter(lender=loan.lender, borrower=loan.borrower, created_at__gte=loan.created_at):
        events.append({"at": n.created_at.isoformat(), "kind": "sms",
                       "label": f"SMS {n.kind.replace('_', ' ')} ({n.status})", "note": n.body, "by": n.sent_by})
    repayments = list(Repayment.objects.filter(loan=loan))
    for a in CollectionActivity.objects.filter(loan=loan):
        label = {"call": "Phone call", "visit": "Field visit", "message": "Message", "note": "Note",
                 "promise": "Promise to pay", "escalation": "Escalated"}.get(a.kind, a.kind)
        if a.kind == "promise" and a.promised_amount:
            label += f" — {float(a.promised_amount):,.0f} by {a.promised_date}"
        if a.kind == "visit" and a.visit_status == "scheduled":
            label = f"Field visit scheduled for {a.visit_date}"
        events.append({"at": a.created_at.isoformat(), "kind": a.kind, "label": label,
                       "note": a.note, "by": a.created_by, "outcome": a.outcome})
        if a.kind == "promise" and promise_status(a, [r for r in repayments if not r.reversed]) == "broken" and a.promised_date:
            events.append({"at": f"{a.promised_date + timedelta(days=1)}T00:00:00", "kind": "promise_missed",
                           "label": "Promise missed", "by": ""})
    for r in repayments:
        events.append({"at": f"{r.payment_date}T{r.date.astimezone(timezone.get_current_timezone()).time()}" if r.payment_date else r.date.isoformat(),
                       "kind": "payment", "label": f"{float(r.amount):,.0f} payment ({r.receipt_number})",
                       "note": f"Balance updated → {float(r.balance_after):,.0f}" if r.balance_after is not None else "",
                       "by": r.recorded_by})
        if r.reversed:
            events.append({"at": (r.reversed_at or r.date).isoformat(), "kind": "reversal",
                           "label": f"Payment {r.receipt_number} reversed", "note": r.reversal_reason or "", "by": r.reversed_by})
    for c in CollectionCase.objects.filter(loan=loan):
        for e in c.events.all():
            events.append({"at": e.at.isoformat(), "kind": "case", "label": f"{c.number}: {e.label}", "note": e.note, "by": e.by})
    return sorted(events, key=lambda e: e["at"])
