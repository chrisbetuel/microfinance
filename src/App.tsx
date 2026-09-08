import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useStore } from './store/useStore'
import { AppShell } from './components/layout/AppShell'
import { Toaster } from './components/ui/Toaster'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import LenderSetup from './pages/lender/LenderSetup'
import BorrowersList from './pages/borrowers/BorrowersList'
import BorrowerDetail from './pages/borrowers/BorrowerDetail'
import ProductsList from './pages/products/ProductsList'
import ProductEditor from './pages/products/ProductEditor'
import ApplicationsList from './pages/applications/ApplicationsList'
import ApplicationNew from './pages/applications/ApplicationNew'
import ApplicationDetail from './pages/applications/ApplicationDetail'
import DisbursementQueue from './pages/disbursement/DisbursementQueue'
import Repayments from './pages/repayments/Repayments'
import SecurityAudit from './pages/security/SecurityAudit'
import Reports from './pages/reports/Reports'

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
  const location = useLocation()

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

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
            <Route path="/lender-setup" element={<LenderSetup />} />
            <Route path="/borrowers" element={<BorrowersList />} />
            <Route path="/borrowers/:id" element={<BorrowerDetail />} />
            <Route path="/products" element={<ProductsList />} />
            <Route path="/products/new" element={<ProductEditor />} />
            <Route path="/products/:id" element={<ProductEditor />} />
            <Route path="/applications" element={<ApplicationsList />} />
            <Route path="/applications/new" element={<ApplicationNew />} />
            <Route path="/applications/:id" element={<ApplicationDetail />} />
            <Route path="/disbursement" element={<DisbursementQueue />} />
            <Route path="/repayments" element={<Repayments />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/security" element={<SecurityAudit />} />
          </Route>
        </Routes>
      )}
    </>
  )
}
