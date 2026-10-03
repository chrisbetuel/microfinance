"""Repayments as transactions: details, receipts, reversal + correction, group
payments split by member, and reconciliation against statements and the till."""

from datetime import date, timedelta

import pytest

from tests.conftest import Actor, borrower_payload, forward_for_approval, make_staff, product_payload, release_loan


@pytest.fixture
def t(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"])
    borrowers = [
        officer.post("/borrowers", borrower_payload(branch["id"], fullName=f"Member {i}", nationalId=f"NID{i}",
                                                    phone=f"+25571300000{i}")).json()
        for i in range(2)
    ]
    group = officer.post("/groups", {
        "name": "Umoja", "branchId": branch["id"], "officerId": officer.staff["id"],
        "members": [{"borrowerId": b["id"], "role": "member"} for b in borrowers],
    }).json()
    loans = []
    for b in borrowers:
        app = officer.post("/applications", {
            "borrowerId": b["id"], "productId": product["id"], "branchId": branch["id"], "groupId": group["id"],
            "amount": 1_000_000, "termInstalments": 4, "purpose": "Stock",
            "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
        }).json()
        forward_for_approval(app["id"])
        manager.post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
        loans.append(release_loan(cashier, app["id"], "cash", f"C-{b['id'][:4]}"))
    return {"admin": admin, "manager": manager, "cashier": cashier, "officer": officer, "group": group,
            "loans": loans, "borrowers": borrowers}


def _pay(t, loan, **body):
    return t["cashier"].post("/repayments", {"loanId": loan["id"], "amount": 100_000, "channel": "cash", **body})


def test_payment_records_details_and_receipt_fields(t):
    loan = t["loans"][0]
    paid_on = date.today().isoformat()
    r = _pay(t, loan, channel="bank", reference="NMB123", paymentDate=paid_on, collectionPoint="NMB Kariakoo",
             notes="Deposit slip seen")
    assert r.status_code == 201, r.content
    rp = r.json()
    assert rp["receiptNumber"].startswith("RCT-")
    assert rp["paymentDate"] == paid_on and rp["reference"] == "NMB123"
    assert rp["receivedByName"] == t["cashier"].staff["name"]
    assert rp["collectionPoint"] == "NMB Kariakoo"
    assert rp["balanceAfter"] == loan["outstandingBalance"] - 100_000
    assert rp["reconciliationStatus"] == "unreconciled"
    # first instalment is now partially paid, not paid
    fresh = t["cashier"].get(f"/loans/{loan['id']}").json()
    assert fresh["schedule"][0]["status"] == "partial"


def test_payment_validation(t):
    loan = t["loans"][0]
    assert _pay(t, loan, channel="mobile_money").status_code == 422  # no reference
    assert _pay(t, loan, paymentDate=(date.today() + timedelta(days=2)).isoformat()).status_code == 422
    assert _pay(t, loan, channel="mobile_money", reference="MPX1").status_code == 201
    dup = _pay(t, t["loans"][1], channel="mobile_money", reference="mpx1")
    assert dup.status_code == 409 and "already recorded" in dup.json()["detail"]


def test_reverse_and_correct_keeps_history(t):
    loan = t["loans"][0]
    wrong = _pay(t, loan, amount=150_000).json()
    assert t["cashier"].post(f"/repayments/{wrong['id']}/reverse", {"reason": "x"}).status_code == 403  # supervisors only
    body = t["manager"].post(f"/repayments/{wrong['id']}/reverse", {
        "reason": "Keyed 150,000 instead of 105,000", "corrected": {"amount": 105_000},
    }).json()
    assert body["reversed"] is True and body["reversedBy"] == t["manager"].staff["name"]
    fixed = body["corrected"]
    assert fixed["correctsId"] == wrong["id"] and fixed["amount"] == 105_000
    rows = {r["id"]: r for r in t["cashier"].get("/repayments").json()}
    assert rows[wrong["id"]]["correctedById"] == fixed["id"]  # the original stays, linked
    fresh = t["cashier"].get(f"/loans/{loan['id']}").json()
    assert round(fresh["outstandingBalance"], 2) == round(loan["outstandingBalance"] - 105_000, 2)
    ledger = t["admin"].get("/ledger").json()
    assert ledger["reconciliation"]["difference"] == 0


def test_group_payment_splits_by_member(t):
    a, b = t["loans"]
    r = t["cashier"].post(f"/groups/{t['group']['id']}/payments", {
        "channel": "mobile_money", "reference": "MPGRP1", "contributions": [
            {"loanId": a["id"], "amount": 100_000}, {"loanId": b["id"], "amount": 50_000},
        ],
    })
    assert r.status_code == 201, r.content
    gp = r.json()
    assert gp["number"].startswith("GPY-") and gp["amount"] == 150_000 and len(gp["repaymentIds"]) == 2
    rows = [x for x in t["cashier"].get("/repayments").json() if x["groupPaymentId"] == gp["id"]]
    assert sorted(x["amount"] for x in rows) == [50_000, 100_000]
    assert t["cashier"].get(f"/groups/{t['group']['id']}/payments").json()[0]["id"] == gp["id"]

    bad = t["cashier"].post(f"/groups/{t['group']['id']}/payments", {
        "channel": "cash", "contributions": [{"loanId": "00000000-0000-0000-0000-000000000000", "amount": 1000}],
    })
    assert bad.status_code == 422


def test_statement_reconciliation(t):
    a, b = t["loans"]
    by_ref = _pay(t, a, channel="bank", reference="NMB777", amount=120_000).json()
    no_ref_match = _pay(t, b, channel="bank", reference="NMB888", amount=80_000).json()
    gp = t["cashier"].post(f"/groups/{t['group']['id']}/payments", {
        "channel": "bank", "reference": "NMBGRP", "contributions": [
            {"loanId": a["id"], "amount": 10_000}, {"loanId": b["id"], "amount": 20_000},
        ],
    }).json()
    today = date.today().isoformat()
    r = t["cashier"].post("/reconciliation/import", {"source": "bank", "lines": [
        {"date": today, "reference": "NMB777", "amount": 120_000, "description": "Deposit"},
        {"date": today, "reference": "NMBGRP", "amount": 30_000, "description": "Group"},
        {"date": today, "reference": "UNKNOWN1", "amount": 55_000, "description": "Who is this?"},
        {"date": today, "reference": "CHG", "amount": -2_000, "description": "Bank charge"},
    ]})
    assert r.status_code == 201, r.content
    assert r.json()["imported"] == 3 and r.json()["matched"] == 2
    again = t["cashier"].post("/reconciliation/import", {"source": "bank", "lines": [
        {"date": today, "reference": "NMB777", "amount": 120_000}]}).json()
    assert again["duplicates"] == 1

    rows = {x["id"]: x for x in t["cashier"].get("/repayments").json()}
    assert rows[by_ref["id"]]["reconciliationStatus"] == "reconciled"
    assert all(rows[i]["reconciliationStatus"] == "reconciled" for i in gp["repaymentIds"])
    assert rows[no_ref_match["id"]]["reconciliationStatus"] == "unreconciled"

    view = t["cashier"].get("/reconciliation?source=bank").json()
    assert view["summary"]["statementUnmatchedCount"] == 1 and view["summary"]["unreconciledCount"] == 1
    unknown = next(x for x in view["lines"] if x["reference"] == "UNKNOWN1")
    # amounts must agree for a manual match
    assert t["cashier"].post(f"/reconciliation/lines/{unknown['id']}/match", {"repaymentId": no_ref_match["id"]}).status_code == 422
    assert t["cashier"].post(f"/reconciliation/lines/{unknown['id']}/ignore", {"note": ""}).status_code == 422
    ignored = t["cashier"].post(f"/reconciliation/lines/{unknown['id']}/ignore", {"note": "Savings deposit, not a repayment"}).json()
    assert ignored["status"] == "ignored"

    # reversing a reconciled payment frees its statement line again
    t["manager"].post(f"/repayments/{by_ref['id']}/reverse", {"reason": "Bounced cheque"})
    line = next(x for x in t["cashier"].get("/reconciliation?source=bank").json()["lines"] if x["reference"] == "NMB777")
    assert line["status"] == "unmatched"


def test_closing_the_till_reconciles_cash(t):
    p = _pay(t, t["loans"][0], amount=60_000).json()
    pos = t["cashier"].get("/till/today").json()
    t["cashier"].post("/till", {"countedClose": pos["expectedClose"], "note": ""})
    row = next(x for x in t["cashier"].get("/repayments").json() if x["id"] == p["id"])
    assert row["reconciliationStatus"] == "reconciled" and "drawer" in row["reconciliationNote"]
