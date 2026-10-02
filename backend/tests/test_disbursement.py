"""Controlled disbursement: prepare → verify → authorise → release → confirm,
and the loan / schedule / ledger only appear once the transfer is confirmed."""

import pytest

from tests.conftest import Actor, borrower_payload, forward_for_approval, make_staff, product_payload


@pytest.fixture
def t(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    manager = make_staff(admin, client, role="branch_manager", branch_id=branch["id"])
    manager2 = make_staff(admin, client, role="branch_manager", branch_id=branch["id"], email="m2@test.co")
    cashier = make_staff(admin, client, role="cashier", branch_id=branch["id"])
    borrower = officer.post("/borrowers", borrower_payload(branch["id"], fullName="Asha Juma Mrisho", phone="+255712000111")).json()
    app = officer.post("/applications", {
        "borrowerId": borrower["id"], "productId": product["id"], "branchId": branch["id"],
        "amount": 1_000_000, "termInstalments": 4, "purpose": "Stock",
        "declaredIncome": 900_000, "declaredExpenses": 200_000, "creditBureauConsent": True,
    }).json()
    forward_for_approval(app["id"])
    manager.post(f"/applications/{app['id']}/decision", {"decision": "approved", "comment": "ok"})
    return {"admin": admin, "officer": officer, "manager": manager, "manager2": manager2, "cashier": cashier,
            "borrower": borrower, "app": app}


def _prepare(t, **overrides):
    body = {"applicationId": t["app"]["id"], "method": "bank_transfer", "recipientName": "Asha Juma Mrisho",
            "recipientProvider": "CRDB", "recipientAccount": "0150123456", "insurance": 5_000,
            "otherDeductions": [{"label": "Stamp duty", "amount": 1_000}]}
    body.update(overrides)
    r = t["cashier"].post("/disbursements", body)
    assert r.status_code == 201, r.content
    return r.json()


def _to_authorised(t, d):
    t["cashier"].post(f"/disbursements/{d['id']}/submit")
    v = t["manager2"].post(f"/disbursements/{d['id']}/verify", {"destinationConfirmed": True, "overrideReason": "seen at branch"})
    assert v.status_code == 200, v.content
    a = t["manager2"].post(f"/disbursements/{d['id']}/authorise")
    assert a.status_code == 200, a.content
    return a.json()


def _loans_for(t):
    return [l for l in t["cashier"].get("/loans").json() if l["applicationId"] == t["app"]["id"]]


def test_prepare_shows_breakdown_and_warnings(t):
    d = _prepare(t, recipientName="Someone Else")
    assert d["number"].startswith("DIS-")
    assert d["status"] == "pending"
    assert d["approvedAmount"] == 1_000_000
    assert d["feesTotal"] == 20_000  # 2% processing fee
    assert d["netAmount"] == 1_000_000 - 20_000 - 5_000 - 1_000
    assert any("does not match the borrower" in w for w in d["warnings"])
    assert not _loans_for(t)  # preparing moves no money
    assert t["officer"].get(f"/applications/{t['app']['id']}").json()["status"] == "approved"
    # only one disbursement in progress per application
    assert t["cashier"].post("/disbursements", {"applicationId": t["app"]["id"], "method": "cash"}).status_code == 409

    preview = t["cashier"].post("/disbursements/preview", {
        "applicationId": t["app"]["id"], "method": "mobile_money", "recipientName": "Asha Juma Mrisho",
        "recipientProvider": "mpesa", "recipientAccount": "0799999999",
    }).json()
    assert any("registered numbers" in w for w in preview["warnings"])
    assert preview["netAmount"] == 980_000


def test_full_flow_separates_duties_and_confirms_before_opening_loan(t):
    d = _prepare(t)
    t["cashier"].post(f"/disbursements/{d['id']}/submit")

    # the preparer can't verify or authorise
    assert t["cashier"].post(f"/disbursements/{d['id']}/verify", {"destinationConfirmed": True}).status_code == 403
    # failing checks (unverified borrower, documents) need an override reason
    assert t["manager2"].post(f"/disbursements/{d['id']}/verify", {"destinationConfirmed": True}).status_code == 422
    v = t["manager2"].post(f"/disbursements/{d['id']}/verify", {"destinationConfirmed": True, "overrideReason": "ID seen"}).json()
    assert v["checklist"]["loanApproved"] is True and v["staffNames"]["verifiedBy"]
    assert v["status"] == "under_verification"
    assert t["cashier"].post(f"/disbursements/{d['id']}/authorise").status_code == 403
    authorised = t["manager2"].post(f"/disbursements/{d['id']}/authorise").json()
    assert authorised["status"] == "approved"

    # the application's approver can't release the money
    assert t["manager"].post(f"/disbursements/{d['id']}/release").status_code == 403
    released = t["cashier"].post(f"/disbursements/{d['id']}/release").json()
    assert released["status"] == "processing"
    assert not _loans_for(t)  # clicking release is not disbursing

    assert t["cashier"].post(f"/disbursements/{d['id']}/confirm", {"success": True}).status_code == 422
    done = t["cashier"].post(f"/disbursements/{d['id']}/confirm", {"success": True, "reference": "TXN123456"}).json()
    assert done["status"] == "successful"
    assert done["transactionReference"] == "TXN123456"
    assert done["loanNumber"].startswith("LN-")
    [loan] = _loans_for(t)
    assert loan["netDisbursed"] == 974_000
    assert len(loan["schedule"]) == 4
    assert t["officer"].get(f"/applications/{t['app']['id']}").json()["status"] == "disbursed"
    actions = [e["action"] for e in done["events"]]
    assert actions[0] == "Prepared" and actions[-1].startswith("Transaction confirmed")

    ledger = t["admin"].get("/ledger").json()
    assert sum(e["debit"] for e in ledger["entries"]) == sum(e["credit"] for e in ledger["entries"])
    portfolio = next(a for a in ledger["accounts"] if a["code"] == "loan_portfolio")
    bank = next(a for a in ledger["accounts"] if a["code"] == "bank")
    assert portfolio["balance"] == 1_000_000 and bank["balance"] == -974_000
    assert ledger["reconciliation"]["disbursedPrincipal"] == 1_000_000
    assert ledger["reconciliation"]["difference"] == 0

    # a repayment moves principal out of the portfolio account
    t["cashier"].post("/repayments", {"loanId": loan["id"], "amount": loan["schedule"][0]["totalDue"], "channel": "cash"})
    rec = t["admin"].get("/ledger").json()["reconciliation"]
    assert rec["repaidPrincipal"] == 250_000
    assert rec["outstandingPrincipalLedger"] == 750_000 and rec["difference"] == 0


def test_failed_transfer_keeps_application_approved(t):
    d = _to_authorised(t, _prepare(t))
    t["cashier"].post(f"/disbursements/{d['id']}/release")
    assert t["cashier"].post(f"/disbursements/{d['id']}/confirm", {"success": False}).status_code == 422
    failed = t["cashier"].post(f"/disbursements/{d['id']}/confirm", {"success": False, "reason": "Account closed"}).json()
    assert failed["status"] == "failed" and failed["failureReason"] == "Account closed"
    assert not _loans_for(t)
    assert t["officer"].get(f"/applications/{t['app']['id']}").json()["status"] == "approved"
    _prepare(t)  # a new attempt can be prepared


def test_mobile_money_is_confirmed_by_the_gateway(t):
    d = _to_authorised(t, _prepare(t, method="mobile_money", recipientProvider="airtel", recipientAccount="0712000111"))
    released = t["cashier"].post(f"/disbursements/{d['id']}/release").json()
    assert released["status"] == "processing" and released["paymentStatus"] == "pending"
    assert t["cashier"].post(f"/disbursements/{d['id']}/confirm", {"success": True, "reference": "x"}).status_code == 409
    assert not _loans_for(t)

    t["cashier"].post(f"/payments/{released['paymentId']}/simulate", {"outcome": "success"})
    done = t["cashier"].get(f"/disbursements/{d['id']}").json()
    assert done["status"] == "successful" and done["loanId"]
    assert _loans_for(t)[0]["disbursement"]["channel"] == "mobile_money"


def test_mobile_money_failure_marks_disbursement_failed(t):
    d = _to_authorised(t, _prepare(t, method="mobile_money", recipientProvider="mpesa", recipientAccount="0712000111"))
    released = t["cashier"].post(f"/disbursements/{d['id']}/release").json()
    t["cashier"].post(f"/payments/{released['paymentId']}/simulate", {"outcome": "failed"})
    assert t["cashier"].get(f"/disbursements/{d['id']}").json()["status"] == "failed"
    assert t["officer"].get(f"/applications/{t['app']['id']}").json()["status"] == "approved"


def test_large_loans_need_two_authorisers(t):
    t["admin"].patch("/lender", {"dualAuthorisationThreshold": 500_000})
    d = _prepare(t)
    assert d["requiresDualAuthorisation"] is True
    t["cashier"].post(f"/disbursements/{d['id']}/submit")
    t["manager2"].post(f"/disbursements/{d['id']}/verify", {"destinationConfirmed": True, "overrideReason": "ok"})
    first = t["manager2"].post(f"/disbursements/{d['id']}/authorise").json()
    assert first["status"] == "under_verification" and first["authorisedById"]
    assert t["manager2"].post(f"/disbursements/{d['id']}/authorise").status_code == 403
    second = t["manager"].post(f"/disbursements/{d['id']}/authorise").json()
    assert second["status"] == "approved" and second["secondAuthorisedById"] == t["manager"].staff["id"]


def test_changes_after_verification_reset_the_controls(t):
    d = _to_authorised(t, _prepare(t))
    assert t["cashier"].patch(f"/disbursements/{d['id']}", {"recipientAccount": "999"}).status_code == 409  # authorised
    d2 = _prepare_after_cancel(t, d)
    t["cashier"].post(f"/disbursements/{d2['id']}/submit")
    t["manager2"].post(f"/disbursements/{d2['id']}/verify", {"destinationConfirmed": True, "overrideReason": "ok"})
    changed = t["cashier"].patch(f"/disbursements/{d2['id']}", {"recipientAccount": "0150999999"}).json()
    assert changed["status"] == "pending"
    assert changed["verifiedById"] is None
    assert changed["events"][-1]["changes"]["recipientAccount"]["to"] == "0150999999"


def _prepare_after_cancel(t, d):
    assert t["cashier"].post(f"/disbursements/{d['id']}/cancel", {"reason": ""}).status_code == 422
    cancelled = t["cashier"].post(f"/disbursements/{d['id']}/cancel", {"reason": "Wrong account"}).json()
    assert cancelled["status"] == "cancelled"
    return _prepare(t)


def test_reversal_undoes_the_loan_and_the_ledger(t):
    d = _to_authorised(t, _prepare(t))
    t["cashier"].post(f"/disbursements/{d['id']}/release")
    t["cashier"].post(f"/disbursements/{d['id']}/confirm", {"success": True, "reference": "TXN1"})
    # the person who released it can't reverse it, nor can a cashier
    assert t["cashier"].post(f"/disbursements/{d['id']}/reverse", {"reason": "Bounced"}).status_code == 403
    reversed_ = t["manager"].post(f"/disbursements/{d['id']}/reverse", {"reason": "Transfer bounced"}).json()
    assert reversed_["status"] == "reversed"
    assert _loans_for(t)[0]["status"] == "reversed"
    assert t["officer"].get(f"/applications/{t['app']['id']}").json()["status"] == "approved"
    rec = t["admin"].get("/ledger").json()
    assert next(a for a in rec["accounts"] if a["code"] == "loan_portfolio")["balance"] == 0
    assert rec["reconciliation"]["difference"] == 0


def test_cannot_reverse_after_repayments(t):
    d = _to_authorised(t, _prepare(t))
    t["cashier"].post(f"/disbursements/{d['id']}/release")
    t["cashier"].post(f"/disbursements/{d['id']}/confirm", {"success": True, "reference": "TXN1"})
    loan = _loans_for(t)[0]
    t["cashier"].post("/repayments", {"loanId": loan["id"], "amount": 10_000, "channel": "cash"})
    assert t["manager"].post(f"/disbursements/{d['id']}/reverse", {"reason": "x"}).status_code == 409
