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
cd backend && pytest                # 60 tests, SQLite, no services needed
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

## Features

**Lending core**

- Borrower records (individuals and businesses), editable, with guarantors,
  documents, blacklist and a full history trail
- Configurable loan products — reducing-balance or flat interest, fees,
  penalties with a cap, grace periods, allocation order, approval levels,
  compulsory savings %
- Application intake with affordability / duplicate / blacklist checks and a
  score; approval routing by amount; four-eyes disbursement (approver ≠
  releaser), single or batched with a bank payment-file export
- Repayment posting with bucket-order allocation, reversal, early settlement,
  write-off (blacklists the borrower)

**Operations**

- Daily `age_loans` job: marks instalments overdue, accrues capped penalties,
  maintains days/amount in arrears, closes repaid loans
- Collections workbench — overdue book, contact log, promise-to-pay
  (kept/broken/pending), on-the-spot reminder SMS
- Loan restructuring — reschedule the remaining balance, optionally waive
  penalties (supervisor only)
- Compulsory savings accounts — deducted at disbursement, manual
  deposits/withdrawals, held as partial security
- Solidarity groups — members with roles, joint-liability arrears view, group
  loans
- Cashier cash drawer — daily cash-in/out position and end-of-day count
- Notifications (SMS/email) with a delivery log; in-app notification bell
- Immutable audit trail; CSV exports; per-role reports (PAR, aging, officer /
  branch performance, cash flow)

**App**

- Global command palette (Ctrl/Cmd-K), dark mode, sortable/filterable/paginated
  tables, toast feedback
- Multi-tenant: every query is scoped to the caller's lender
- 7 roles with enforced section access — the auditor can read everything and
  write nothing
