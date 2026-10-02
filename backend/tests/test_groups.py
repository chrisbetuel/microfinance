import pytest

from tests.conftest import Actor, borrower_payload, make_staff, product_payload, forward_for_approval


@pytest.fixture
def ctx(admin: Actor, branch: dict, client):
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    product = admin.post("/products", product_payload()).json()
    b1 = officer.post("/borrowers", borrower_payload(branch["id"], fullName="Asha One", nationalId="G-1", phone="+255700000011")).json()
    b2 = officer.post("/borrowers", borrower_payload(branch["id"], fullName="Bakari Two", nationalId="G-2", phone="+255700000012")).json()
    b3 = officer.post("/borrowers", borrower_payload(branch["id"], fullName="Chausiku Three", nationalId="G-3", phone="+255700000013")).json()
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
    active = [m for m in removed.json()["memberships"] if m["status"] == "active"]
    assert len(active) == 1  # the leaver keeps their record, marked "left"
    assert any(m["status"] == "left" and m["leftOn"] for m in removed.json()["memberships"])


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

    forward_for_approval(app.json()['id'])
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


def test_group_registration_with_details_members_and_leadership(ctx):
    r = ctx["officer"].post("/groups", {
        "name": "Mwanga Women Group", "branchId": ctx["branch"]["id"], "officerId": ctx["officer"].staff["id"],
        "groupType": "women", "purpose": "Joint stock purchase", "region": "Dar es Salaam", "district": "Ilala",
        "ward": "Gerezani", "location": "Gerezani market", "meetingLocation": "Church hall",
        "meetingDay": "Friday", "meetingFrequency": "biweekly", "loanLimit": 5_000_000, "status": "pending",
        "members": [
            {"borrowerId": ctx["b1"]["id"], "role": "chair"},
            {"borrowerId": ctx["b2"]["id"], "role": "treasurer"},
            {"borrowerId": ctx["b3"]["id"]},
        ],
        "documents": [{"name": "constitution.pdf", "type": "Group constitution"}],
    })
    assert r.status_code == 201, r.content
    g = r.json()
    assert g["groupNumber"].startswith("GRP-") and g["status"] == "pending" and g["groupType"] == "women"
    assert g["loanLimit"] == 5_000_000 and g["meetingFrequency"] == "biweekly"
    roles = {m["borrowerName"]: m["role"] for m in g["memberships"]}
    assert roles == {"Asha One": "chair", "Bakari Two": "treasurer", "Chausiku Three": "member"}
    assert all(m["membershipNumber"].startswith(g["groupNumber"]) for m in g["memberships"])
    assert g["documents"][0]["name"] == "constitution.pdf"
    assert any(h["label"] == "Group formed" for h in g["history"])

    # promoting someone else to chair demotes the previous chair
    third = next(m for m in g["memberships"] if m["borrowerName"] == "Chausiku Three")
    upd = ctx["officer"].patch(f"/groups/{g['id']}/members/{third['id']}", {"role": "chair"}).json()
    chairs = [m["borrowerName"] for m in upd["memberships"] if m["role"] == "chair"]
    assert chairs == ["Chausiku Three"]

    st = ctx["officer"].patch(f"/groups/{g['id']}", {"status": "active"}).json()
    assert st["status"] == "active" and st["active"] is True


def test_meeting_records_attendance_and_collection(ctx):
    g = ctx["officer"].post("/groups", {
        "name": "Tumaini", "branchId": ctx["branch"]["id"], "officerId": ctx["officer"].staff["id"],
        "members": [{"borrowerId": ctx["b1"]["id"]}, {"borrowerId": ctx["b2"]["id"]}],
    }).json()
    m1, m2 = g["memberships"]
    r = ctx["officer"].post(f"/groups/{g['id']}/meetings", {
        "date": "2026-10-01", "notes": "Agreed weekly savings",
        "attendance": [
            {"membershipId": m1["id"], "present": True, "contribution": 10_000},
            {"membershipId": m2["id"], "present": False, "contribution": 5_000},  # absent → ignored
        ],
    })
    assert r.status_code == 201, r.content
    body = r.json()
    meeting = body["meetings"][0]
    assert meeting["collectionAmount"] == 10_000
    assert sum(a["present"] for a in meeting["attendance"]) == 1
    assert body["contributionsTotal"] == 10_000
