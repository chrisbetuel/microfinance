"""Verification, data validation, risk flags, collateral and audit diffs."""

from datetime import date, timedelta

import pytest
from django.core.management import call_command

from tests.conftest import Actor, borrower_payload, make_staff, product_payload, forward_for_approval


@pytest.fixture
def team(admin: Actor, branch: dict, client):
    return {
        "admin": admin,
        "branch": branch,
        "officer": make_staff(admin, client, role="loan_officer", branch_id=branch["id"]),
        "manager": make_staff(admin, client, role="branch_manager", branch_id=branch["id"]),
        "cashier": make_staff(admin, client, role="cashier", branch_id=branch["id"]),
        "product": admin.post("/products", product_payload()).json(),
    }


def _apply(t, borrower, amount=600_000, term=4):
    return t["officer"].post("/applications", {
        "borrowerId": borrower["id"], "productId": t["product"]["id"], "branchId": t["branch"]["id"],
        "amount": amount, "termInstalments": term, "purpose": "x",
        "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
    })


def _loan(t, borrower, amount=600_000):
    app = _apply(t, borrower, amount).json()
    forward_for_approval(app['id'])
    t["manager"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    return t["cashier"].post(f"/applications/{app['id']}/disburse", {"channel": "cash", "reference": "R"}).json()


def test_duplicate_nida_and_phone_are_rejected(team):
    o, br = team["officer"], team["branch"]["id"]
    first = o.post("/borrowers", borrower_payload(br, nationalId="NID-1", phone="+255 700 111 222")).json()
    dup_nid = o.post("/borrowers", borrower_payload(br, nationalId="nid-1", phone="+255700999999"))
    assert dup_nid.status_code == 409 and "NIDA" in dup_nid.json()["detail"]
    dup_phone = o.post("/borrowers", borrower_payload(br, nationalId="NID-2", phone="255700111222"))
    assert dup_phone.status_code == 409 and "Phone" in dup_phone.json()["detail"]
    # editing your own record with your own number is fine
    assert o.patch(f"/borrowers/{first['id']}", {"phone": "+255 700 111 222"}).status_code == 200


def test_verification_records_who_and_when(team):
    b = team["officer"].post("/borrowers", borrower_payload(team["branch"]["id"])).json()
    assert b["verified"] is False
    r = team["officer"].post(f"/borrowers/{b['id']}/verify", {"verified": True, "phoneVerified": True}).json()
    assert r["verified"] and r["phoneVerified"]
    assert r["verifiedBy"] == team["officer"].staff["name"] and r["verifiedAt"]


def test_application_carries_risk_indicators_and_flags(team):
    b = team["officer"].post("/borrowers", borrower_payload(team["branch"]["id"])).json()
    app = _apply(team, b).json()
    risk = app["risk"]
    assert risk["newInstalment"] > 0 and risk["debtToIncome"] > 0
    assert risk["previousLoans"] == 0
    assert "Borrower profile not yet verified" in risk["flags"]
    assert app["needsReview"] is True  # flags → additional review, not an auto-decision


def test_overpayment_is_rejected(team):
    b = team["officer"].post("/borrowers", borrower_payload(team["branch"]["id"])).json()
    loan = _loan(team, b)
    r = team["cashier"].post("/repayments", {"loanId": loan["id"], "amount": loan["outstandingBalance"] + 1000, "channel": "cash"})
    assert r.status_code == 422 and "exceeds" in r.json()["detail"]


def test_creator_cannot_disburse_own_application(team, client):
    # an admin creates and someone else approves — the admin still can't release it
    b = team["officer"].post("/borrowers", borrower_payload(team["branch"]["id"])).json()
    app = team["admin"].post("/applications", {
        "borrowerId": b["id"], "productId": team["product"]["id"], "branchId": team["branch"]["id"],
        "amount": 600_000, "termInstalments": 4, "purpose": "x",
        "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
    }).json()
    forward_for_approval(app['id'])
    team["manager"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    r = team["admin"].post(f"/applications/{app['id']}/disburse", {"channel": "cash", "reference": "X"})
    assert r.status_code == 403


def test_unresolved_default_blocks_new_application(team):
    b = team["officer"].post("/borrowers", borrower_payload(team["branch"]["id"])).json()
    loan = _loan(team, b)
    team["manager"].post(f"/loans/{loan['id']}/write-off", {"reason": "absconded"})
    team["officer"].post(f"/borrowers/{b['id']}/status", {"status": "active"})  # even if reinstated
    r = _apply(team, b)
    assert r.status_code == 422 and "default" in r.json()["detail"]


def test_collateral_secures_next_loan_and_is_released_on_completion(team):
    b = team["officer"].post("/borrowers", borrower_payload(team["branch"]["id"])).json()
    c = team["officer"].post(f"/borrowers/{b['id']}/collateral", {
        "assetType": "Vehicle", "description": "Toyota Hiace", "estimatedValue": 35_000_000,
    })
    assert c.status_code == 201 and c.json()["status"] == "pledged"

    loan = _loan(team, b)
    item = next(x for x in team["officer"].get("/collateral").json() if x["id"] == c.json()["id"])
    assert item["status"] == "active" and item["loanId"] == loan["id"]

    team["cashier"].post(f"/loans/{loan['id']}/settle", {"channel": "cash"})
    item = next(x for x in team["officer"].get("/collateral").json() if x["id"] == c.json()["id"])
    assert item["status"] == "released"

    notes = [n["kind"] for n in team["admin"].get("/notifications").json()]
    assert "loan_completed" in notes


def test_late_instalments_are_remembered(team):
    b = team["officer"].post("/borrowers", borrower_payload(team["branch"]["id"])).json()
    loan = _loan(team, b)
    call_command("age_loans", "--as-of", (date.today() + timedelta(days=70)).isoformat())
    aged = next(x for x in team["cashier"].get("/loans").json() if x["id"] == loan["id"])
    assert sum(i["wasLate"] for i in aged["schedule"]) >= 2


def test_upcoming_payment_reminder(team):
    b = team["officer"].post("/borrowers", borrower_payload(team["branch"]["id"])).json()
    _loan(team, b)
    call_command("send_reminders", "--upcoming-days", "40")
    assert any(n["kind"] == "upcoming_payment" for n in team["admin"].get("/notifications").json())


def test_audit_records_before_and_after(team):
    b = team["officer"].post("/borrowers", borrower_payload(team["branch"]["id"])).json()
    team["officer"].patch(f"/borrowers/{b['id']}", {"monthlyIncome": 1_200_000})
    entry = next(e for e in team["admin"].get("/audit").json() if e["entity"] == "borrower" and e["action"] == "updated")
    change = entry["changes"]["monthlyIncome"]  # keys are camelCased on the wire
    assert float(change["before"]) == 900000 and float(change["after"]) == 1200000
