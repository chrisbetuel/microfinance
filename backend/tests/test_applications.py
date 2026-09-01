import pytest
from httpx import AsyncClient

from tests.conftest import Actor, borrower_payload, make_staff, product_payload


@pytest.fixture
async def setup(admin: Actor, branch: dict, client: AsyncClient):
    product = (await admin.post("/products", json=product_payload())).json()
    officer = await make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = await make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    borrower = (await officer.post("/borrowers", json=borrower_payload(branch["id"]))).json()
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


async def test_create_scores_and_routes(setup: dict):
    resp = await setup["officer"].post("/applications", json=_application_body(setup))
    assert resp.status_code == 201, resp.text
    app = resp.json()
    assert app["reference"].startswith("APP-")
    assert app["status"] == "pending_approval"
    assert app["requiredApproverRole"] == "branch_manager"
    assert app["affordabilityPass"] is True
    assert app["score"] > 0


async def test_amount_outside_product_range_rejected(setup: dict):
    resp = await setup["officer"].post("/applications", json=_application_body(setup, amount=99))
    assert resp.status_code == 422


async def test_blacklisted_borrower_cannot_apply(admin: Actor, setup: dict):
    await admin.post(
        f"/borrowers/{setup['borrower']['id']}/blacklist",
        json={"blacklisted": True, "reason": "prior default"},
    )
    resp = await setup["officer"].post("/applications", json=_application_body(setup))
    assert resp.status_code == 422


async def test_creator_cannot_approve_own_application(setup: dict):
    app = (await setup["officer"].post("/applications", json=_application_body(setup))).json()
    resp = await setup["officer"].post(
        f"/applications/{app['id']}/decision", json={"decision": "approved", "comment": "looks fine"}
    )
    assert resp.status_code == 403


async def test_wrong_role_cannot_approve(admin: Actor, setup: dict, client: AsyncClient):
    app = (await setup["officer"].post("/applications", json=_application_body(setup))).json()
    cashier = await make_staff(admin, client, role="cashier", branch_id=setup["branch"]["id"])
    resp = await cashier.post(
        f"/applications/{app['id']}/decision", json={"decision": "approved", "comment": "ok"}
    )
    assert resp.status_code == 403


async def test_matching_role_approves(setup: dict):
    app = (await setup["officer"].post("/applications", json=_application_body(setup))).json()
    resp = await setup["manager"].post(
        f"/applications/{app['id']}/decision", json={"decision": "approved", "comment": "clean history"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "approved"
    assert body["approvals"][0]["approverName"] == setup["manager"].staff["name"]


async def test_decline_records_reason(setup: dict):
    app = (await setup["officer"].post("/applications", json=_application_body(setup))).json()
    resp = await setup["manager"].post(
        f"/applications/{app['id']}/decision", json={"decision": "declined", "comment": "insufficient security"}
    )
    assert resp.json()["status"] == "declined"
    assert resp.json()["declineReason"] == "insufficient security"


async def test_cannot_decide_twice(setup: dict):
    app = (await setup["officer"].post("/applications", json=_application_body(setup))).json()
    await setup["manager"].post(
        f"/applications/{app['id']}/decision", json={"decision": "approved", "comment": "ok"}
    )
    again = await setup["manager"].post(
        f"/applications/{app['id']}/decision", json={"decision": "declined", "comment": "changed mind"}
    )
    assert again.status_code == 409
