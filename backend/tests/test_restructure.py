from datetime import date, timedelta

import pytest
from django.core.management import call_command

from tests.conftest import Actor, borrower_payload, make_staff, product_payload


@pytest.fixture
def overdue_loan(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"])
    borrower = officer.post("/borrowers", borrower_payload(branch["id"])).json()
    app = officer.post(
        "/applications",
        {
            "borrowerId": borrower["id"], "productId": product["id"], "branchId": branch["id"],
            "amount": 1_200_000, "termInstalments": 6, "purpose": "x",
            "declaredIncome": 900_000, "declaredExpenses": 300_000, "creditBureauConsent": True,
        },
    ).json()
    manager.post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    loan = cashier.post(f"/applications/{app['id']}/disburse", {"channel": "cash", "reference": "R1"}).json()
    call_command("age_loans", "--as-of", (date.today() + timedelta(days=100)).isoformat())
    return {"admin": admin, "officer": officer, "manager": manager, "cashier": cashier, "loan": loan}


def _loan(actor, loan_id):
    return next(x for x in actor.get("/loans").json() if x["id"] == loan_id)


def test_restructure_rebuilds_schedule_and_clears_arrears(overdue_loan):
    lid = overdue_loan["loan"]["id"]
    before = _loan(overdue_loan["manager"], lid)
    assert before["daysInArrears"] > 0

    r = overdue_loan["manager"].post(f"/loans/{lid}/restructure", {"newTerm": 9, "reason": "hardship"})
    assert r.status_code == 200, r.content
    after = r.json()
    assert len(after["schedule"]) == 9
    assert after["daysInArrears"] == 0
    assert after["restructureCount"] == 1
    assert after["restructuredAt"] is not None
    assert all(i["status"] == "upcoming" for i in after["schedule"])


def test_waive_penalties_lowers_new_principal(overdue_loan):
    lid = overdue_loan["loan"]["id"]
    preview_plain = overdue_loan["manager"].get(f"/loans/{lid}/restructure").json()
    preview_waived = overdue_loan["manager"].get(f"/loans/{lid}/restructure?waivePenalties=true").json()
    assert preview_waived["penaltyWaived"] > 0
    assert preview_waived["newPrincipal"] < preview_plain["newPrincipal"]


def test_restructure_is_supervisor_only(overdue_loan):
    lid = overdue_loan["loan"]["id"]
    assert overdue_loan["cashier"].post(f"/loans/{lid}/restructure", {"newTerm": 8}).status_code == 403
    assert overdue_loan["officer"].post(f"/loans/{lid}/restructure", {"newTerm": 8}).status_code == 403


def test_repayment_after_restructure_allocates_to_new_schedule(overdue_loan):
    lid = overdue_loan["loan"]["id"]
    overdue_loan["manager"].post(f"/loans/{lid}/restructure", {"newTerm": 10})
    after = _loan(overdue_loan["manager"], lid)
    first_due = after["schedule"][0]["totalDue"]

    pay = overdue_loan["cashier"].post("/repayments", {"loanId": lid, "amount": first_due, "channel": "cash"})
    assert pay.status_code == 201, pay.content
    reloaded = _loan(overdue_loan["manager"], lid)
    assert reloaded["schedule"][0]["status"] == "paid"


def test_cannot_restructure_closed_loan(overdue_loan):
    lid = overdue_loan["loan"]["id"]
    overdue_loan["cashier"].post(f"/loans/{lid}/settle", {"channel": "cash"})
    r = overdue_loan["manager"].post(f"/loans/{lid}/restructure", {"newTerm": 8})
    assert r.status_code == 409
