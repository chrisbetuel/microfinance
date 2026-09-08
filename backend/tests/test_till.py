import pytest

from tests.conftest import Actor, borrower_payload, make_staff, product_payload


@pytest.fixture
def cashier_ctx(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"])
    borrower = officer.post("/borrowers", borrower_payload(branch["id"])).json()
    app = officer.post(
        "/applications",
        {
            "borrowerId": borrower["id"], "productId": product["id"], "branchId": branch["id"],
            "amount": 1_000_000, "termInstalments": 5, "purpose": "x",
            "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
        },
    ).json()
    manager.post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    loan = cashier.post(f"/applications/{app['id']}/disburse", {"channel": "cash", "reference": "C1"}).json()
    return {"cashier": cashier, "manager": manager, "loan": loan}


def test_position_reflects_cash_in_and_out(cashier_ctx):
    cashier = cashier_ctx["cashier"]
    loan = cashier_ctx["loan"]
    cashier.post("/repayments", {"loanId": loan["id"], "amount": 150_000, "channel": "cash"})
    cashier.post("/repayments", {"loanId": loan["id"], "amount": 50_000, "channel": "mobile_money"})

    pos = cashier.get("/till/today").json()
    assert pos["cashIn"] == 150_000  # only the cash repayment
    assert pos["cashOut"] == loan["netDisbursed"]  # the cash disbursement
    assert pos["expectedClose"] == pos["openingFloat"] + 150_000 - loan["netDisbursed"]
    assert pos["closed"] is False


def test_close_records_variance_and_blocks_double_close(cashier_ctx):
    cashier = cashier_ctx["cashier"]
    cashier.post("/repayments", {"loanId": cashier_ctx["loan"]["id"], "amount": 200_000, "channel": "cash"})
    pos = cashier.get("/till/today").json()

    r = cashier.post("/till", {"countedClose": pos["expectedClose"] - 500, "note": "short by 500"})
    assert r.status_code == 201, r.content
    assert r.json()["variance"] == -500

    again = cashier.post("/till", {"countedClose": 0})
    assert again.status_code == 409


def test_till_is_per_cashier(cashier_ctx, client, admin):
    admin.post(
        "/staff",
        {"name": "Neema Other", "email": "c2@test.co", "password": "password123", "role": "cashier", "branchId": None},
    )
    login = client.post("/auth/login", {"email": "c2@test.co", "password": "password123"}, format="json")
    other = Actor(client, login.json()["accessToken"], {"name": "Neema Other"})

    cashier_ctx["cashier"].post(
        "/repayments", {"loanId": cashier_ctx["loan"]["id"], "amount": 100_000, "channel": "cash"}
    )
    assert other.get("/till/today").json()["cashIn"] == 0
