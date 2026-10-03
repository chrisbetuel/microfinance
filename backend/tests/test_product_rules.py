"""Loan products hold the rules: eligibility, limits, security, approval
workflow, disbursement and repayment rules are enforced on the loans made
under them."""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from lms.services.loan_math import calculate_penalty
from tests.conftest import Actor, borrower_payload, forward_for_approval, make_staff, product_payload, release_loan


@pytest.fixture
def t(admin: Actor, branch: dict, client):
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    officer2 = make_staff(admin, client, role="loan_officer", branch_id=branch["id"], email="o2@test.co")
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"])
    adult = officer.post("/borrowers", borrower_payload(branch["id"], dateOfBirth="1990-05-01")).json()
    return {"admin": admin, "officer": officer, "officer2": officer2, "manager": manager, "cashier": cashier,
            "branch": branch, "borrower": adult}


def _product(t, **overrides):
    r = t["admin"].post("/products", product_payload(**overrides))
    assert r.status_code == 201, r.content
    return r.json()


def _apply(t, product, borrower=None, amount=600_000, term=4, **extra):
    return t["officer"].post("/applications", {
        "borrowerId": (borrower or t["borrower"])["id"], "productId": product["id"], "branchId": t["branch"]["id"],
        "amount": amount, "termInstalments": term, "purpose": "Stock",
        "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True, **extra,
    })


def test_product_information_round_trips(t):
    p = _product(t, description="Business capital", category="business", defaultAmount=500_000, defaultTerm=6,
                 status="archived", fees=[{"name": "App fee", "kind": "fixed", "value": 5000, "timing": "deducted",
                                           "feeType": "application"}])
    assert p["status"] == "archived" and p["active"] is False
    assert p["defaultAmount"] == 500_000 and p["category"] == "business"
    assert p["fees"][0]["feeType"] == "application"
    bad = t["admin"].post("/products", product_payload(defaultAmount=99))
    assert bad.status_code == 400  # default outside the range
    # an archived product takes no applications
    r = _apply(t, p)
    assert r.status_code == 422 and "not active" in r.json()["detail"]


def test_eligibility_rules_block_intake(t):
    p = _product(t, minAge=25, minMonthlyIncome=1_000_000)
    young = t["officer"].post("/borrowers", borrower_payload(t["branch"]["id"], nationalId="Y1", phone="+255700000009",
                                                              dateOfBirth=(date.today() - timedelta(days=365 * 20)).isoformat())).json()
    r = _apply(t, p, borrower=young)
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "Minimum age" in detail and "Required income" in detail
    checks = t["officer"].get(f"/products/{p['id']}/eligibility?borrowerId={young['id']}&amount=600000&term=4").json()
    assert {c["rule"] for c in checks if not c["ok"]} == {"Minimum age", "Required income"}
    # an older, better-paid borrower passes
    assert _apply(t, p, declaredIncome=1_200_000).status_code == 201


def test_borrowing_limits(t):
    p = _product(t, maxActiveLoans=1, maxOpenApplications=1)
    first = _apply(t, p).json()
    blocked = _apply(t, p)
    assert blocked.status_code == 422 and "Open applications" in blocked.json()["detail"]
    forward_for_approval(first["id"])
    t["manager"].post(f"/applications/{first['id']}/decision", {"decision": "approved", "comment": "ok"})
    release_loan(t["cashier"], first["id"])
    again = _apply(t, p)
    assert again.status_code == 422 and "Active loans" in again.json()["detail"]


def test_group_product_needs_group_membership(t):
    p = _product(t, loanType="group", minGroupMembers=2)
    r = _apply(t, p)
    assert r.status_code == 422 and "Group membership" in r.json()["detail"]


def test_security_requirements_block_recommendation(t):
    p = _product(t, minGuarantors=1, requiredDocuments=["Identification"])
    app = _apply(t, p).json()
    assert any(c["rule"] == "Guarantors" and not c["ok"] for c in app["eligibility"])
    r = t["officer"].post(f"/applications/{app['id']}/assessment", {
        "result": "recommended", "assessedAmount": 600_000, "recommendedTerm": 4, "forward": True,
    })
    assert r.status_code == 422
    assert "Guarantors" in r.json()["detail"] and "Document: Identification" in r.json()["detail"]
    # "not recommended" can still go to the approver
    ok = t["officer"].post(f"/applications/{app['id']}/assessment", {
        "result": "not_recommended", "assessedAmount": 600_000, "recommendedTerm": 4, "forward": True,
    })
    assert ok.status_code == 200


def test_multi_role_approval_workflow(t):
    p = _product(t, approvalLevels=[{"minAmount": 0, "maxAmount": None, "requiredRoles": ["loan_officer", "branch_manager"]}])
    assert p["approvalLevels"][0]["requiredRoles"] == ["loan_officer", "branch_manager"]
    app = _apply(t, p).json()
    assert app["requiredApprovals"] == ["loan_officer", "branch_manager"]
    forward_for_approval(app["id"])
    first = t["officer2"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "fine"})
    assert first.status_code == 200 and first.json()["status"] == "pending_approval"
    assert t["officer2"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "again"}).status_code == 403
    done = t["manager"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"}).json()
    assert done["status"] == "approved"
    assert [e["label"] for e in done["events"] if "Approved" in e["label"]][0].endswith("(1 of 2)")


def test_disbursement_and_repayment_rules(t):
    p = _product(t, disbursementMethods=["bank_transfer"], earlyRepaymentAllowed=False,
                 firstRepaymentRule="day_of_month", firstRepaymentDay=5)
    app = _apply(t, p).json()
    first = date.fromisoformat(app["firstRepaymentDate"])
    assert first.day == 5 and first >= date.today() + timedelta(days=14)
    forward_for_approval(app["id"])
    t["manager"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    r = t["cashier"].post("/disbursements", {"applicationId": app["id"], "method": "cash"})
    assert r.status_code == 422 and "not an allowed disbursement method" in r.json()["detail"]
    loan = release_loan(t["cashier"], app["id"], "bank_transfer", "BNK1")
    assert loan["schedule"][0]["dueDate"] == first.isoformat()
    settle = t["cashier"].post(f"/loans/{loan['id']}/settle", {"channel": "cash"})
    assert settle.status_code == 409 and "early repayment" in settle.json()["detail"]


def test_penalty_switch_and_grace():
    p = SimpleNamespace(penalty_enabled=True, penalty_grace_days=3, penalty_kind="fixed", penalty_value=1000, penalty_cap=50_000)
    assert calculate_penalty(p, 100_000, 3) == 0
    assert calculate_penalty(p, 100_000, 5) == 2_000
    p.penalty_enabled = False
    assert calculate_penalty(p, 100_000, 30) == 0
