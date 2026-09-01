from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentStaff, DbSession, RequireProductManager
from app.models import ApprovalLevel, LoanProduct, ProductFee
from app.schemas.product import (
    LoanProductResponse,
    LoanProductWriteRequest,
    ProductActiveRequest,
)
from app.services import audit

router = APIRouter(prefix="/products", tags=["products"])

_WITH_RELATIONS = (selectinload(LoanProduct.fees), selectinload(LoanProduct.approval_levels))


async def _get(db: DbSession, lender_id: str, product_id: str) -> LoanProduct:
    product = await db.scalar(
        select(LoanProduct).where(LoanProduct.id == product_id).options(*_WITH_RELATIONS)
    )
    if product is None or product.lender_id != lender_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan product not found")
    return product


def _apply_write(product: LoanProduct, body: LoanProductWriteRequest) -> None:
    scalars = body.model_dump(exclude={"fees", "approval_levels"})
    for field, value in scalars.items():
        setattr(product, field, value)
    product.fees = [
        ProductFee(name=f.name, kind=f.kind, value=f.value, timing=f.timing) for f in body.fees
    ]
    product.approval_levels = [
        ApprovalLevel(min_amount=a.min_amount, max_amount=a.max_amount, required_role=a.required_role)
        for a in body.approval_levels
    ]


@router.get("", response_model=list[LoanProductResponse])
async def list_products(staff: CurrentStaff, db: DbSession) -> list[LoanProduct]:
    result = await db.scalars(
        select(LoanProduct)
        .where(LoanProduct.lender_id == staff.lender_id)
        .options(*_WITH_RELATIONS)
        .order_by(LoanProduct.name)
    )
    return list(result)


@router.get("/{product_id}", response_model=LoanProductResponse)
async def get_product(product_id: str, staff: CurrentStaff, db: DbSession) -> LoanProduct:
    return await _get(db, staff.lender_id, product_id)


@router.post("", response_model=LoanProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(
    body: LoanProductWriteRequest, staff: RequireProductManager, db: DbSession
) -> LoanProduct:
    product = LoanProduct(lender_id=staff.lender_id)
    _apply_write(product, body)
    db.add(product)
    await db.flush()
    await audit.record(db, staff, "saved", "product", product.id, f'Loan product "{product.name}" saved')
    await db.commit()
    return await _get(db, staff.lender_id, product.id)


@router.put("/{product_id}", response_model=LoanProductResponse)
async def update_product(
    product_id: str, body: LoanProductWriteRequest, staff: RequireProductManager, db: DbSession
) -> LoanProduct:
    product = await _get(db, staff.lender_id, product_id)
    _apply_write(product, body)
    await audit.record(db, staff, "saved", "product", product.id, f'Loan product "{product.name}" saved')
    await db.commit()
    return await _get(db, staff.lender_id, product_id)


@router.patch("/{product_id}", response_model=LoanProductResponse)
async def set_product_active(
    product_id: str, body: ProductActiveRequest, staff: RequireProductManager, db: DbSession
) -> LoanProduct:
    product = await _get(db, staff.lender_id, product_id)
    product.active = body.active
    await audit.record(db, staff, "updated", "product", product.id, "Product active status toggled")
    await db.commit()
    return await _get(db, staff.lender_id, product_id)
