"""Guards that keep every write inside the caller's own lender workspace.

Read paths are scoped by `lender` filters; these check foreign-key ids supplied
in a request body (a branch, an officer) before they are stored.
"""

from lms.exceptions import UnprocessableEntity
from lms.models import Branch, Staff


def ensure_branch(lender, branch_id) -> Branch | None:
    if branch_id is None:
        return None
    branch = Branch.objects.filter(pk=branch_id, lender=lender).first()
    if branch is None:
        raise UnprocessableEntity("Unknown branch")
    return branch


def ensure_staff_member(lender, staff_id) -> Staff | None:
    if staff_id is None:
        return None
    member = Staff.objects.filter(pk=staff_id, lender=lender).first()
    if member is None:
        raise UnprocessableEntity("Unknown staff member")
    return member
