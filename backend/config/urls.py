from pathlib import Path

from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404, JsonResponse
from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def health(_request):
    return JsonResponse({"status": "ok"})


def index(_request):
    return JsonResponse(
        {
            "service": "Loan Management System API",
            "status": "ok",
            "docs": "/api/docs",
            "auth": {"register": "POST /auth/register", "login": "POST /auth/login", "me": "GET /auth/me"},
            "resources": [
                "/lender", "/branches", "/staff", "/holidays", "/borrowers", "/products",
                "/applications", "/loans", "/repayments", "/audit", "/notifications",
            ],
            "health": "/health",
            "admin": "/admin/",
        }
    )


def spa_index(_request):
    """Production: page routes (/, /borrowers/…, /portal) get the React app's index.html."""
    index_file = Path(settings.LMS_SPA_DIR) / "index.html"
    if not index_file.is_file():
        raise Http404("Frontend build not found")
    response = FileResponse(index_file.open("rb"), content_type="text/html")
    response["Cache-Control"] = "no-cache"
    return response


# Locally the API is served at the root. In production (LMS_API_PREFIX=api) it moves
# under /api/ so the same domain can serve the React app for every other path.
PREFIX = f"{settings.LMS_API_PREFIX.strip('/')}/" if settings.LMS_API_PREFIX.strip("/") else ""

urlpatterns = [
    path(f"{PREFIX}health", health),
    path("admin/", admin.site.urls),
    path("api/schema", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path(PREFIX, include("lms.urls")),
]
if not PREFIX:
    urlpatterns.insert(0, path("", index))
if settings.LMS_SPA_DIR:
    urlpatterns.append(re_path(r"^(?!api/|admin/|static/).*$", spa_index))
