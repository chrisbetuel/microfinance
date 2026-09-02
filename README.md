# Loan Management System

A multi-tenant loan management system for microfinance lenders: borrower records,
a configurable loan-product rules engine, application intake with scoring and
approval routing, four-eyes disbursement, repayment allocation, and an immutable
audit trail.

- **Frontend** — React + TypeScript + Vite (`src/`)
- **Backend** — Django REST Framework + PostgreSQL (`backend/`)

The two halves share one domain model. The backend serialises camelCase on the
wire so the API maps directly onto the types in `src/types`.

## Running it

### Backend

```bash
cd backend
cp .env.example .env
docker compose up --build      # Postgres + API on http://localhost:8000
```

`docker compose up` runs migrations before starting the API. To run
against a local Python instead:

```bash
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Tests (SQLite, no database needed):

```bash
cd backend && pytest
```

### Frontend

```bash
npm install
npm run dev                    # http://localhost:5173, proxies /api -> :8000
```

The dev port and API location can be overridden in `.env` (`FRONTEND_PORT`,
`VITE_API_BASE_URL`) — needed on machines where 5173 / 8000 are already taken.
`strictPort` is on, so a clash fails loudly instead of silently moving to
another port.

Open the app, choose **Register one** to create a lender workspace and its first
administrator. The workspace starts empty — add branches, staff, products and
borrowers from there. There is no seed data on either side.

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
