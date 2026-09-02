import pytest

from tests.conftest import Actor, borrower_payload, make_staff, product_payload


@pytest.fixture
def approved_application(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"])
    borrower = officer.post("/borrowers", borrower_payload(branch["id"])).json()

    app = officer.post(
        "/applications",
        {
            "borrowerId": borrower["id"], "productId": product["id"], "branchId": branch["id"],
            "amount": 1_200_000, "termInstalments": 6, "purpose": "Restock",
            "declaredIncome": 900_000, "declaredExpenses": 300_000, "creditBureauConsent": True,
        },
    ).json()
    manager.post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    return {"app": app, "product": product, "officer": officer, "manager": manager, "cashier": cashier, "borrower": borrower}


def test_disburse_computes_net_and_schedule(approved_application):
    app = approved_application["app"]
    resp = approved_application["cashier"].post(
        f"/applications/{app['id']}/disburse", {"channel": "mobile_money", "reference": "MM-1"}
    )
    assert resp.status_code == 201, resp.content
    loan = resp.json()
    assert loan["feesDeducted"] == 24000
    assert loan["netDisbursed"] == 1_176_000
    assert len(loan["schedule"]) == 6
    first = loan["schedule"][0]
    assert first["principalDue"] == 200000
    assert first["interestDue"] == 48000
    assert first["totalDue"] == 248000
    assert loan["disbursement"]["disbursedBy"] == approved_application["cashier"].staff["name"]


def test_approver_cannot_also_disburse(approved_application):
    app = approved_application["app"]
    resp = approved_application["manager"].post(
        f"/applications/{app['id']}/disburse", {"channel": "cash", "reference": "C-1"}
    )
    assert resp.status_code == 403


def test_cannot_disburse_unapproved(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"], email="o2@test.co")
    borrower = officer.post("/borrowers", borrower_payload(branch["id"])).json()
    app = officer.post(
        "/applications",
        {
            "borrowerId": borrower["id"], "productId": product["id"], "branchId": branch["id"],
            "amount": 1_000_000, "termInstalments": 4, "purpose": "x",
            "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
        },
    ).json()
    resp = admin.post(f"/applications/{app['id']}/disburse", {"channel": "cash", "reference": "C"})
    assert resp.status_code == 409


def test_repayment_allocates_in_bucket_order(approved_application):
    app = approved_application["app"]
    cashier = approved_application["cashier"]
    loan = cashier.post(f"/applications/{app['id']}/disburse", {"channel": "mobile_money", "reference": "MM-1"}).json()

    resp = cashier.post("/repayments", {"loanId": loan["id"], "amount": 248000, "channel": "mobile_money"})
    assert resp.status_code == 201, resp.content
    rp = resp.json()
    assert rp["allocation"] == {"penalty": 0, "fees": 0, "interest": 48000, "principal": 200000}
    assert rp["receiptNumber"].startswith("RCT-")

    loans = cashier.get("/loans").json()
    updated = next(row for row in loans if row["id"] == loan["id"])
    assert updated["schedule"][0]["status"] == "paid"


def test_full_repayment_closes_loan_and_reversal_reopens(approved_application):
    app = approved_application["app"]
    cashier = approved_application["cashier"]
    manager = approved_application["manager"]
    loan = cashier.post(f"/applications/{app['id']}/disburse", {"channel": "mobile_money", "reference": "MM-1"}).json()
    total_due = sum(i["totalDue"] for i in loan["schedule"])

    pay = cashier.post("/repayments", {"loanId": loan["id"], "amount": total_due, "channel": "bank"})
    assert pay.status_code == 201
    loans = cashier.get("/loans").json()
    assert next(x for x in loans if x["id"] == loan["id"])["status"] == "closed"

    assert cashier.post(f"/repayments/{pay.json()['id']}/reverse", {"reason": "x"}).status_code == 403
    rev = manager.post(f"/repayments/{pay.json()['id']}/reverse", {"reason": "duplicate"})
    assert rev.status_code == 200
    assert rev.json()["reversed"] is True

    loans = cashier.get("/loans").json()
    reopened = next(x for x in loans if x["id"] == loan["id"])
    assert reopened["status"] == "active"
    assert reopened["outstandingBalance"] > 0
