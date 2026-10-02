"""Staged application workflow: draft → submitted → under assessment →
pending approval → approved/declined (or returned) → disbursed."""

from datetime import date, timedelta

import pytest

from lms.models import Guarantor
from tests.conftest import Actor, borrower_payload, make_staff, product_payload, release_loan


@pytest.fixture
def t(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    officer2 = make_staff(admin, client, role="loan_officer", branch_id=branch["id"], email="officer2@test.co")
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"])
    borrower = officer.post("/borrowers", borrower_payload(branch["id"])).json()
    return {"product": product, "officer": officer, "officer2": officer2, "manager": manager, "cashier": cashier,
            "borrower": borrower, "branch": branch}


def _body(t, **overrides):
    body = {
        "borrowerId": t["borrower"]["id"],
        "productId": t["product"]["id"],
        "amount": 1_200_000,
        "termInstalments": 6,
        "purpose": "Restock shop",
        "declaredIncome": 900_000,
        "declaredExpenses": 300_000,
        "otherIncome": 100_000,
        "businessIncome": 400_000,
        "businessExpenses": 150_000,
        "existingRepayments": 50_000,
        "dependents": 3,
        "disbursementMethod": "mobile_money",
        "creditBureauConsent": True,
    }
    body.update(overrides)
    return body


def _assess(actor, app_id, **overrides):
    body = {"result": "recommended", "assessedAmount": 1_000_000, "recommendedTerm": 6, "notes": "Good stock turnover",
            "forward": True}
    body.update(overrides)
    return actor.post(f"/applications/{app_id}/assessment", body)


def test_draft_submit_and_capacity(t):
    resp = t["officer"].post("/applications", _body(t, draft=True, documents=[{"type": "Identification", "name": "nida.pdf"}]))
    assert resp.status_code == 201, resp.content
    app = resp.json()
    assert app["status"] == "draft"
    assert app["requestedAmount"] == 1_200_000
    assert app["loanOfficerId"] == t["officer"].staff["id"]
    assert app["createdBy"] == t["officer"].staff["id"]
    # 900k + 100k + (400k - 150k) = 1.25M; minus 300k expenses and 50k repayments = 900k free
    assert app["capacity"]["totalIncome"] == 1_250_000
    assert app["capacity"]["disposable"] == 900_000
    assert app["capacity"]["maxInstalment"] == 540_000
    assert app["documents"][0]["status"] == "pending"

    # a draft can't be decided or assessed past its stage
    assert t["manager"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": ""}).status_code == 409

    edited = t["officer"].patch(f"/applications/{app['id']}", {"purpose": "Buy a fridge"}).json()
    assert edited["purpose"] == "Buy a fridge"

    submitted = t["officer"].post(f"/applications/{app['id']}/submit").json()
    assert submitted["status"] == "submitted"
    assert [e["stage"] for e in submitted["events"]] == ["draft", "submitted"]


def test_full_workflow_with_return_and_partial_approval(t):
    app = t["officer"].post("/applications", _body(t)).json()
    assert app["status"] == "submitted"
    # straight to approval is not allowed
    assert t["manager"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": ""}).status_code == 409

    started = t["officer"].post(f"/applications/{app['id']}/start-assessment").json()
    assert started["status"] == "under_assessment"

    # further review can't be forwarded; it stays with the officer
    assert _assess(t["officer"], app["id"], result="further_review").status_code == 422
    held = _assess(t["officer"], app["id"], result="further_review", forward=False).json()
    assert held["status"] == "under_assessment"
    assert held["assessmentResult"] == "further_review"

    # assessed amount can't exceed the request
    assert _assess(t["officer"], app["id"], assessedAmount=2_000_000).status_code == 422

    fwd = _assess(t["officer"], app["id"]).json()
    assert fwd["status"] == "pending_approval"
    assert fwd["assessedById"] == t["officer"].staff["id"]

    # the approver returns it for more information (reason required)
    assert t["manager"].post(f"/applications/{app['id']}/decision", {"decision": "returned", "comment": ""}).status_code == 422
    back = t["manager"].post(f"/applications/{app['id']}/decision",
                             {"decision": "returned", "comment": "Need bank statements"}).json()
    assert back["status"] == "under_assessment"

    # a second officer re-assesses, then the manager approves on the assessed terms
    _assess(t["officer2"], app["id"], assessedAmount=900_000, recommendedTerm=5)
    approved = t["manager"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"}).json()
    assert approved["status"] == "approved"
    assert approved["amount"] == 900_000
    assert approved["termInstalments"] == 5
    assert approved["requestedAmount"] == 1_200_000
    stages = [e["stage"] for e in approved["events"]]
    assert stages == ["submitted", "under_assessment", "under_assessment", "pending_approval", "under_assessment",
                      "pending_approval", "approved"]

    loan = release_loan(t["cashier"], app['id'], "mobile_money", "MM1")
    assert loan["principal"] == 900_000
    final = t["officer"].get(f"/applications/{app['id']}").json()
    assert final["events"][-1]["stage"] == "disbursed"


def test_assessor_cannot_approve(t, admin):
    app = admin.post("/applications", _body(t)).json()
    _assess(t["manager"], app["id"])
    resp = t["manager"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    assert resp.status_code == 403
    assert "assessed" in resp.json()["detail"]


def test_first_repayment_date_shapes_schedule(t):
    first = date.today() + timedelta(days=45)
    app = t["officer"].post("/applications", _body(t, firstRepaymentDate=first.isoformat())).json()
    _assess(t["officer"], app["id"])
    t["manager"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    loan = release_loan(t["cashier"], app['id'], "cash", "C1")
    assert loan["schedule"][0]["dueDate"] == first.isoformat()

    bad = t["officer"].post("/applications", _body(t, firstRepaymentDate=date.today().isoformat()))
    assert bad.status_code == 422


def test_guarantors_collateral_and_documents(t):
    b = t["borrower"]
    g = Guarantor.objects.create(borrower_id=b["id"], name="Juma Ali", national_id="G-1", phone="0712000000",
                                 guarantee_amount=500_000)
    c = t["officer"].post(f"/borrowers/{b['id']}/collateral", {
        "assetType": "Motorcycle", "description": "Boxer 2021", "estimatedValue": 2_000_000,
        "existingClaims": "None", "valuedBy": "Branch valuer", "documents": ["logbook.pdf"],
    }).json()
    assert c["existingClaims"] == "None"
    assert c["documents"] == ["logbook.pdf"]

    app = t["officer"].post("/applications", _body(t, guarantorIds=[str(g.id)], collateralIds=[c["id"]])).json()
    assert app["guarantorIds"] == [str(g.id)]
    assert app["collateralIds"] == [c["id"]]

    other = t["officer"].post("/borrowers", borrower_payload(t["branch"]["id"], nationalId="X-99", phone="0755000999")).json()
    foreign = Guarantor.objects.create(borrower_id=other["id"], name="Not Mine", national_id="G-2", phone="0712000001")
    assert t["officer"].patch(f"/applications/{app['id']}", {"guarantorIds": [str(foreign.id)]}).status_code == 422

    with_doc = t["officer"].post(f"/applications/{app['id']}/documents", {"type": "Income evidence", "name": "payslip.pdf"}).json()
    doc = with_doc["documents"][0]
    verified = t["manager"].patch(f"/applications/{app['id']}/documents/{doc['id']}", {"status": "verified"}).json()
    assert verified["documents"][0]["status"] == "verified"
    assert verified["documents"][0]["verifiedBy"] == t["manager"].staff["name"]

    # the application's collateral secures the loan at disbursement
    _assess(t["officer"], app["id"])
    t["manager"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    loan = release_loan(t["cashier"], app['id'], "cash", "C2")
    item = next(x for x in t["officer"].get("/collateral").json() if x["id"] == c["id"])
    assert item["status"] == "active"
    assert item["loanId"] == loan["id"]


def test_cannot_edit_after_forwarding(t):
    app = t["officer"].post("/applications", _body(t)).json()
    _assess(t["officer"], app["id"])
    assert t["officer"].patch(f"/applications/{app['id']}", {"purpose": "x"}).status_code == 409
