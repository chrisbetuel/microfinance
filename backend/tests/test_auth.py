def test_register_creates_empty_workspace(client):
    resp = client.post(
        "/auth/register",
        {"lenderName": "Amana", "adminName": "Grace", "adminEmail": "grace@amana.co", "adminPassword": "secret123"},
        format="json",
    )
    assert resp.status_code == 201
    token = resp.json()["accessToken"]
    auth = {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    me = client.get("/auth/me", **auth)
    assert me.json()["role"] == "lender_admin"

    # Nothing is seeded — the workspace starts empty.
    for path in ("/branches", "/products", "/borrowers", "/applications", "/loans"):
        assert client.get(path, **auth).json() == [], path

    assert len(client.get("/staff", **auth).json()) == 1


def test_login_rejects_bad_password(client):
    client.post(
        "/auth/register",
        {"lenderName": "A", "adminName": "B", "adminEmail": "b@a.co", "adminPassword": "rightpass1"},
        format="json",
    )
    resp = client.post("/auth/login", {"email": "b@a.co", "password": "wrongpass"}, format="json")
    assert resp.status_code == 401


def test_duplicate_email_rejected(client):
    payload = {"lenderName": "A", "adminName": "B", "adminEmail": "dup@a.co", "adminPassword": "rightpass1"}
    client.post("/auth/register", payload, format="json")
    resp = client.post("/auth/register", {**payload, "lenderName": "C"}, format="json")
    assert resp.status_code == 409


def test_unauthenticated_is_401(client):
    assert client.get("/borrowers").status_code == 401
    assert client.get("/auth/me").status_code == 401


def test_user_can_update_own_profile_but_not_role(client):
    resp = client.post(
        "/auth/register",
        {"lenderName": "P", "adminName": "Old Name", "adminEmail": "p@p.co", "adminPassword": "password1"},
        format="json",
    )
    auth = {"HTTP_AUTHORIZATION": f"Bearer {resp.json()['accessToken']}"}

    patched = client.patch(
        "/auth/me", {"name": "New Name", "phone": "+255700111222", "role": "auditor"}, format="json", **auth
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["name"] == "New Name"
    assert body["phone"] == "+255700111222"
    assert body["role"] == "lender_admin"  # role change ignored
