import pytest

from tests.conftest import Actor, borrower_payload, make_staff, product_payload


@pytest.fixture
def ctx(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload(compulsorySavingsPercent=10)).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"])
    borrower = officer.post("/borrowers", borrower_payload(branch["id"])).json()
    return {"admin": admin, "officer": officer, "manager": manager, "cashier": cashier, "borrower": borrower, "product": product}


def test_disbursement_deducts_compulsory_savings(ctx):
    app = ctx["officer"].post(
        "/applications",
        {
            "borrowerId": ctx["borrower"]["id"], "productId": ctx["product"]["id"], "branchId": None,
            "amount": 1_000_000, "termInstalments": 5, "purpose": "x",
            "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
        },
    ).json()
    ctx["manager"].post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    loan = ctx["cashier"].post(f"/applications/{app['id']}/disburse", {"channel": "cash", "reference": "R1"}).json()

    assert loan["savingsDeducted"] == 100_000  # 10% of 1,000,000
    # net = principal - fees(2%) - savings(10%)
    assert loan["netDisbursed"] == 1_000_000 - 20_000 - 100_000

    savings = ctx["officer"].get(f"/borrowers/{ctx['borrower']['id']}/savings").json()
    assert savings["balance"] == 100_000
    assert savings["transactions"][0]["kind"] == "loan_deduction"


def test_manual_deposit_and_withdrawal(ctx):
    bid = ctx["borrower"]["id"]
    ctx["officer"].post(f"/borrowers/{bid}/savings", {"kind": "deposit", "amount": 50_000, "note": "weekly"})
    after_dep = ctx["officer"].get(f"/borrowers/{bid}/savings").json()
    assert after_dep["balance"] == 50_000

    r = ctx["officer"].post(f"/borrowers/{bid}/savings", {"kind": "withdrawal", "amount": 20_000})
    assert r.status_code == 201
    assert r.json()["balance"] == 30_000


def test_cannot_overdraw(ctx):
    bid = ctx["borrower"]["id"]
    ctx["officer"].post(f"/borrowers/{bid}/savings", {"kind": "deposit", "amount": 10_000})
    r = ctx["officer"].post(f"/borrowers/{bid}/savings", {"kind": "withdrawal", "amount": 25_000})
    assert r.status_code == 422


def test_savings_list_and_auditor_readonly(ctx, client):
    ctx["officer"].post(f"/borrowers/{ctx['borrower']['id']}/savings", {"kind": "deposit", "amount": 15_000})
    rows = ctx["admin"].get("/savings").json()
    assert any(a["balance"] == 15_000 for a in rows)

    auditor = make_staff(ctx["admin"], client, role="auditor", email="aud2@test.co")
    assert auditor.get("/savings").status_code == 200
    assert auditor.post(
        f"/borrowers/{ctx['borrower']['id']}/savings", {"kind": "deposit", "amount": 1}
    ).status_code == 403
