from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path


def health(_request):
    return JsonResponse({"status": "ok"})


def index(_request):
    return JsonResponse(
        {
            "service": "Loan Management System API",
            "status": "ok",
            "docs": "See backend/README.md — this is a JSON API consumed by the React frontend.",
            "auth": {"register": "POST /auth/register", "login": "POST /auth/login", "me": "GET /auth/me"},
            "resources": [
                "/lender", "/branches", "/staff", "/holidays", "/borrowers", "/products",
                "/applications", "/loans", "/repayments", "/audit",
            ],
            "health": "/health",
            "admin": "/admin/",
        }
    )


urlpatterns = [
    path("", index),
    path("health", health),
    path("admin/", admin.site.urls),
    path("", include("lms.urls")),
]
