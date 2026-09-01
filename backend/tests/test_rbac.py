from httpx import AsyncClient

from tests.conftest import Actor, borrower_payload, make_staff, product_payload


async def test_auditor_cannot_write(admin: Actor, branch: dict, client: AsyncClient):
    auditor = await make_staff(admin, client, role="auditor")
    # Auditor may read...
    assert (await auditor.get("/borrowers")).status_code == 200
    # ...but never write.
    resp = await auditor.post("/borrowers", json=borrower_payload(branch["id"]))
    assert resp.status_code == 403


async def test_loan_officer_cannot_manage_products(admin: Actor, branch: dict, client: AsyncClient):
    officer = await make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    resp = await officer.post("/products", json=product_payload())
    assert resp.status_code == 403


async def test_loan_officer_has_no_audit_section(admin: Actor, branch: dict, client: AsyncClient):
    officer = await make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    resp = await officer.get("/audit")
    assert resp.status_code == 403


async def test_cashier_cannot_create_application(admin: Actor, branch: dict, client: AsyncClient):
    product = (await admin.post("/products", json=product_payload())).json()
    cashier = await make_staff(admin, client, role="cashier", branch_id=branch["id"])
    borrower = (await admin.post("/borrowers", json=borrower_payload(branch["id"]))).json()
    # Cashiers can read the queue but the applications section is not theirs to write in.
    assert (await cashier.get("/applications")).status_code == 200
    resp = await cashier.post(
        "/applications",
        json={
            "borrowerId": borrower["id"], "productId": product["id"], "branchId": branch["id"],
            "amount": 500000, "termInstalments": 4, "purpose": "x",
            "declaredIncome": 900000, "declaredExpenses": 200000, "creditBureauConsent": True,
        },
    )
    assert resp.status_code == 403


async def test_tenants_are_isolated(admin: Actor, branch: dict, client: AsyncClient):
    product = (await admin.post("/products", json=product_payload())).json()

    other = await client.post(
        "/auth/register",
        json={"lenderName": "Other", "adminName": "O", "adminEmail": "o@o.co", "adminPassword": "password123"},
    )
    other_token = other.json()["accessToken"]
    resp = await client.get(f"/products/{product['id']}", headers={"Authorization": f"Bearer {other_token}"})
    assert resp.status_code == 404
