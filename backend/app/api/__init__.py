from fastapi import APIRouter

from app.api.routes import (
    applications,
    audit,
    auth,
    borrowers,
    branches,
    holidays,
    lender,
    loans,
    products,
    repayments,
    staff,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(lender.router)
api_router.include_router(branches.router)
api_router.include_router(staff.router)
api_router.include_router(holidays.router)
api_router.include_router(borrowers.router)
api_router.include_router(products.router)
api_router.include_router(applications.router)
api_router.include_router(loans.router)
api_router.include_router(repayments.router)
api_router.include_router(audit.router)
