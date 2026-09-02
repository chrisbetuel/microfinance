"""Role-based access rules, mirroring the frontend's src/lib/permissions.ts.

The frontend hides nav/actions per role for UX; this is the copy that is
actually enforced, since a client can never be trusted.
"""

from rest_framework.permissions import BasePermission

from lms.enums import StaffRole

R = StaffRole

# Which resource sections each role may access at all.
SECTION_ACCESS: dict[str, set[str]] = {
    R.PLATFORM_ADMIN: {"lender", "borrowers", "products", "applications", "disbursement", "repayments", "audit"},
    R.LENDER_ADMIN: {"lender", "borrowers", "products", "applications", "disbursement", "repayments", "audit"},
    R.BRANCH_MANAGER: {"borrowers", "products", "applications", "disbursement", "repayments"},
    R.LOAN_OFFICER: {"borrowers", "applications", "repayments"},
    R.CREDIT_COMMITTEE: {"borrowers", "applications"},
    R.CASHIER: {"borrowers", "disbursement", "repayments"},
    R.AUDITOR: {"lender", "borrowers", "products", "applications", "disbursement", "repayments", "audit"},
}

SUPERVISOR_ROLES = {R.BRANCH_MANAGER, R.LENDER_ADMIN, R.CREDIT_COMMITTEE}


def has_section_access(role: str, section: str) -> bool:
    return section in SECTION_ACCESS.get(role, set())


def can_edit_data(role: str) -> bool:
    """The auditor sees everything but must never create, approve, disburse or reverse anything."""
    return role != R.AUDITOR


def can_manage_products(role: str) -> bool:
    return role in (R.LENDER_ADMIN, R.PLATFORM_ADMIN)


def can_approve_application(role: str, required_approver_role: str) -> bool:
    return role == required_approver_role or role == R.LENDER_ADMIN


def is_supervisor(role: str) -> bool:
    return role in SUPERVISOR_ROLES


# --- DRF permission classes -------------------------------------------------

class IsAdmin(BasePermission):
    message = "Lender administrator access required"

    def has_permission(self, request, view):
        return bool(request.user) and request.user.role in (R.LENDER_ADMIN, R.PLATFORM_ADMIN)


class IsProductManager(BasePermission):
    message = "Only a lender administrator can manage loan products"

    def has_permission(self, request, view):
        return bool(request.user) and can_manage_products(request.user.role)


class SectionEditor(BasePermission):
    """Write endpoints: caller must be an editor (not an auditor) and have their
    role's section access. Read methods are always allowed for any authenticated user."""

    section: str = ""
    message = "Your account cannot make changes here"

    def has_permission(self, request, view):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        role = request.user.role
        if not can_edit_data(role):
            self.message = "Your account has view-only access"
            return False
        if not has_section_access(role, self.section):
            self.message = f"Your role cannot make changes in {self.section}"
            return False
        return True


def section_editor(name: str) -> type[SectionEditor]:
    return type(f"SectionEditor_{name}", (SectionEditor,), {"section": name})


class HasSection(BasePermission):
    """Gates every method (read included) on the caller's role section access."""

    section: str = ""

    def has_permission(self, request, view):
        return bool(request.user) and has_section_access(request.user.role, self.section)


def has_section(name: str) -> type[HasSection]:
    return type(f"HasSection_{name}", (HasSection,), {"section": name})
