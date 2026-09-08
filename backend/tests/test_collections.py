from datetime import date, timedelta

import pytest
from django.core.management import call_command

from tests.conftest import Actor, borrower_payload, make_staff, product_payload


@pytest.fixture
def arrears_ctx(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"])
    borrower = officer.post("/borrowers", borrower_payload(branch["id"])).json()
    app = officer.post(
        "/applications",
        {
            "borrowerId": borrower["id"], "productId": product["id"], "branchId": branch["id"],
            "amount": 1_200_000, "termInstalments": 6, "purpose": "x",
            "declaredIncome": 900_000, "declaredExpenses": 300_000, "creditBureauConsent": True,
        },
    ).json()
    manager.post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    loan = cashier.post(f"/applications/{app['id']}/disburse", {"channel": "cash", "reference": "R1"}).json()
    call_command("age_loans", "--as-of", (date.today() + timedelta(days=90)).isoformat())
    return {"admin": admin, "officer": officer, "manager": manager, "cashier": cashier, "borrower": borrower, "loan": loan}


def test_log_call_activity(arrears_ctx):
    loan_id = arrears_ctx["loan"]["id"]
    r = arrears_ctx["officer"].post(
        f"/loans/{loan_id}/collection-activities",
        {"kind": "call", "outcome": "no_answer", "note": "Rang twice, voicemail"},
    )
    assert r.status_code == 201, r.content
    assert r.json()["kind"] == "call"

    rows = arrears_ctx["officer"].get("/collection-activities").json()
    assert any(a["note"] == "Rang twice, voicemail" for a in rows)


def test_promise_to_pay_status_transitions(arrears_ctx):
    loan_id = arrears_ctx["loan"]["id"]
    # a promise due yesterday, unmet -> broken
    past = (date.today() - timedelta(days=1)).isoformat()
    a = arrears_ctx["officer"].post(
        f"/loans/{loan_id}/collection-activities",
        {"kind": "promise", "promisedAmount": 300_000, "promisedDate": past},
    ).json()
    assert a["promiseStatus"] == "broken"

    # a promise due next week -> pending
    future = (date.today() + timedelta(days=7)).isoformat()
    b = arrears_ctx["officer"].post(
        f"/loans/{loan_id}/collection-activities",
        {"kind": "promise", "promisedAmount": 100_000, "promisedDate": future},
    ).json()
    assert b["promiseStatus"] == "pending"

    # pay it, then it reads kept
    arrears_ctx["cashier"].post("/repayments", {"loanId": loan_id, "amount": 150_000, "channel": "cash"})
    rows = arrears_ctx["officer"].get("/collection-activities").json()
    kept = next(x for x in rows if x["id"] == b["id"])
    assert kept["promiseStatus"] == "kept"


def test_promise_requires_amount(arrears_ctx):
    loan_id = arrears_ctx["loan"]["id"]
    r = arrears_ctx["officer"].post(f"/loans/{loan_id}/collection-activities", {"kind": "promise"})
    assert r.status_code == 400


def test_send_reminder_messages_borrower_and_logs_activity(arrears_ctx):
    loan_id = arrears_ctx["loan"]["id"]
    r = arrears_ctx["officer"].post(f"/loans/{loan_id}/send-reminder", {})
    assert r.status_code == 201, r.content
    assert r.json()["kind"] == "arrears_reminder"

    notifications = arrears_ctx["admin"].get("/notifications").json()
    assert any(n["kind"] == "arrears_reminder" for n in notifications)
    activities = arrears_ctx["officer"].get("/collection-activities").json()
    assert any(a["kind"] == "message" for a in activities)


def test_reminder_rejected_when_not_in_arrears(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"], email="o9@test.co")
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"], email="m9@test.co")
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"], email="c9@test.co")
    borrower = officer.post("/borrowers", borrower_payload(branch["id"])).json()
    app = officer.post(
        "/applications",
        {
            "borrowerId": borrower["id"], "productId": product["id"], "branchId": branch["id"],
            "amount": 600_000, "termInstalments": 4, "purpose": "x",
            "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
        },
    ).json()
    manager.post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    loan = cashier.post(f"/applications/{app['id']}/disburse", {"channel": "cash", "reference": "R2"}).json()
    assert officer.post(f"/loans/{loan['id']}/send-reminder", {}).status_code == 409


def test_auditor_cannot_log_activity(arrears_ctx, client):
    auditor = make_staff(arrears_ctx["admin"], client, role="auditor", email="aud@test.co")
    r = auditor.post(
        f"/loans/{arrears_ctx['loan']['id']}/collection-activities",
        {"kind": "note", "note": "should be blocked"},
    )
    assert r.status_code == 403
