from datetime import date, timedelta

import pytest
from django.core.management import call_command

from tests.conftest import Actor, borrower_payload, make_staff, product_payload


@pytest.fixture
def loan_ctx(admin: Actor, branch: dict, client):
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
    return {"admin": admin, "manager": manager, "cashier": cashier, "borrower": borrower, "loan": loan}


def test_aging_marks_overdue_and_caps_penalty(loan_ctx):
    future = (date.today() + timedelta(days=400)).isoformat()
    call_command("age_loans", "--as-of", future)

    loan = next(x for x in loan_ctx["cashier"].get("/loans").json() if x["id"] == loan_ctx["loan"]["id"])
    assert loan["daysInArrears"] > 0
    assert loan["arrearsAmount"] > 0
    assert any(i["status"] == "overdue" for i in loan["schedule"])
    assert any(i["penaltyDue"] > 0 for i in loan["schedule"])
    assert all(i["penaltyDue"] <= 50000 for i in loan["schedule"])  # product cap


def test_aging_is_idempotent(loan_ctx):
    future = (date.today() + timedelta(days=200)).isoformat()
    call_command("age_loans", "--as-of", future)
    first = next(x for x in loan_ctx["cashier"].get("/loans").json() if x["id"] == loan_ctx["loan"]["id"])
    call_command("age_loans", "--as-of", future)
    second = next(x for x in loan_ctx["cashier"].get("/loans").json() if x["id"] == loan_ctx["loan"]["id"])
    assert first["outstandingBalance"] == second["outstandingBalance"]
    assert first["arrearsAmount"] == second["arrearsAmount"]


def test_settle_pays_off_and_closes(loan_ctx):
    r = loan_ctx["cashier"].post(f"/loans/{loan_ctx['loan']['id']}/settle", {"channel": "mobile_money"})
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["status"] == "closed"
    assert body["outstandingBalance"] == 0
    assert body["closureReason"] == "Early settlement"


def test_settle_then_reverse_reopens(loan_ctx):
    loan_ctx["cashier"].post(f"/loans/{loan_ctx['loan']['id']}/settle", {})
    repayments = loan_ctx["cashier"].get("/repayments").json()
    rid = repayments[0]["id"]
    rev = loan_ctx["manager"].post(f"/repayments/{rid}/reverse", {"reason": "settled in error"})
    assert rev.status_code == 200
    loan = next(x for x in loan_ctx["cashier"].get("/loans").json() if x["id"] == loan_ctx["loan"]["id"])
    assert loan["status"] == "active"
    assert loan["outstandingBalance"] > 0


def test_write_off_needs_supervisor_and_blacklists_borrower(loan_ctx):
    lid = loan_ctx["loan"]["id"]
    assert loan_ctx["cashier"].post(f"/loans/{lid}/write-off", {"reason": "gone"}).status_code == 403

    r = loan_ctx["manager"].post(f"/loans/{lid}/write-off", {"reason": "absconded"})
    assert r.status_code == 200
    assert r.json()["status"] == "written_off"

    borrower = loan_ctx["manager"].get(f"/borrowers/{loan_ctx['borrower']['id']}").json()
    assert borrower["blacklisted"] is True
    assert "written off" in borrower["blacklistReason"].lower()


def test_repayment_sends_a_receipt_notification(loan_ctx):
    loan = loan_ctx["loan"]
    loan_ctx["cashier"].post(
        "/repayments", {"loanId": loan["id"], "amount": loan["schedule"][0]["totalDue"], "channel": "mobile_money"}
    )
    notifications = loan_ctx["admin"].get("/notifications").json()
    receipts = [n for n in notifications if n["kind"] == "receipt"]
    assert receipts and receipts[0]["status"] == "sent"


def test_arrears_reminders_command(loan_ctx):
    call_command("age_loans", "--as-of", (date.today() + timedelta(days=120)).isoformat())
    call_command("send_reminders", "--min-days", "1")
    notifications = loan_ctx["admin"].get("/notifications").json()
    assert any(n["kind"] == "arrears_reminder" for n in notifications)
