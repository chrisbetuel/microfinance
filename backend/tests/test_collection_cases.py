"""Collection cases: opened for arrears, driven by follow-ups, assigned by
managers, closed when the arrears clear — with payments kept as separate,
linked repayment records."""

from datetime import date, timedelta

import pytest
from django.core.management import call_command

from lms.models import CollectionActivity
from tests.conftest import Actor, borrower_payload, forward_for_approval, make_staff, product_payload, release_loan

AS_OF = (date.today() + timedelta(days=90)).isoformat()


@pytest.fixture
def t(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"])
    borrower = officer.post("/borrowers", borrower_payload(branch["id"])).json()
    app = officer.post("/applications", {
        "borrowerId": borrower["id"], "productId": product["id"], "branchId": branch["id"],
        "amount": 1_200_000, "termInstalments": 6, "purpose": "x",
        "declaredIncome": 900_000, "declaredExpenses": 300_000, "creditBureauConsent": True,
    }).json()
    forward_for_approval(app["id"])
    manager.post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    loan = release_loan(cashier, app["id"], "cash", "R1")
    call_command("age_loans", "--as-of", AS_OF)
    return {"admin": admin, "officer": officer, "manager": manager, "cashier": cashier, "borrower": borrower, "loan": loan}


def _case(t):
    [case] = [c for c in t["officer"].get("/collections/cases").json() if c["loanId"] == t["loan"]["id"]]
    return case


def test_overdue_loan_opens_an_assigned_case(t):
    case = _case(t)
    assert case["number"].startswith("COL-")
    assert case["status"] == "pending_follow_up" and case["stage"] == "overdue"
    assert case["assignedToId"] == t["officer"].staff["id"]  # the borrower's loan officer
    assert case["daysOverdue"] > 0 and case["overdueAmount"] > 0
    assert case["outstanding"] > case["overdueAmount"]
    assert case["loanNumber"].startswith("LN-")


def test_follow_ups_move_the_case(t):
    lid = t["loan"]["id"]
    nxt = (date.today() + timedelta(days=2)).isoformat()
    call = t["officer"].post(f"/loans/{lid}/collection-activities", {
        "kind": "call", "outcome": "reached", "note": "Said payment comes Friday", "nextFollowUp": nxt,
        "nextAction": "Call again Friday",
    })
    assert call.status_code == 201, call.content
    assert call.json()["caseId"] == _case(t)["id"]
    case = _case(t)
    assert case["status"] == "contacted" and case["stage"] == "contact_attempt"
    assert case["nextFollowUp"] == nxt and case["nextAction"] == "Call again Friday"

    # a promise needs an amount and a date
    assert t["officer"].post(f"/loans/{lid}/collection-activities", {"kind": "promise", "promisedAmount": 150_000}).status_code == 400
    t["officer"].post(f"/loans/{lid}/collection-activities", {
        "kind": "promise", "promisedAmount": 150_000, "promisedDate": nxt, "reason": "Waiting for a customer",
    })
    case = _case(t)
    assert case["status"] == "promise_to_pay" and case["openPromise"]["amount"] == 150_000

    # the promised date passes without payment → promise broken, back to follow-up
    CollectionActivity.objects.filter(loan_id=lid, kind="promise").update(promised_date=date.today() - timedelta(days=1))
    case = _case(t)
    assert case["status"] == "promise_broken" and case["stage"] == "follow_up" and case["brokenPromises"] == 1

    # escalation needs a reason
    assert t["officer"].post(f"/loans/{lid}/collection-activities", {"kind": "escalation"}).status_code == 400
    t["officer"].post(f"/loans/{lid}/collection-activities", {"kind": "escalation", "note": "Second broken promise"})
    assert _case(t)["status"] == "escalated"


def test_field_visit_payment_is_a_separate_linked_record(t):
    lid = t["loan"]["id"]
    r = t["officer"].post(f"/loans/{lid}/collection-activities", {
        "kind": "visit", "visitStatus": "completed", "location": "Shop at Kariakoo market",
        "purpose": "Recover arrears", "note": "Paid part in cash",
        "payment": {"amount": 100_000, "channel": "field"},
    })
    assert r.status_code == 201, r.content
    visit = r.json()
    assert visit["amountCollected"] == 100_000 and visit["outcome"] == "paid"
    [rp] = [x for x in t["cashier"].get("/repayments").json() if x["collectionActivityId"] == visit["id"]]
    assert rp["amount"] == 100_000 and rp["receiptNumber"].startswith("RCT-")
    assert rp["collectionPoint"] == "Shop at Kariakoo market"
    events = t["officer"].get(f"/loans/{lid}/collection-timeline").json()
    kinds = [e["kind"] for e in events]
    assert "visit" in kinds and "payment" in kinds and "case" in kinds


def test_only_managers_assign_and_change_status(t):
    case = _case(t)
    assert t["officer"].patch(f"/collections/cases/{case['id']}", {"status": "under_review"}).status_code == 403
    assert t["officer"].post("/collections/cases/assign", {"caseIds": [case["id"]], "staffId": t["manager"].staff["id"]}).status_code == 403
    ok = t["manager"].post("/collections/cases/assign", {"caseIds": [case["id"]], "staffId": t["manager"].staff["id"]})
    assert ok.status_code == 200 and ok.json()["assigned"] == 1
    case = _case(t)
    assert case["assignedToId"] == t["manager"].staff["id"] and case["assignedBy"] == t["manager"].staff["name"]
    # officers may still update the next action / follow-up
    assert t["officer"].patch(f"/collections/cases/{case['id']}", {"nextAction": "Visit on Monday"}).status_code == 200
    # stages are the lender's configured list
    assert t["manager"].patch(f"/collections/cases/{case['id']}", {"stage": "nonsense"}).status_code == 422
    t["admin"].patch("/lender", {"collectionStages": ["overdue", "call", "visit", "legal", "resolution"]})
    assert t["manager"].patch(f"/collections/cases/{case['id']}", {"stage": "legal"}).json()["stage"] == "legal"


def test_clearing_arrears_resolves_the_case(t):
    lid = t["loan"]["id"]
    case = _case(t)
    loan = t["cashier"].get(f"/loans/{lid}").json()
    t["cashier"].post("/repayments", {"loanId": lid, "amount": loan["outstandingBalance"], "channel": "cash"})
    call_command("age_loans", "--as-of", AS_OF)
    closed = next(c for c in t["officer"].get("/collections/cases").json() if c["id"] == case["id"])
    assert closed["status"] == "paid" and closed["closedAt"]


def test_dashboard_figures(t):
    t["officer"].post(f"/loans/{t['loan']['id']}/collection-activities", {
        "kind": "visit", "visitStatus": "scheduled", "visitDate": date.today().isoformat(), "location": "Shop",
    })
    d = t["manager"].get("/collections/dashboard").json()
    assert d["overdueLoans"] == 1 and d["overdueAmount"] > 0
    assert d["fieldVisitsToday"] == 1 and d["openCases"] == 1
    assert [a["bucket"] for a in d["aging"]] == ["1–7 days", "8–30 days", "31–60 days", "61–90 days", "90+ days"]
    assert sum(a["loans"] for a in d["aging"]) == 1
    assert any(o["officer"] == t["officer"].staff["name"] and o["visits"] == 1 for o in d["officerActivity"])
    assert _case(t)["status"] == "field_visit_required"
