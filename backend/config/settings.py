import os
from datetime import timedelta
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """KEY=VALUE lines from backend/.env (git-ignored). Real environment variables win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(BASE_DIR / ".env")


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


SECRET_KEY = env("SECRET_KEY") or env("JWT_SECRET_KEY", "dev-insecure-secret-change-me-in-production")
DEBUG = env("DEBUG", "1") in ("1", "true", "True", "yes")
ALLOWED_HOSTS = [h.strip() for h in env("ALLOWED_HOSTS", "*").split(",") if h.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "corsheaders",
    "lms",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": dj_database_url.parse(
        env("DATABASE_URL", f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
        conn_max_age=600,
    )
}

AUTH_USER_MODEL = "lms.Staff"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 6}},
]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "en-us"
# Business dates (payment dates, due dates, till days) follow the lender's local day.
TIME_ZONE = env("LMS_TIME_ZONE", "Africa/Dar_es_Salaam")
USE_I18N = False
USE_TZ = True

APPEND_SLASH = False

STATIC_URL = "static/"
STATIC_ROOT = env("STATIC_ROOT", str(BASE_DIR / "staticfiles"))

# Production layout (see deploy/): API under /api, React build served for page routes
LMS_API_PREFIX = env("LMS_API_PREFIX", "")
LMS_SPA_DIR = env("LMS_SPA_DIR", "")
if env("LMS_BEHIND_PROXY", "0") in ("1", "true", "True"):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    USE_X_FORWARDED_HOST = True
    SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = True

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["djangorestframework_camel_case.render.CamelCaseJSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["djangorestframework_camel_case.parser.CamelCaseJSONParser"],
    "COERCE_DECIMAL_TO_STRING": False,
    "UNAUTHENTICATED_USER": None,
    "EXCEPTION_HANDLER": "lms.exceptions.exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Loan Management System API",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "CAMELIZE_NAMES": True,
    "POSTPROCESSING_HOOKS": [
        "drf_spectacular.hooks.postprocess_schema_enums",
        "drf_spectacular.contrib.djangorestframework_camel_case.camelize_serializer_fields",
    ],
}

# Notification delivery: console | logging | noop  (swap for a real gateway in prod)
LMS_NOTIFICATIONS_BACKEND = env("LMS_NOTIFICATIONS_BACKEND", "console")

# Integrations — see lms/integrations/. "console"/"mock" work offline; add a real
# provider class and point these at it to go live.
LMS_SMS_PROVIDER = env("LMS_SMS_PROVIDER", LMS_NOTIFICATIONS_BACKEND)
LMS_SMS_SENDER_ID = env("LMS_SMS_SENDER_ID", "")
LMS_SMS_API_KEY = env("LMS_SMS_API_KEY", "")
# Haflaway / SMTZ gateway (LMS_SMS_PROVIDER=haflaway)
LMS_SMS_BASE_URL = env("LMS_SMS_BASE_URL", "https://messaging-api.haflaway.com/api/v1")
LMS_SMS_WEBHOOK_SECRET = env("LMS_SMS_WEBHOOK_SECRET", "")
# Test mode: when set (comma-separated), the live gateway only texts these numbers.
LMS_SMS_ALLOWED_NUMBERS = env("LMS_SMS_ALLOWED_NUMBERS", "")  # whsec_… from registering the delivery webhook
LMS_PAYMENT_PROVIDER = env("LMS_PAYMENT_PROVIDER", "mock")
LMS_PAYMENT_API_KEY = env("LMS_PAYMENT_API_KEY", "")
LMS_PAYMENT_WEBHOOK_SECRET = env("LMS_PAYMENT_WEBHOOK_SECRET", "dev-webhook-secret")

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(env("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))),
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "TOKEN_TYPE_CLAIM": "token_type",
}

_cors = env("CORS_ORIGINS", "http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176")
CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors.split(",") if o.strip()]
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = list(CORS_ALLOWED_ORIGINS)
