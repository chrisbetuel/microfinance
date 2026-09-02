# Loan Management System — API

Django 5 + Django REST Framework. Multi-tenant: every row belongs to a `Lender`
and `Staff` is the auth user model.

## Layout

```
config/            project (settings, urls, wsgi/asgi)
lms/
  models.py        domain models (17 tables, UUID primary keys)
  enums.py         TextChoices
  serializers.py   DRF serializers (snake_case; the wire is camelCase)
  views.py         APIViews, one per resource
  permissions.py   role rules + DRF permission classes
  exceptions.py    409 / 422 exceptions + a handler that returns {"detail": ...}
  tenancy.py       foreign-key ownership guards for writes
  services/        loan_math, application scoring, disbursement & repayment
  admin.py         Django admin registration
  migrations/
tests/             pytest-django
```

## Run

```bash
pip install -r requirements-dev.txt
cp .env.example .env            # optional; defaults to a local SQLite file
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

or `docker compose up --build` (Postgres + the API).

## Test

```bash
pytest                          # SQLite, no services needed
```

## Notes

- **Wire format** is camelCase in and out (`djangorestframework-camel-case`), so
  request/response bodies map directly onto the frontend types in `../src/types`.
- **Auth** is a JWT bearer token from `POST /auth/login` or `/auth/register`
  (`djangorestframework-simplejwt`); `GET /auth/me` returns the current staff.
- **RBAC**: the auditor role is read-only; only a lender admin manages products;
  an application's creator can't approve it and its approver can't disburse it;
  only a supervisor reverses a repayment. All enforced in `permissions.py` and
  the view methods.
- URLs have **no trailing slash** (`APPEND_SLASH = False`) to match the client.
- `python manage.py createsuperuser` creates a platform-admin under a dedicated
  "Platform" lender so the admin site at `/admin/` is usable.
