import { useStore } from '../store/useStore'
import AdminDashboard from './dashboard/AdminDashboard'
import BranchManagerDashboard from './dashboard/BranchManagerDashboard'
import LoanOfficerDashboard from './dashboard/LoanOfficerDashboard'
import CreditCommitteeDashboard from './dashboard/CreditCommitteeDashboard'
import CashierDashboard from './dashboard/CashierDashboard'
import AuditorDashboard from './dashboard/AuditorDashboard'

export default function Dashboard() {
  const staff = useStore((s) => s.staff)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const currentStaff = staff.find((s) => s.id === currentStaffId)

  if (!currentStaff) return <AdminDashboard />

  switch (currentStaff.role) {
    case 'branch_manager':
      return <BranchManagerDashboard staff={currentStaff} />
    case 'loan_officer':
      return <LoanOfficerDashboard staff={currentStaff} />
    case 'credit_committee':
      return <CreditCommitteeDashboard staff={currentStaff} />
    case 'cashier':
      return <CashierDashboard staff={currentStaff} />
    case 'auditor':
      return <AuditorDashboard />
    case 'lender_admin':
    case 'platform_admin':
    default:
      return <AdminDashboard />
  }
}
