import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from './store/useStore'
import { AppShell } from './components/layout/AppShell'
import { Toaster } from './components/ui/Toaster'
import { SESSION_EXPIRED_EVENT, clearActivity } from './lib/session'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import LenderSetup from './pages/lender/LenderSetup'
import BorrowersList from './pages/borrowers/BorrowersList'
import BorrowerDetail from './pages/borrowers/BorrowerDetail'
import BorrowerForm from './pages/borrowers/BorrowerForm'
import ProductsList from './pages/products/ProductsList'
import ProductEditor from './pages/products/ProductEditor'
import ApplicationsList from './pages/applications/ApplicationsList'
import ApplicationForm from './pages/applications/ApplicationForm'
import ApplicationDetail from './pages/applications/ApplicationDetail'
import DisbursementQueue from './pages/disbursement/DisbursementQueue'
import LoanDetail from './pages/loans/LoanDetail'
import DisbursementPrepare from './pages/disbursement/DisbursementPrepare'
import DisbursementDetail from './pages/disbursement/DisbursementDetail'
import Repayments from './pages/repayments/Repayments'
import SecurityAudit from './pages/security/SecurityAudit'
import Reports from './pages/reports/Reports'
import CollectionsHub from './pages/collections/CollectionsHub'
import CaseDetail from './pages/collections/CaseDetail'
import Groups from './pages/groups/Groups'
import GroupForm from './pages/groups/GroupForm'
import GroupDetail from './pages/groups/GroupDetail'
import Profile from './pages/Profile'
import Messages from './pages/messages/Messages'
import Payments from './pages/payments/Payments'

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
        Loading your workspace…
      </div>
    </div>
  )
}

export default function App() {
  const status = useStore((s) => s.status)
  const bootstrap = useStore((s) => s.bootstrap)
  const logout = useStore((s) => s.logout)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  useEffect(() => {
    let handled = false
    function onExpired() {
      if (handled) return
      handled = true
      clearActivity()
      logout()
      navigate('/login', { replace: true })
      setTimeout(() => {
        handled = false
      }, 1000)
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [logout, navigate])

  return (
    <>
      <Toaster />
      {status === 'loading' ? (
        <LoadingScreen />
      ) : status === 'anonymous' ? (
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/lender-setup" element={<LenderSetup />} />
            <Route path="/borrowers" element={<BorrowersList />} />
            <Route path="/borrowers/new" element={<BorrowerForm />} />
            <Route path="/borrowers/:id/edit" element={<BorrowerForm />} />
            <Route path="/borrowers/:id" element={<BorrowerDetail />} />
            <Route path="/groups" element={<Groups />} />
            <Route path="/groups/new" element={<GroupForm />} />
            <Route path="/groups/:id" element={<GroupDetail />} />
            <Route path="/groups/:id/edit" element={<GroupForm />} />
            <Route path="/products" element={<ProductsList />} />
            <Route path="/products/new" element={<ProductEditor />} />
            <Route path="/products/:id" element={<ProductEditor />} />
            <Route path="/applications" element={<ApplicationsList />} />
            <Route path="/applications/new" element={<ApplicationForm />} />
            <Route path="/applications/:id/edit" element={<ApplicationForm />} />
            <Route path="/applications/:id" element={<ApplicationDetail />} />
            <Route path="/disbursement" element={<DisbursementQueue />} />
            <Route path="/loans/:id" element={<LoanDetail />} />
            <Route path="/disbursement/prepare/:applicationId" element={<DisbursementPrepare />} />
            <Route path="/disbursement/:id" element={<DisbursementDetail />} />
            <Route path="/disbursement/:id/edit" element={<DisbursementPrepare />} />
            <Route path="/repayments" element={<Repayments />} />
            <Route path="/collections" element={<CollectionsHub />} />
            <Route path="/collections/:id" element={<CaseDetail />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/security" element={<SecurityAudit />} />
          </Route>
        </Routes>
      )}
    </>
  )
}
