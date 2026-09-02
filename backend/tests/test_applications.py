import pytest

from tests.conftest import Actor, borrower_payload, make_staff, product_payload


@pytest.fixture
def setup(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    borrower = officer.post("/borrowers", borrower_payload(branch["id"])).json()
    return {"product": product, "officer": officer, "manager": manager, "borrower": borrower, "branch": branch}


def _application_body(setup: dict, **overrides) -> dict:
    body = {
        "borrowerId": setup["borrower"]["id"],
        "productId": setup["product"]["id"],
        "branchId": setup["branch"]["id"],
        "amount": 1_200_000,
        "termInstalments": 6,
        "purpose": "Restock shop",
        "declaredIncome": 900_000,
        "declaredExpenses": 300_000,
        "creditBureauConsent": True,
    }
    body.update(overrides)
    return body


def test_create_scores_and_routes(setup):
    resp = setup["officer"].post("/applications", _application_body(setup))
    assert resp.status_code == 201, resp.content
    app = resp.json()
    assert app["reference"].startswith("APP-")
    assert app["status"] == "pending_approval"
    assert app["requiredApproverRole"] == "branch_manager"
    assert app["affordabilityPass"] is True
    assert app["score"] > 0


def test_amount_outside_product_range_rejected(setup):
    assert setup["officer"].post("/applications", _application_body(setup, amount=99)).status_code == 422


def test_blacklisted_borrower_cannot_apply(admin: Actor, setup):
    admin.post(f"/borrowers/{setup['borrower']['id']}/blacklist", {"blacklisted": True, "reason": "prior default"})
    assert setup["officer"].post("/applications", _application_body(setup)).status_code == 422


def test_creator_cannot_approve_own_application(setup):
    app = setup["officer"].post("/applications", _application_body(setup)).json()
    resp = setup["officer"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "looks fine"})
    assert resp.status_code == 403


def test_wrong_role_cannot_approve(admin: Actor, setup, client):
    app = setup["officer"].post("/applications", _application_body(setup)).json()
    cashier = make_staff(admin, client, role="cashier", branch_id=setup["branch"]["id"])
    resp = cashier.post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    assert resp.status_code == 403


def test_matching_role_approves(setup):
    app = setup["officer"].post("/applications", _application_body(setup)).json()
    resp = setup["manager"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "clean history"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "approved"
    assert body["approvals"][0]["approverName"] == setup["manager"].staff["name"]


def test_decline_records_reason(setup):
    app = setup["officer"].post("/applications", _application_body(setup)).json()
    resp = setup["manager"].post(
        f"/applications/{app['id']}/decision", {"decision": "declined", "comment": "insufficient security"}
    )
    assert resp.json()["status"] == "declined"
    assert resp.json()["declineReason"] == "insufficient security"


def test_cannot_decide_twice(setup):
    app = setup["officer"].post("/applications", _application_body(setup)).json()
    setup["manager"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    again = setup["manager"].post(f"/applications/{app['id']}/decision", {"decision": "declined", "comment": "no"})
    assert again.status_code == 409
