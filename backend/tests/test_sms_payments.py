from datetime import date, timedelta

import pytest
from django.core.management import call_command

from tests.conftest import Actor, borrower_payload, make_staff, product_payload, forward_for_approval, release_loan


@pytest.fixture
def t(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"])
    borrowers = [
        officer.post("/borrowers", borrower_payload(branch["id"], fullName=f"Mteja {i}", nationalId=f"N{i}", phone=f"+25571000000{i}")).json()
        for i in range(3)
    ]
    return {"admin": admin, "officer": officer, "manager": manager, "cashier": cashier,
            "product": product, "branch": branch, "borrowers": borrowers}


def _approved_app(t, borrower):
    app = t["officer"].post("/applications", {
        "borrowerId": borrower["id"], "productId": t["product"]["id"], "branchId": t["branch"]["id"],
        "amount": 600_000, "termInstalments": 4, "purpose": "x",
        "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
    }).json()
    forward_for_approval(app['id'])
    t["manager"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    return app


# ------------------------------------------------------------------ SMS

def test_single_sms_fills_placeholders_and_uses_credit(t):
    before = t["admin"].get("/lender").json()["smsBalance"]
    r = t["officer"].post("/sms/send", {"borrowerId": t["borrowers"][0]["id"], "message": "Habari {first_name}, ref {customer_number}"})
    assert r.status_code == 201, r.content
    n = r.json()
    assert n["status"] == "sent" and n["body"] == "Habari Mteja, ref CUS-00001" and n["kind"] == "manual"
    assert n["sentBy"] == t["officer"].staff["name"]
    assert t["admin"].get("/lender").json()["smsBalance"] == before - 1


def test_single_sms_to_any_number(t):
    r = t["officer"].post("/sms/send", {"to": "+255799000000", "message": "Meeting at 10"})
    assert r.status_code == 201 and r.json()["to"] == "+255799000000"


def test_bulk_preview_then_send(t):
    preview = t["officer"].post("/sms/bulk", {"audience": "all", "message": "Dear {name}", "dryRun": True}).json()
    assert preview["recipients"] == 3 and preview["sample"][0]["body"].startswith("Dear Mteja")

    r = t["officer"].post("/sms/bulk", {"audience": "all", "message": "Dear {name}"})
    assert r.status_code == 201
    body = r.json()
    assert body["sent"] == 3 and body["batch"].startswith("BULK-")
    batch = [n for n in t["admin"].get("/notifications").json() if n["batch"] == body["batch"]]
    assert len(batch) == 3


def test_bulk_overdue_audience_only_targets_arrears(t):
    app = _approved_app(t, t["borrowers"][0])
    release_loan(t["cashier"], app['id'], "cash", "R")
    call_command("age_loans", "--as-of", (date.today() + timedelta(days=45)).isoformat())
    preview = t["officer"].post("/sms/bulk", {"audience": "overdue", "message": "{amount_due}", "dryRun": True}).json()
    assert preview["recipients"] == 1 and preview["sample"][0]["name"] == "Mteja 0"


def test_bulk_refuses_when_credits_short(t):
    t["admin"].patch("/lender", {})  # no-op
    from lms.models import Lender

    Lender.objects.all().update(sms_balance=1)
    r = t["officer"].post("/sms/bulk", {"audience": "all", "message": "hi"})
    assert r.status_code == 422 and "credits" in r.json()["detail"]


def test_auditor_cannot_send_sms(t, client):
    auditor = make_staff(t["admin"], client, role="auditor", email="aud.sms@test.co")
    assert auditor.post("/sms/send", {"to": "+255", "message": "x"}).status_code == 403


# ------------------------------------------------------------------ payments

def test_collection_request_settles_into_a_repayment(t):
    app = _approved_app(t, t["borrowers"][1])
    loan = release_loan(t["cashier"], app['id'], "cash", "R")
    due = loan["schedule"][0]["totalDue"]

    tx = t["cashier"].post("/payments/collect", {"loanId": loan["id"], "phone": "+255710000001", "amount": due, "network": "mpesa"})
    assert tx.status_code == 201, tx.content
    tx = tx.json()
    assert tx["status"] == "pending" and tx["providerRef"].startswith("MOCK-C-") and tx["reference"].startswith("PAY-")
    assert not [r for r in t["cashier"].get("/repayments").json() if r["loanId"] == loan["id"]]

    # gateway calls back
    cb = t["admin"]._client.post(
        "/payments/callback", {"providerRef": tx["providerRef"], "status": "success", "receipt": "QK12AB34"},
        format="json", HTTP_X_WEBHOOK_TOKEN="dev-webhook-secret",
    )
    assert cb.status_code == 200 and cb.json()["status"] == "success"
    reps = [r for r in t["cashier"].get("/repayments").json() if r["loanId"] == loan["id"]]
    assert len(reps) == 1 and reps[0]["amount"] == due and reps[0]["channel"] == "mobile_money"

    # duplicate callbacks are ignored
    t["admin"]._client.post("/payments/callback", {"providerRef": tx["providerRef"], "status": "success"},
                            format="json", HTTP_X_WEBHOOK_TOKEN="dev-webhook-secret")
    assert len([r for r in t["cashier"].get("/repayments").json() if r["loanId"] == loan["id"]]) == 1


def test_callback_requires_webhook_token(t, client):
    r = client.post("/payments/callback", {"reference": "PAY-000001", "status": "success"}, format="json")
    assert r.status_code == 403


def test_collect_rejects_more_than_outstanding(t):
    app = _approved_app(t, t["borrowers"][1])
    loan = release_loan(t["cashier"], app['id'], "cash", "R")
    r = t["cashier"].post("/payments/collect", {"loanId": loan["id"], "phone": "+1", "amount": loan["outstandingBalance"] + 5})
    assert r.status_code == 422
