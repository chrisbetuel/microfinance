from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.core.deps import CurrentStaff, DbSession, RequireAdmin
from app.core.security import hash_password
from app.models import Staff
from app.schemas.staff import StaffCreateRequest, StaffResponse, StaffUpdateRequest
from app.services import audit
from app.services.tenancy import ensure_branch

router = APIRouter(prefix="/staff", tags=["staff"])


@router.get("", response_model=list[StaffResponse])
async def list_staff(staff: CurrentStaff, db: DbSession) -> list[Staff]:
    result = await db.scalars(
        select(Staff).where(Staff.lender_id == staff.lender_id).order_by(Staff.name)
    )
    return list(result)


@router.post("", response_model=StaffResponse, status_code=status.HTTP_201_CREATED)
async def create_staff(body: StaffCreateRequest, admin: RequireAdmin, db: DbSession) -> Staff:
    email = body.email.lower()
    if await db.scalar(select(Staff).where(Staff.email == email)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email is already registered")
    await ensure_branch(db, admin.lender_id, body.branch_id)

    member = Staff(
        lender_id=admin.lender_id,
        name=body.name,
        email=email,
        hashed_password=hash_password(body.password),
        role=body.role,
        branch_id=body.branch_id,
        approval_limit=int(body.approval_limit),
        phone=body.phone,
        active=True,
    )
    db.add(member)
    await db.flush()
    await audit.record(
        db, admin, "created", "staff", member.id, f'Staff member "{member.name}" added with role {member.role.value}'
    )
    await db.commit()
    return member


@router.patch("/{staff_id}", response_model=StaffResponse)
async def update_staff(staff_id: str, body: StaffUpdateRequest, admin: RequireAdmin, db: DbSession) -> Staff:
    member = await db.get(Staff, staff_id)
    if member is None or member.lender_id != admin.lender_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Staff member not found")

    patch = body.model_dump(exclude_unset=True)
    if patch.get("branch_id") is not None:
        await ensure_branch(db, admin.lender_id, patch["branch_id"])
    if "approval_limit" in patch and patch["approval_limit"] is not None:
        patch["approval_limit"] = int(patch["approval_limit"])
    for field, value in patch.items():
        setattr(member, field, value)

    await audit.record(db, admin, "updated", "staff", member.id, "Staff account updated")
    await db.commit()
    return member
