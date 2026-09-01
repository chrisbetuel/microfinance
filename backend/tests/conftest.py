from collections.abc import AsyncGenerator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    async with factory() as session:
        yield session
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class Actor:
    """A logged-in staff member plus a client that sends their bearer token."""

    def __init__(self, client: AsyncClient, token: str, staff: dict):
        self._client = client
        self.token = token
        self.staff = staff

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    async def get(self, url: str, **kw):
        return await self._client.get(url, headers=self.headers, **kw)

    async def post(self, url: str, **kw):
        return await self._client.post(url, headers=self.headers, **kw)

    async def patch(self, url: str, **kw):
        return await self._client.patch(url, headers=self.headers, **kw)

    async def put(self, url: str, **kw):
        return await self._client.put(url, headers=self.headers, **kw)

    async def delete(self, url: str, **kw):
        return await self._client.delete(url, headers=self.headers, **kw)


@pytest_asyncio.fixture
async def admin(client: AsyncClient) -> Actor:
    resp = await client.post(
        "/auth/register",
        json={
            "lenderName": "Test Microfinance",
            "adminName": "Ada Admin",
            "adminEmail": "ada@test.co",
            "adminPassword": "password123",
        },
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["accessToken"]
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    return Actor(client, token, me.json())


@pytest_asyncio.fixture
async def branch(admin: Actor) -> dict:
    resp = await admin.post(
        "/branches",
        json={"name": "Main", "code": "MN", "location": "Dar", "openedOn": "2024-01-01"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def make_staff(admin: Actor, client: AsyncClient, *, role: str, branch_id: str | None = None,
                     email: str | None = None) -> Actor:
    email = email or f"{role}@test.co"
    resp = await admin.post(
        "/staff",
        json={
            "name": role.replace("_", " ").title(),
            "email": email,
            "password": "password123",
            "role": role,
            "branchId": branch_id,
        },
    )
    assert resp.status_code == 201, resp.text
    login = await client.post("/auth/login", json={"email": email, "password": "password123"})
    token = login.json()["accessToken"]
    return Actor(client, token, resp.json())


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
        "approvalLevels": [
            {"minAmount": 0, "maxAmount": None, "requiredRole": "branch_manager"},
        ],
    }
    base.update(overrides)
    return base


def borrower_payload(branch_id: str, **overrides) -> dict:
    base = {
        "type": "individual",
        "branchId": branch_id,
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
