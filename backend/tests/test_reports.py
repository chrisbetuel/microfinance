"""The audit report reads the trail by period from the API."""

from datetime import date, timedelta

from tests.conftest import Actor, borrower_payload


def test_audit_can_be_read_by_period(admin: Actor, branch: dict):
    admin.post("/borrowers", borrower_payload(branch["id"]))
    today = date.today().isoformat()
    rows = admin.get(f"/audit?from={today}&to={today}&limit=10000").json()
    assert any(r["entity"] == "borrower" for r in rows)
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    assert admin.get(f"/audit?from={tomorrow}").json() == []
    assert admin.get("/audit?from=yesterday").status_code == 422
