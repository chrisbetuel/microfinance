from httpx import AsyncClient


async def test_register_creates_empty_workspace(client: AsyncClient):
    resp = await client.post(
        "/auth/register",
        json={
            "lenderName": "Amana",
            "adminName": "Grace",
            "adminEmail": "grace@amana.co",
            "adminPassword": "secret123",
        },
    )
    assert resp.status_code == 201
    token = resp.json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    me = await client.get("/auth/me", headers=headers)
    assert me.json()["role"] == "lender_admin"

    # Nothing is seeded — the workspace starts empty.
    for path in ("/branches", "/products", "/borrowers", "/applications", "/loans"):
        listing = await client.get(path, headers=headers)
        assert listing.json() == [], path

    staff = await client.get("/staff", headers=headers)
    assert len(staff.json()) == 1


async def test_login_rejects_bad_password(client: AsyncClient):
    await client.post(
        "/auth/register",
        json={"lenderName": "A", "adminName": "B", "adminEmail": "b@a.co", "adminPassword": "rightpass1"},
    )
    resp = await client.post("/auth/login", json={"email": "b@a.co", "password": "wrongpass"})
    assert resp.status_code == 401


async def test_duplicate_email_rejected(client: AsyncClient):
    payload = {"lenderName": "A", "adminName": "B", "adminEmail": "dup@a.co", "adminPassword": "rightpass1"}
    await client.post("/auth/register", json=payload)
    resp = await client.post("/auth/register", json={**payload, "lenderName": "C"})
    assert resp.status_code == 409


async def test_unauthenticated_is_401(client: AsyncClient):
    assert (await client.get("/borrowers")).status_code == 401
    assert (await client.get("/auth/me")).status_code == 401
