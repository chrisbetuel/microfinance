import type { StaffRole } from '../types'

// Which nav sections each role can see, based on their responsibilities in the product doc.
export const NAV_ACCESS: Record<StaffRole, string[]> = {
  platform_admin: ['/', '/lender-setup', '/borrowers', '/products', '/applications', '/disbursement', '/repayments', '/security'],
  lender_admin: ['/', '/lender-setup', '/borrowers', '/products', '/applications', '/disbursement', '/repayments', '/security'],
  branch_manager: ['/', '/borrowers', '/products', '/applications', '/disbursement', '/repayments'],
  loan_officer: ['/', '/borrowers', '/applications', '/repayments'],
  credit_committee: ['/', '/borrowers', '/applications'],
  cashier: ['/', '/borrowers', '/disbursement', '/repayments'],
  auditor: ['/', '/lender-setup', '/borrowers', '/products', '/applications', '/disbursement', '/repayments', '/security'],
}

// The auditor role sees everything but must never be able to create, approve, disburse or reverse anything.
export function canEditData(role: StaffRole): boolean {
  return role !== 'auditor'
}

// Loan products are the lender administrator's rules engine to configure — other roles that can view
// products (e.g. a branch manager checking terms before approving) may not save changes to them.
export function canManageProducts(role: StaffRole): boolean {
  return role === 'lender_admin' || role === 'platform_admin'
}

// Reversing a posted payment and writing off a loan are supervisor-only actions.
export function isSupervisor(role: StaffRole): boolean {
  return role === 'branch_manager' || role === 'lender_admin' || role === 'credit_committee'
}
