import pytest
from httpx import AsyncClient

from tests.conftest import Actor, borrower_payload, make_staff, product_payload


@pytest.fixture
async def approved_application(admin: Actor, branch: dict, client: AsyncClient):
    product = (await admin.post("/products", json=product_payload())).json()
    officer = await make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = await make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    cashier = await make_staff(admin, client, role="cashier", branch_id=branch["id"])
    borrower = (await officer.post("/borrowers", json=borrower_payload(branch["id"]))).json()

    app = (
        await officer.post(
            "/applications",
            json={
                "borrowerId": borrower["id"],
                "productId": product["id"],
                "branchId": branch["id"],
                "amount": 1_200_000,
                "termInstalments": 6,
                "purpose": "Restock",
                "declaredIncome": 900_000,
                "declaredExpenses": 300_000,
                "creditBureauConsent": True,
            },
        )
    ).json()
    await manager.post(f"/applications/{app['id']}/decision", json={"decision": "approved", "comment": "ok"})
    return {
        "app": app, "product": product, "officer": officer,
        "manager": manager, "cashier": cashier, "borrower": borrower,
    }


async def test_disburse_computes_net_and_schedule(approved_application: dict):
    app = approved_application["app"]
    resp = await approved_application["cashier"].post(
        f"/applications/{app['id']}/disburse", json={"channel": "mobile_money", "reference": "MM-1"}
    )
    assert resp.status_code == 201, resp.text
    loan = resp.json()
    # 2% processing fee is deducted at disbursement.
    assert loan["feesDeducted"] == 24000
    assert loan["netDisbursed"] == 1_176_000
    assert len(loan["schedule"]) == 6
    first = loan["schedule"][0]
    assert first["principalDue"] == 200000
    assert first["interestDue"] == 48000
    assert first["totalDue"] == 248000
    assert loan["disbursement"]["disbursedBy"] == approved_application["cashier"].staff["name"]


async def test_approver_cannot_also_disburse(approved_application: dict):
    app = approved_application["app"]
    resp = await approved_application["manager"].post(
        f"/applications/{app['id']}/disburse", json={"channel": "cash", "reference": "C-1"}
    )
    assert resp.status_code == 403


async def test_cannot_disburse_unapproved(admin: Actor, branch: dict, client: AsyncClient):
    product = (await admin.post("/products", json=product_payload())).json()
    officer = await make_staff(admin, client, role="loan_officer", branch_id=branch["id"], email="o2@test.co")
    borrower = (await officer.post("/borrowers", json=borrower_payload(branch["id"]))).json()
    app = (
        await officer.post(
            "/applications",
            json={
                "borrowerId": borrower["id"], "productId": product["id"], "branchId": branch["id"],
                "amount": 1_000_000, "termInstalments": 4, "purpose": "x",
                "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
            },
        )
    ).json()
    resp = await admin.post(f"/applications/{app['id']}/disburse", json={"channel": "cash", "reference": "C"})
    assert resp.status_code == 409


async def test_repayment_allocates_in_bucket_order(approved_application: dict):
    app = approved_application["app"]
    cashier = approved_application["cashier"]
    loan = (
        await cashier.post(
            f"/applications/{app['id']}/disburse", json={"channel": "mobile_money", "reference": "MM-1"}
        )
    ).json()

    resp = await cashier.post("/repayments", json={"loanId": loan["id"], "amount": 248000, "channel": "mobile_money"})
    assert resp.status_code == 201, resp.text
    rp = resp.json()
    assert rp["allocation"] == {"penalty": 0, "fees": 0, "interest": 48000, "principal": 200000}
    assert rp["receiptNumber"].startswith("RCT-")

    loans = (await cashier.get("/loans")).json()
    updated = next(loan_row for loan_row in loans if loan_row["id"] == loan["id"])
    assert updated["schedule"][0]["status"] == "paid"


async def test_full_repayment_closes_loan_and_reversal_reopens(approved_application: dict):
    app = approved_application["app"]
    cashier = approved_application["cashier"]
    manager = approved_application["manager"]
    loan = (
        await cashier.post(
            f"/applications/{app['id']}/disburse", json={"channel": "mobile_money", "reference": "MM-1"}
        )
    ).json()
    total_due = sum(i["totalDue"] for i in loan["schedule"])

    pay = await cashier.post(
        "/repayments", json={"loanId": loan["id"], "amount": total_due, "channel": "bank"}
    )
    assert pay.status_code == 201
    loans = (await cashier.get("/loans")).json()
    assert next(x for x in loans if x["id"] == loan["id"])["status"] == "closed"

    # A cashier may not reverse; a supervisor may.
    assert (await cashier.post(f"/repayments/{pay.json()['id']}/reverse", json={"reason": "x"})).status_code == 403
    rev = await manager.post(f"/repayments/{pay.json()['id']}/reverse", json={"reason": "duplicate"})
    assert rev.status_code == 200
    assert rev.json()["reversed"] is True

    loans = (await cashier.get("/loans")).json()
    reopened = next(x for x in loans if x["id"] == loan["id"])
    assert reopened["status"] == "active"
    assert reopened["outstandingBalance"] > 0
