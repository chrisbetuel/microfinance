import pytest
from rest_framework.test import APIClient


@pytest.fixture(autouse=True)
def _enable_db(db):
    """Every test in this suite touches the database."""


@pytest.fixture(autouse=True)
def _utc_business_day(settings):
    """Tests compare against date.today() on a UTC clock; keep business dates in UTC too."""
    settings.TIME_ZONE = "UTC"


@pytest.fixture
def client():
    return APIClient()


class Actor:
    """A logged-in staff member plus a client that sends their bearer token."""

    def __init__(self, client: APIClient, token: str, staff: dict):
        self._client = client
        self.token = token
        self.staff = staff

    @property
    def _auth(self) -> dict:
        return {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}

    def get(self, url, **kw):
        return self._client.get(url, **self._auth, **kw)

    def post(self, url, data=None, **kw):
        return self._client.post(url, data or {}, format="json", **self._auth, **kw)

    def patch(self, url, data=None, **kw):
        return self._client.patch(url, data or {}, format="json", **self._auth, **kw)

    def put(self, url, data=None, **kw):
        return self._client.put(url, data or {}, format="json", **self._auth, **kw)

    def delete(self, url, **kw):
        return self._client.delete(url, **self._auth, **kw)


def register(client: APIClient, **overrides) -> str:
    body = {
        "lenderName": "Test Microfinance",
        "adminName": "Ada Admin",
        "adminEmail": "ada@test.co",
        "adminPassword": "password123",
    }
    body.update(overrides)
    resp = client.post("/auth/register", body, format="json")
    assert resp.status_code == 201, resp.content
    return resp.json()["accessToken"]


@pytest.fixture
def admin(client: APIClient) -> Actor:
    token = register(client)
    me = client.get("/auth/me", HTTP_AUTHORIZATION=f"Bearer {token}")
    return Actor(client, token, me.json())


@pytest.fixture
def branch(admin: Actor) -> dict:
    resp = admin.post("/branches", {"name": "Main", "code": "MN", "location": "Dar", "openedOn": "2024-01-01"})
    assert resp.status_code == 201, resp.content
    return resp.json()


def make_staff(admin: Actor, client: APIClient, *, role: str, branch_id=None, email=None) -> Actor:
    email = email or f"{role}@test.co"
    resp = admin.post(
        "/staff",
        {
            "name": role.replace("_", " ").title(),
            "email": email,
            "password": "password123",
            "role": role,
            "branchId": str(branch_id) if branch_id else None,
        },
    )
    assert resp.status_code == 201, resp.content
    login = client.post("/auth/login", {"email": email, "password": "password123"}, format="json")
    return Actor(client, login.json()["accessToken"], resp.json())


def product_payload(**overrides) -> dict:
    base = {
        "name": "Working Capital",
        "code": "WC",
        "active": True,
        "interestMethod": "reducing",
        "interestRate": 4,
        "interestPeriod": "monthly",
        "repaymentFrequency": "monthly",
        "minAmount": 100000,
        "maxAmount": 5000000,
        "minTermInstalments": 3,
        "maxTermInstalments": 12,
        "stepUpEnabled": False,
        "gracePeriodDays": 0,
        "gracePeriodAppliesTo": "none",
        "penaltyKind": "percent",
        "penaltyValue": 1,
        "penaltyCap": 50000,
        "allocationOrder": ["penalty", "fee", "interest", "principal"],
        "securityRequired": ["guarantors"],
        "fees": [{"name": "Processing", "kind": "percent", "value": 2, "timing": "deducted"}],
        "approvalLevels": [{"minAmount": 0, "maxAmount": None, "requiredRole": "branch_manager"}],
    }
    base.update(overrides)
    return base


def borrower_payload(branch_id, **overrides) -> dict:
    base = {
        "type": "individual",
        "branchId": str(branch_id),
        "fullName": "Halima Said",
        "nationalId": "1985-0001",
        "phone": "+255700000001",
        "residence": "Kariakoo",
        "occupation": "Trader",
        "monthlyIncome": 900000,
        "nextOfKin": "Said",
    }
    base.update(overrides)
    return base


def forward_for_approval(application_id) -> None:
    """Stand-in for the loan officer's assessment, for tests about approval and
    what follows it: moves an application still with the officer to the approver
    as recommended on its requested terms. No-op once it is past assessment."""
    from django.utils import timezone

    from lms.models import Application

    app = Application.objects.get(pk=application_id)
    if app.status not in ("draft", "submitted", "under_assessment"):
        return
    app.status = "pending_approval"
    app.assessment_result = "recommended"
    app.assessed_amount = app.amount
    app.recommended_term = app.term_instalments
    app.assessed_by_id = app.created_by_id
    app.assessed_at = timezone.now()
    app.save()


def release_loan(actor: Actor, application_id, channel: str = "cash", reference: str = "REF-1") -> dict:
    """Run an approved application through the controlled disbursement workflow —
    prepared and released by `actor`, verified and authorised by another
    supervisor of the same lender — and return the opened loan as the API renders
    it. For tests about what happens after disbursement; test_disbursement.py
    covers the workflow itself."""
    from lms.models import Application, PaymentTransaction, Staff
    from lms.services import disbursements, gateway

    app = Application.objects.select_related("lender", "borrower").get(pk=application_id)
    clerk = Staff.objects.get(pk=actor.staff["id"])
    approver_ids = list(app.approvals.values_list("approver_id", flat=True))
    boss = (
        Staff.objects.filter(lender=app.lender, role__in=["lender_admin", "branch_manager", "credit_committee"])
        .exclude(pk=clerk.pk).exclude(pk__in=approver_ids).first()
        or Staff.objects.filter(lender=app.lender, role__in=["lender_admin", "branch_manager", "credit_committee"])
        .exclude(pk=clerk.pk).first()
    )
    if boss is None:
        boss = Staff.objects.create(lender=app.lender, email=f"authoriser-{str(app.lender_id)[:8]}@test.co",
                                    name="Disbursement Authoriser", role="lender_admin")
    b = app.borrower
    d = disbursements.prepare(clerk, app, {
        "method": channel, "recipient_type": "borrower", "recipient_name": b.full_name,
        "recipient_provider": "mpesa" if channel == "mobile_money" else "Test Bank", "recipient_account": b.phone,
    })
    disbursements.submit(clerk, d)
    disbursements.verify(boss, d, destination_confirmed=True, override_reason="test fixture")
    disbursements.authorise(boss, d)
    disbursements.release(clerk, d, reference=reference)
    d.refresh_from_db()
    if channel == "mobile_money":
        gateway.settle(PaymentTransaction.objects.get(pk=d.payment_id), success=True, receipt=reference)
    else:
        disbursements.confirm(clerk, d, success=True, reference=reference)
    d.refresh_from_db()
    return actor.get(f"/loans/{d.loan_id}").json()
