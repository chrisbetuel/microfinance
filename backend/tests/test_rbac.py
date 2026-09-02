from tests.conftest import Actor, borrower_payload, make_staff, product_payload


def test_auditor_cannot_write(admin: Actor, branch: dict, client):
    auditor = make_staff(admin, client, role="auditor")
    assert auditor.get("/borrowers").status_code == 200
    assert auditor.post("/borrowers", borrower_payload(branch["id"])).status_code == 403


def test_loan_officer_cannot_manage_products(admin: Actor, branch: dict, client):
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    assert officer.post("/products", product_payload()).status_code == 403


def test_loan_officer_has_no_audit_section(admin: Actor, branch: dict, client):
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    assert officer.get("/audit").status_code == 403


def test_cashier_cannot_create_application(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"])
    borrower = admin.post("/borrowers", borrower_payload(branch["id"])).json()

    assert cashier.get("/applications").status_code == 200
    resp = cashier.post(
        "/applications",
        {
            "borrowerId": borrower["id"], "productId": product["id"], "branchId": branch["id"],
            "amount": 500000, "termInstalments": 4, "purpose": "x",
            "declaredIncome": 900000, "declaredExpenses": 200000, "creditBureauConsent": True,
        },
    )
    assert resp.status_code == 403


def test_tenants_are_isolated(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()

    other = client.post(
        "/auth/register",
        {"lenderName": "Other", "adminName": "O", "adminEmail": "o@o.co", "adminPassword": "password123"},
        format="json",
    )
    other_token = other.json()["accessToken"]
    resp = client.get(f"/products/{product['id']}", HTTP_AUTHORIZATION=f"Bearer {other_token}")
    assert resp.status_code == 404
