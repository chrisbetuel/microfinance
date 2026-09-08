import pytest

from tests.conftest import Actor, borrower_payload, make_staff, product_payload


@pytest.fixture
def ctx(admin: Actor, branch: dict, client):
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    product = admin.post("/products", product_payload()).json()
    b1 = officer.post("/borrowers", borrower_payload(branch["id"], fullName="Asha One", nationalId="G-1")).json()
    b2 = officer.post("/borrowers", borrower_payload(branch["id"], fullName="Bakari Two", nationalId="G-2")).json()
    b3 = officer.post("/borrowers", borrower_payload(branch["id"], fullName="Chausiku Three", nationalId="G-3")).json()
    return {"admin": admin, "officer": officer, "manager": manager, "product": product,
            "branch": branch, "b1": b1, "b2": b2, "b3": b3}


def _group(ctx):
    return ctx["officer"].post(
        "/groups",
        {"name": "Tumaini Group", "branchId": ctx["branch"]["id"], "officerId": ctx["officer"].staff["id"],
         "meetingDay": "Monday"},
    ).json()


def test_create_group_and_manage_members(ctx):
    grp = _group(ctx)
    assert grp["name"] == "Tumaini Group"

    ctx["officer"].post(f"/groups/{grp['id']}/members", {"borrowerId": ctx["b1"]["id"], "role": "chair"})
    r = ctx["officer"].post(f"/groups/{grp['id']}/members", {"borrowerId": ctx["b2"]["id"]})
    assert r.status_code == 201
    assert len(r.json()["memberships"]) == 2

    # duplicate rejected
    assert ctx["officer"].post(f"/groups/{grp['id']}/members", {"borrowerId": ctx["b1"]["id"]}).status_code == 409

    membership_id = next(m["id"] for m in r.json()["memberships"] if m["borrowerId"] == ctx["b2"]["id"])
    removed = ctx["officer"].delete(f"/groups/{grp['id']}/members/{membership_id}")
    assert removed.status_code == 200
    assert len(removed.json()["memberships"]) == 1


def test_application_can_be_tied_to_a_group(ctx):
    grp = _group(ctx)
    ctx["officer"].post(f"/groups/{grp['id']}/members", {"borrowerId": ctx["b1"]["id"]})

    app = ctx["officer"].post(
        "/applications",
        {
            "borrowerId": ctx["b1"]["id"], "productId": ctx["product"]["id"], "branchId": ctx["branch"]["id"],
            "groupId": grp["id"], "amount": 500_000, "termInstalments": 4, "purpose": "x",
            "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
        },
    )
    assert app.status_code == 201, app.content
    assert app.json()["groupId"] == grp["id"]

    ctx["manager"].post(f"/applications/{app.json()['id']}/decision", {"decision": "approved", "comment": "ok"})
    cashier = make_staff(ctx["admin"], ctx["officer"]._client, role="cashier", branch_id=ctx["branch"]["id"], email="gc@test.co")
    loan = cashier.post(f"/applications/{app.json()['id']}/disburse", {"channel": "cash", "reference": "G1"})
    assert loan.json()["groupId"] == grp["id"]


def test_non_member_cannot_borrow_against_group(ctx):
    grp = _group(ctx)
    r = ctx["officer"].post(
        "/applications",
        {
            "borrowerId": ctx["b3"]["id"], "productId": ctx["product"]["id"], "branchId": ctx["branch"]["id"],
            "groupId": grp["id"], "amount": 500_000, "termInstalments": 4, "purpose": "x",
            "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
        },
    )
    assert r.status_code == 422


def test_auditor_cannot_create_group(ctx, client):
    auditor = make_staff(ctx["admin"], client, role="auditor", email="ga@test.co")
    r = auditor.post(
        "/groups",
        {"name": "X", "branchId": ctx["branch"]["id"], "officerId": ctx["officer"].staff["id"]},
    )
    assert r.status_code == 403
