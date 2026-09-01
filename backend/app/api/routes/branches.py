from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import CurrentStaff, DbSession, RequireAdmin
from app.models import Branch
from app.schemas.branch import BranchCreateRequest, BranchResponse
from app.services import audit

router = APIRouter(prefix="/branches", tags=["branches"])


@router.get("", response_model=list[BranchResponse])
async def list_branches(staff: CurrentStaff, db: DbSession) -> list[Branch]:
    result = await db.scalars(
        select(Branch).where(Branch.lender_id == staff.lender_id).order_by(Branch.name)
    )
    return list(result)


@router.post("", response_model=BranchResponse, status_code=status.HTTP_201_CREATED)
async def create_branch(body: BranchCreateRequest, staff: RequireAdmin, db: DbSession) -> Branch:
    branch = Branch(lender_id=staff.lender_id, **body.model_dump())
    db.add(branch)
    await db.flush()
    await audit.record(db, staff, "created", "branch", branch.id, f'Branch "{branch.name}" added')
    await db.commit()
    return branch
