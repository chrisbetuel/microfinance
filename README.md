# Loan Management System

A multi-tenant loan management system for microfinance lenders: borrower records,
a configurable loan-product rules engine, application intake with scoring and
approval routing, four-eyes disbursement, repayment allocation, and an immutable
audit trail.

- **Frontend** — React + TypeScript + Vite (`src/`)
- **Backend** — Django REST Framework + PostgreSQL (`backend/`)

The two halves share one domain model. The backend serialises camelCase on the
wire so the API maps directly onto the types in `src/types`.

## Quick start (after cloning)

**Requirements:** Docker + Docker Compose, and Node 20+.

### 1. Backend

```bash
cd backend
docker compose up --build
```

This starts Postgres and the API on **http://localhost:8000**, runs migrations,
and seeds a demo workspace ("Sele Microfinance") the first time. Leave it running.

> Port 8000 taken? `API_PORT=8001 docker compose up` (then set `VITE_API_PROXY`
> below to match).

### 2. Frontend (in a second terminal)

```bash
npm install
npm run dev
```

Opens **http://localhost:5173** and proxies `/api` to the backend on :8000.
If you changed the API port, create a `.env` in the repo root:

```
VITE_API_PROXY=http://localhost:8001
```

### 3. Sign in

The demo seed created these accounts — all with password **`password123`**:

| Email | Role |
|---|---|
| `admin@sele.co` | Lender Administrator |
| `elias@sele.co` | Branch Manager |
| `fatuma@sele.co` | Loan Officer |
| `neema@sele.co` | Credit Committee |
| `rehema@sele.co` | Cashier |
| `peter@sele.co` | Auditor |

Or click **Create a workspace** on the login screen to start a fresh, empty
lender workspace of your own.

## Running without Docker

Backend needs Python 3.12:

```bash
cd backend
pip install -r requirements-dev.txt
python manage.py migrate
python manage.py seed_demo          # optional demo data
python manage.py runserver          # http://localhost:8000
```

It uses a local SQLite file unless `DATABASE_URL` is set (see `.env.example`).

## Tests & tooling

```bash
cd backend && pytest                # 35 tests, SQLite, no services needed
npm run build                       # typecheck + build the frontend
```

- **API docs (Swagger):** http://localhost:8000/api/docs
- **Django admin:** http://localhost:8000/admin/ (`python manage.py createsuperuser`)
- **Daily jobs** (run from cron): `python manage.py age_loans` accrues penalties
  and refreshes arrears; `python manage.py send_reminders` texts overdue borrowers.

## Roles

`platform_admin`, `lender_admin`, `branch_manager`, `loan_officer`,
`credit_committee`, `cashier`, `auditor`. The backend enforces:

- the auditor may read everything and write nothing;
- only a lender administrator manages loan products;
- an application's creator can never approve it, and its approver can never
  release the funds;
- only a supervisor can reverse a posted repayment;
- approval limits are enforced — an approver cannot approve above their limit.

## New Features

- **Borrower editing** — edit borrower profiles after registration
- **Approval limit enforcement** — system enforces staff approval limits
- **Overpayment tracking** — excess payments are tracked as credit
- **Document uploads** — attach documents to borrower files
- **CSV export** — download borrowers, loans and repayments as CSV
- **Password change** — staff can change their own password
- **Step-up checking** — borrowers with clean history qualify for higher limits
- **Security enforcement** — products require guarantors/collateral at intake
