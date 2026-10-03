"""Production layout: API under /api/, the React app's index.html for page routes."""

import importlib

import pytest
from django.urls import clear_url_caches


@pytest.fixture
def production_urls(settings, tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><div id=root></div>")
    settings.LMS_API_PREFIX = "api"
    settings.LMS_SPA_DIR = str(tmp_path)
    import config.urls

    importlib.reload(config.urls)
    clear_url_caches()
    yield
    settings.LMS_API_PREFIX = ""
    settings.LMS_SPA_DIR = ""
    importlib.reload(config.urls)
    clear_url_caches()


def test_api_moves_under_prefix_and_pages_get_the_app(production_urls, client):
    assert client.get("/api/health").json() == {"status": "ok"}
    login = client.post("/api/auth/login", {"email": "x@y.z", "password": "nope"}, content_type="application/json")
    assert login.status_code in (400, 401) and login["Content-Type"].startswith("application/json")  # the API answered
    for page in ("/", "/borrowers", "/loans/123", "/portal"):
        r = client.get(page)
        assert r.status_code == 200 and b"id=root" in b"".join(r.streaming_content), page
    assert client.get("/borrowers/").status_code == 200  # page route, not the API
