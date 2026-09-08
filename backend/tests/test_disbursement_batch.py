import pytest

from tests.conftest import Actor, borrower_payload, make_staff, product_payload


@pytest.fixture
def approved_batch(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"])

    apps = []
    for i in range(3):
        borrower = officer.post(
            "/borrowers", borrower_payload(branch["id"], nationalId=f"NID-{i}", phone=f"+25570000{i:04d}")
        ).json()
        app = officer.post(
            "/applications",
            {
                "borrowerId": borrower["id"], "productId": product["id"], "branchId": branch["id"],
                "amount": 800_000, "termInstalments": 4, "purpose": "x",
                "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
            },
        ).json()
        manager.post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
        apps.append(app)
    return {"manager": manager, "cashier": cashier, "apps": apps}


def test_batch_disburses_all_approved(approved_batch):
    items = [
        {"applicationId": a["id"], "channel": "bank_transfer", "reference": f"BATCH-{i}"}
        for i, a in enumerate(approved_batch["apps"])
    ]
    r = approved_batch["cashier"].post("/disbursement/batch", {"items": items})
    assert r.status_code == 201, r.content
    body = r.json()
    assert len(body["disbursed"]) == 3
    assert body["skipped"] == []

    loans = approved_batch["cashier"].get("/loans").json()
    assert len([l for l in loans if l["status"] == "active"]) == 3


def test_batch_skips_bad_rows_but_releases_the_rest(approved_batch):
    apps = approved_batch["apps"]
    # disburse the first one on its own
    approved_batch["cashier"].post(
        f"/applications/{apps[0]['id']}/disburse", {"channel": "cash", "reference": "SOLO"}
    )
    items = [
        {"applicationId": apps[0]["id"], "channel": "cash", "reference": "DUP"},  # already disbursed
        {"applicationId": apps[1]["id"], "channel": "cash", "reference": "OK-1"},
        {"applicationId": apps[2]["id"], "channel": "cash", "reference": "OK-2"},
    ]
    r = approved_batch["cashier"].post("/disbursement/batch", {"items": items})
    assert r.status_code == 201
    body = r.json()
    assert len(body["disbursed"]) == 2
    assert len(body["skipped"]) == 1
    assert body["skipped"][0]["applicationId"] == apps[0]["id"]


def test_batch_skips_when_approver_is_the_disburser(approved_batch):
    items = [
        {"applicationId": a["id"], "channel": "cash", "reference": f"X-{i}"}
        for i, a in enumerate(approved_batch["apps"])
    ]
    r = approved_batch["manager"].post("/disbursement/batch", {"items": items})
    assert r.status_code == 200
    body = r.json()
    assert body["disbursed"] == []
    assert len(body["skipped"]) == 3
    assert all("different people" in s["reason"] for s in body["skipped"])
