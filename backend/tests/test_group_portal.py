"""Group portal logins and the company's mobile-money repayment number."""

import pytest
from django.core.management import call_command

from lms.models import Notification
from tests.conftest import Actor, borrower_payload, forward_for_approval, make_staff, product_payload, release_loan


@pytest.fixture
def t(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload(securityRequired=["none"])).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"])
    members = [
        officer.post("/borrowers", borrower_payload(branch["id"], fullName=f"Member {i}", nationalId=f"G{i}",
                                                    phone=f"+25571400000{i}")).json()
        for i in range(2)
    ]
    group = officer.post("/groups", {
        "name": "Upendo", "branchId": branch["id"], "officerId": officer.staff["id"],
        "members": [{"borrowerId": m["id"], "role": "member"} for m in members],
    }).json()
    app = officer.post("/applications", {
        "borrowerId": members[0]["id"], "productId": product["id"], "branchId": branch["id"], "groupId": group["id"],
        "amount": 600_000, "termInstalments": 4, "purpose": "Stock",
        "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
    }).json()
    forward_for_approval(app["id"])
    manager.post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    loan = release_loan(cashier, app["id"])
    cashier.post("/repayments", {"loanId": loan["id"], "amount": 50_000, "channel": "cash"})
    return {"admin": admin, "officer": officer, "cashier": cashier, "group": group, "loan": loan, "client": client}


def test_staff_create_a_group_portal_login(t):
    gid = t["group"]["id"]
    assert t["officer"].get(f"/groups/{gid}/portal-account").json()["account"] is None
    assert t["officer"].post(f"/groups/{gid}/portal-account", {"password": "123"}).status_code == 400
    acct = t["officer"].post(f"/groups/{gid}/portal-account", {"password": "upendo2026"}).json()
    assert acct["username"] == t["group"]["groupNumber"].lower() and acct["active"]


def test_group_sees_its_loans_payments_and_how_to_pay(t):
    gid = t["group"]["id"]
    t["officer"].post(f"/groups/{gid}/portal-account", {"username": "upendo", "password": "upendo2026"})
    c = t["client"]
    assert c.post("/portal/login", {"username": "upendo", "password": "wrong"}, format="json").status_code == 401
    token = c.post("/portal/login", {"username": "UPENDO", "password": "upendo2026"}, format="json").json()["token"]

    me = c.get("/portal/me", HTTP_AUTHORIZATION=f"Portal {token}").json()
    assert me["group"]["name"] == "Upendo" and me["totals"]["members"] == 2
    assert me["totals"]["activeLoans"] == 1 and me["totals"]["repaid"] == 50_000
    borrower_row = next(m for m in me["members"] if m["name"] == "Member 0")
    assert borrower_row["loanNumbers"] == [t["loan"]["loanNumber"]] and borrower_row["outstanding"] > 0
    assert me["payments"][0]["amount"] == 50_000
    assert me["payTo"]["number"] == "0618750312"

    # the portal token is not a staff token, and vice versa
    assert c.get("/borrowers", HTTP_AUTHORIZATION=f"Bearer {token}").status_code == 401
    assert c.get("/portal/me", HTTP_AUTHORIZATION=f"Portal {t['officer'].token}").status_code == 401
    assert c.get("/portal/me").status_code == 401

    # switching the login off locks the group out
    t["officer"].patch(f"/groups/{gid}/portal-account", {"active": False})
    assert c.get("/portal/me", HTTP_AUTHORIZATION=f"Portal {token}").status_code == 401
    assert c.post("/portal/login", {"username": "upendo", "password": "upendo2026"}, format="json").status_code == 401


def test_admin_updates_the_mobile_money_number_used_in_sms(t):
    assert t["admin"].get("/lender").json()["mobileMoneyNumber"] == "0618750312"
    assert t["admin"].patch("/lender", {"mobileMoneyNumber": "not a phone"}).status_code == 400
    assert t["officer"].patch("/lender", {"mobileMoneyNumber": "0700000000"}).status_code == 403
    t["admin"].patch("/lender", {"mobileMoneyNumber": "0754111222", "mobileMoneyNetwork": "M-Pesa"})
    call_command("send_reminders", "--upcoming-days", "40")
    body = Notification.objects.filter(kind="upcoming_payment").latest("created_at").body
    assert "Pay by M-Pesa mobile money to 0754111222" in body and t["loan"]["loanNumber"] in body
