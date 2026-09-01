"""Role-based access rules, mirroring the frontend's src/lib/permissions.ts.

Kept in sync deliberately: the frontend hides nav/actions per role for UX, but
this is the copy that actually gets enforced, since a client can never be trusted.
"""

from app.models.enums import StaffRole

# Which resource sections each role may access at all (independent of read vs write).
SECTION_ACCESS: dict[StaffRole, set[str]] = {
    StaffRole.platform_admin: {"lender", "borrowers", "products", "applications", "disbursement", "repayments", "audit"},
    StaffRole.lender_admin: {"lender", "borrowers", "products", "applications", "disbursement", "repayments", "audit"},
    StaffRole.branch_manager: {"borrowers", "products", "applications", "disbursement", "repayments"},
    StaffRole.loan_officer: {"borrowers", "applications", "repayments"},
    StaffRole.credit_committee: {"borrowers", "applications"},
    StaffRole.cashier: {"borrowers", "disbursement", "repayments"},
    StaffRole.auditor: {"lender", "borrowers", "products", "applications", "disbursement", "repayments", "audit"},
}

SUPERVISOR_ROLES = {StaffRole.branch_manager, StaffRole.lender_admin, StaffRole.credit_committee}


def has_section_access(role: StaffRole, section: str) -> bool:
    return section in SECTION_ACCESS.get(role, set())


def can_edit_data(role: StaffRole) -> bool:
    """The auditor role sees everything but must never create, approve, disburse or reverse anything."""
    return role != StaffRole.auditor


def can_manage_products(role: StaffRole) -> bool:
    """Loan products are the lender administrator's rules engine to configure."""
    return role in (StaffRole.lender_admin, StaffRole.platform_admin)


def can_approve_application(role: StaffRole, required_approver_role: StaffRole) -> bool:
    return role == required_approver_role or role == StaffRole.lender_admin


def is_supervisor(role: StaffRole) -> bool:
    return role in SUPERVISOR_ROLES
