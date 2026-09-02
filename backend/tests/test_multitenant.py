"""Every workspace is an island: one lender's staff can neither see nor touch
another lender's branches, staff, borrowers, products, applications, loans,
repayments or audit trail."""

import pytest

from tests.conftest import Actor, borrower_payload, make_staff, product_payload


def build_tenant(client, tag: str) -> dict:
    reg = client.post(
        "/auth/register",
        {
            "lenderName": f"Lender {tag}",
            "adminName": f"Admin {tag}",
            "adminEmail": f"admin.{tag}@example.co",
            "adminPassword": "password123",
        },
        format="json",
    )
    token = reg.json()["accessToken"]
    me = client.get("/auth/me", HTTP_AUTHORIZATION=f"Bearer {token}").json()
    admin = Actor(client, token, me)

    branch = admin.post(
        "/branches", {"name": f"Br{tag}", "code": tag[:4], "location": "X", "openedOn": "2022-01-01"}
    ).json()
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"], email=f"mgr.{tag}@example.co")
    product = admin.post("/products", product_payload(code=tag[:4])).json()
    borrower = admin.post("/borrowers", borrower_payload(branch["id"], nationalId=f"ID-{tag}")).json()
    app = admin.post(
        "/applications",
        {
            "borrowerId": borrower["id"], "productId": product["id"], "branchId": branch["id"],
            "amount": 1_000_000, "termInstalments": 6, "purpose": "x",
            "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
        },
    ).json()
    manager.post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    loan = admin.post(f"/applications/{app['id']}/disburse", {"channel": "cash", "reference": f"R{tag}"}).json()
    repayment = admin.post(
        "/repayments", {"loanId": loan["id"], "amount": loan["schedule"][0]["totalDue"], "channel": "cash"}
    ).json()
    holiday = admin.post("/holidays", {"date": "2026-12-25", "name": "Xmas"}).json()

    return {
        "admin": admin, "branch": branch, "manager": manager, "product": product,
        "borrower": borrower, "app": app, "loan": loan, "repayment": repayment, "holiday": holiday,
    }


@pytest.fixture
def two_tenants(client):
    return build_tenant(client, "alpha"), build_tenant(client, "beta")


def test_cross_tenant_reads_are_404(two_tenants):
    a, b = two_tenants
    admin_b = b["admin"]
    assert admin_b.get(f"/borrowers/{a['borrower']['id']}").status_code == 404
    assert admin_b.get(f"/products/{a['product']['id']}").status_code == 404
    assert admin_b.get(f"/applications/{a['app']['id']}").status_code == 404
    assert admin_b.get(f"/loans/{a['loan']['id']}").status_code == 404


def test_list_endpoints_exclude_other_tenant(two_tenants):
    a, b = two_tenants
    admin_b = b["admin"]

    def ids(path: str) -> set:
        return {row["id"] for row in admin_b.get(path).json()}

    assert a["borrower"]["id"] not in ids("/borrowers")
    assert a["product"]["id"] not in ids("/products")
    assert a["app"]["id"] not in ids("/applications")
    assert a["loan"]["id"] not in ids("/loans")
    assert a["repayment"]["id"] not in ids("/repayments")
    assert a["branch"]["id"] not in ids("/branches")
    assert a["holiday"]["id"] not in ids("/holidays")

    b_staff_ids = {row["id"] for row in admin_b.get("/staff").json()}
    assert a["manager"].staff["id"] not in b_staff_ids
    assert len(b_staff_ids) == 2

    b_audit = admin_b.get("/audit").json()
    a_entities = {a["borrower"]["id"], a["app"]["id"], a["loan"]["id"], a["repayment"]["id"]}
    assert all(e["entityId"] not in a_entities for e in b_audit)


def test_cross_tenant_writes_are_rejected(two_tenants):
    a, b = two_tenants
    admin_b = b["admin"]
    bad = {400, 403, 404, 409, 422}

    assert admin_b.post(
        f"/borrowers/{a['borrower']['id']}/blacklist", {"blacklisted": True, "reason": "z"}
    ).status_code in bad
    assert admin_b.patch(f"/products/{a['product']['id']}", {"active": False}).status_code in bad
    assert admin_b.post(
        f"/applications/{a['app']['id']}/decision", {"decision": "declined", "comment": "z"}
    ).status_code in bad
    assert admin_b.post(
        f"/applications/{a['app']['id']}/disburse", {"channel": "cash", "reference": "z"}
    ).status_code in bad
    assert admin_b.post("/repayments", {"loanId": a["loan"]["id"], "amount": 100, "channel": "cash"}).status_code in bad
    assert admin_b.post(f"/repayments/{a['repayment']['id']}/reverse", {"reason": "z"}).status_code in bad
    assert admin_b.patch(f"/staff/{a['manager'].staff['id']}", {"active": False}).status_code in bad
    assert admin_b.delete(f"/holidays/{a['holiday']['id']}").status_code in bad

    a_borrower = a["admin"].get(f"/borrowers/{a['borrower']['id']}").json()
    assert a_borrower["blacklisted"] is False
    a_app = a["admin"].get(f"/applications/{a['app']['id']}").json()
    assert a_app["status"] == "disbursed"


def test_cannot_attach_foreign_branch_or_officer(two_tenants):
    a, b = two_tenants
    admin_b = b["admin"]

    resp = admin_b.post("/borrowers", borrower_payload(a["branch"]["id"], nationalId="X-1"))
    assert resp.status_code == 422

    resp = admin_b.post(
        "/staff",
        {"name": "Mole", "email": "mole@example.co", "password": "password123",
         "role": "loan_officer", "branchId": a["branch"]["id"]},
    )
    assert resp.status_code == 422


def test_login_is_global_but_scopes_to_own_lender(two_tenants):
    a, _ = two_tenants
    borrowers = a["manager"].get("/borrowers").json()
    assert {row["id"] for row in borrowers} == {a["borrower"]["id"]}
