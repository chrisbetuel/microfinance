from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
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


urlpatterns = [
    path("", index),
    path("health", health),
    path("admin/", admin.site.urls),
    path("api/schema", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("", include("lms.urls")),
]
