"""Every workspace is an island: one lender's staff can neither see nor touch
another lender's branches, staff, borrowers, products, applications, loans,
repayments or audit trail."""

import pytest
from httpx import AsyncClient

from tests.conftest import Actor, borrower_payload, make_staff, product_payload


async def build_tenant(client: AsyncClient, tag: str) -> dict:
    reg = await client.post(
        "/auth/register",
        json={
            "lenderName": f"Lender {tag}",
            "adminName": f"Admin {tag}",
            "adminEmail": f"admin.{tag}@example.co",
            "adminPassword": "password123",
        },
    )
    token = reg.json()["accessToken"]
    me = (await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})).json()
    admin = Actor(client, token, me)

    branch = (await admin.post(
        "/branches", json={"name": f"Br{tag}", "code": tag[:4], "location": "X", "openedOn": "2022-01-01"}
    )).json()
    manager = await make_staff(admin, client, role="branch_manager", branch_id=branch["id"], email=f"mgr.{tag}@example.co")
    product = (await admin.post("/products", json=product_payload(code=tag[:4]))).json()
    borrower = (await admin.post("/borrowers", json=borrower_payload(branch["id"], nationalId=f"ID-{tag}"))).json()
    app = (await admin.post(
        "/applications",
        json={
            "borrowerId": borrower["id"], "productId": product["id"], "branchId": branch["id"],
            "amount": 1_000_000, "termInstalments": 6, "purpose": "x",
            "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
        },
    )).json()
    await manager.post(f"/applications/{app['id']}/decision", json={"decision": "approved", "comment": "ok"})
    loan = (await admin.post(
        f"/applications/{app['id']}/disburse", json={"channel": "cash", "reference": f"R{tag}"}
    )).json()
    repayment = (await admin.post(
        "/repayments", json={"loanId": loan["id"], "amount": loan["schedule"][0]["totalDue"], "channel": "cash"}
    )).json()
    holiday = (await admin.post("/holidays", json={"date": "2026-12-25", "name": "Xmas"})).json()

    return {
        "admin": admin, "branch": branch, "manager": manager, "product": product,
        "borrower": borrower, "app": app, "loan": loan, "repayment": repayment, "holiday": holiday,
    }


@pytest.fixture
async def two_tenants(client: AsyncClient):
    a = await build_tenant(client, "alpha")
    b = await build_tenant(client, "beta")
    return a, b


async def test_cross_tenant_reads_are_404(two_tenants):
    a, b = two_tenants
    admin_b = b["admin"]
    assert (await admin_b.get(f"/borrowers/{a['borrower']['id']}")).status_code == 404
    assert (await admin_b.get(f"/products/{a['product']['id']}")).status_code == 404
    assert (await admin_b.get(f"/applications/{a['app']['id']}")).status_code == 404
    assert (await admin_b.get(f"/loans/{a['loan']['id']}")).status_code == 404


async def test_list_endpoints_exclude_other_tenant(two_tenants):
    a, b = two_tenants
    admin_b = b["admin"]

    async def ids(path: str) -> set[str]:
        return {row["id"] for row in (await admin_b.get(path)).json()}

    assert a["borrower"]["id"] not in await ids("/borrowers")
    assert a["product"]["id"] not in await ids("/products")
    assert a["app"]["id"] not in await ids("/applications")
    assert a["loan"]["id"] not in await ids("/loans")
    assert a["repayment"]["id"] not in await ids("/repayments")
    assert a["branch"]["id"] not in await ids("/branches")
    assert a["holiday"]["id"] not in await ids("/holidays")

    b_staff_ids = {row["id"] for row in (await admin_b.get("/staff")).json()}
    assert a["manager"].staff["id"] not in b_staff_ids
    assert len(b_staff_ids) == 2  # beta's admin + beta's manager only

    b_audit = (await admin_b.get("/audit")).json()
    a_entities = {a["borrower"]["id"], a["app"]["id"], a["loan"]["id"], a["repayment"]["id"]}
    assert all(e["entityId"] not in a_entities for e in b_audit)


async def test_cross_tenant_writes_are_rejected(two_tenants):
    a, b = two_tenants
    admin_b = b["admin"]
    bad = {403, 404, 409, 422}

    assert (await admin_b.post(
        f"/borrowers/{a['borrower']['id']}/blacklist", json={"blacklisted": True, "reason": "z"}
    )).status_code in bad
    assert (await admin_b.patch(f"/products/{a['product']['id']}", json={"active": False})).status_code in bad
    assert (await admin_b.post(
        f"/applications/{a['app']['id']}/decision", json={"decision": "declined", "comment": "z"}
    )).status_code in bad
    assert (await admin_b.post(
        f"/applications/{a['app']['id']}/disburse", json={"channel": "cash", "reference": "z"}
    )).status_code in bad
    assert (await admin_b.post(
        "/repayments", json={"loanId": a["loan"]["id"], "amount": 100, "channel": "cash"}
    )).status_code in bad
    assert (await admin_b.post(
        f"/repayments/{a['repayment']['id']}/reverse", json={"reason": "z"}
    )).status_code in bad
    assert (await admin_b.patch(f"/staff/{a['manager'].staff['id']}", json={"active": False})).status_code in bad
    assert (await admin_b.delete(f"/holidays/{a['holiday']['id']}")).status_code in bad

    # A's data survived every attempt untouched.
    a_borrower = (await a["admin"].get(f"/borrowers/{a['borrower']['id']}")).json()
    assert a_borrower["blacklisted"] is False
    a_app = (await a["admin"].get(f"/applications/{a['app']['id']}")).json()
    assert a_app["status"] == "disbursed"


async def test_cannot_attach_foreign_branch_or_officer(two_tenants):
    a, b = two_tenants
    admin_b = b["admin"]

    # A borrower registered against tenant A's branch.
    resp = await admin_b.post("/borrowers", json=borrower_payload(a["branch"]["id"], nationalId="X-1"))
    assert resp.status_code == 422

    # A staff member assigned to tenant A's branch.
    resp = await admin_b.post(
        "/staff",
        json={"name": "Mole", "email": "mole@example.co", "password": "password123",
              "role": "loan_officer", "branchId": a["branch"]["id"]},
    )
    assert resp.status_code == 422


async def test_login_is_global_but_scopes_to_own_lender(two_tenants):
    a, b = two_tenants
    # A's manager logging in only ever sees A's data.
    mgr = a["manager"]
    borrowers = (await mgr.get("/borrowers")).json()
    assert {row["id"] for row in borrowers} == {a["borrower"]["id"]}
