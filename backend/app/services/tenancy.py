"""Helpers that keep every write inside the caller's own lender workspace.

Read paths are already scoped by `lender_id` filters; these guard the writes
where a client supplies a foreign-key id in the request body (a branch, an
officer) that must be proven to belong to the same lender before it is stored.
"""

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Branch, Staff


async def ensure_branch(db: AsyncSession, lender_id: str, branch_id: str | None) -> None:
    if branch_id is None:
        return
    branch = await db.get(Branch, branch_id)
    if branch is None or branch.lender_id != lender_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown branch")


async def ensure_staff_member(db: AsyncSession, lender_id: str, staff_id: str | None) -> None:
    if staff_id is None:
        return
    member = await db.get(Staff, staff_id)
    if member is None or member.lender_id != lender_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown staff member")
