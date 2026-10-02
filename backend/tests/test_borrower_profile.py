from tests.conftest import Actor, borrower_payload, make_staff, product_payload


def test_full_profile_round_trips_and_gets_customer_number(admin: Actor, branch: dict):
    payload = borrower_payload(
        branch["id"],
        dateOfBirth="1990-04-12", gender="female", maritalStatus="married", altPhone="+255711000000",
        email="halima@example.com", region="Dar es Salaam", district="Ilala", ward="Kariakoo",
        street="Msimbazi", postalAddress="P.O. Box 1", incomeSource="business", sector="Retail",
        businessLocation="Kariakoo market", yearsTrading=4, monthlyIncome=900000, monthlyExpenses=350000,
        otherIncomeSources="Rent", existingLoans="BRAC 500,000", existingLoanPayments=60000,
        bankName="CRDB", bankAccount="0150", mobileMoneyProvider="M-Pesa", mobileMoneyNumber="+255754",
        emergencyName="Said Juma", emergencyRelationship="Spouse", emergencyPhone="+255755", emergencyAddress="Ilala",
        guarantors=[{
            "name": "Asha", "nationalId": "G1", "phone": "+2557", "relationship": "Sister",
            "address": "Temeke", "occupation": "Teacher", "monthlyIncome": 700000, "guaranteeAmount": 500000,
        }],
    )
    r = admin.post("/borrowers", payload)
    assert r.status_code == 201, r.content
    b = r.json()
    assert b["customerNumber"] == "CUS-00001"
    assert b["status"] == "active"
    assert b["district"] == "Ilala" and b["emergencyRelationship"] == "Spouse"
    assert b["monthlyExpenses"] == 350000
    g = b["guarantors"][0]
    assert g["guaranteeAmount"] == 500000 and g["status"] == "pending" and g["relationship"] == "Sister"

    second = admin.post("/borrowers", borrower_payload(branch["id"], nationalId="X-2", phone="+2"))
    assert second.json()["customerNumber"] == "CUS-00002"


def test_update_profile_fields_and_replace_guarantors(admin: Actor, branch: dict):
    b = admin.post("/borrowers", borrower_payload(branch["id"])).json()
    r = admin.patch(f"/borrowers/{b['id']}", {
        "ward": "Upanga", "employerName": "TANESCO",
        "guarantors": [{"name": "New G", "nationalId": "N1", "phone": "+1", "status": "approved"}],
    })
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["ward"] == "Upanga" and body["employerName"] == "TANESCO"
    assert [g["name"] for g in body["guarantors"]] == ["New G"]
    assert any(h["label"] == "Profile updated" for h in body["history"])


def test_status_changes_and_suspended_cannot_apply(admin: Actor, branch: dict, client):
    product = admin.post("/products", product_payload()).json()
    officer = make_staff(admin, client, role="loan_officer", branch_id=branch["id"])
    b = officer.post("/borrowers", borrower_payload(branch["id"])).json()

    r = officer.post(f"/borrowers/{b['id']}/status", {"status": "suspended", "reason": "KYC review"})
    assert r.status_code == 200 and r.json()["status"] == "suspended"
    app = officer.post("/applications", {
        "borrowerId": b["id"], "productId": product["id"], "branchId": branch["id"],
        "amount": 500000, "termInstalments": 4, "purpose": "x",
        "declaredIncome": 900000, "declaredExpenses": 200000, "creditBureauConsent": True,
    })
    assert app.status_code == 422

    # blacklisting needs a reason and keeps the legacy flag in sync
    assert officer.post(f"/borrowers/{b['id']}/status", {"status": "blacklisted"}).status_code == 422
    bl = officer.post(f"/borrowers/{b['id']}/status", {"status": "blacklisted", "reason": "fraud"}).json()
    assert bl["blacklisted"] is True
    back = officer.post(f"/borrowers/{b['id']}/status", {"status": "active"}).json()
    assert back["blacklisted"] is False and back["status"] == "active"
