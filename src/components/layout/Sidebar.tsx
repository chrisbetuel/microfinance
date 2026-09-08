import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import {
  LayoutDashboard,
  Building2,
  Users,
  SlidersHorizontal,
  FileCheck2,
  Landmark,
  Wallet,
  ShieldCheck,
  BarChart3,
  PhoneCall,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { shade } from '../../lib/color'
import { NAV_ACCESS } from '../../lib/permissions'
import { STAFF_ROLE_LABELS } from '../../types'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/lender-setup', label: 'Lender Setup', icon: Building2 },
  { to: '/borrowers', label: 'Borrowers', icon: Users },
  { to: '/products', label: 'Loan Products', icon: SlidersHorizontal },
  { to: '/applications', label: 'Applications & Approvals', icon: FileCheck2 },
  { to: '/disbursement', label: 'Disbursement', icon: Landmark },
  { to: '/repayments', label: 'Repayments', icon: Wallet },
  { to: '/collections', label: 'Collections', icon: PhoneCall },
  { to: '/reports', label: 'Reports & Analytics', icon: BarChart3 },
  { to: '/security', label: 'Security & Audit', icon: ShieldCheck },
]

export function Sidebar() {
  const lender = useStore((s) => s.lender)
  const currentUser = useStore((s) => s.currentUser)

  const allowed = currentUser ? NAV_ACCESS[currentUser.role] : []
  const visibleItems = navItems.filter((item) => allowed.includes(item.to))

  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-3 px-5 py-[18px]">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm ring-1 ring-inset ring-white/20"
          style={{ background: `linear-gradient(135deg, ${lender.brandColor}, ${shade(lender.brandColor, -22)})` }}
        >
          {lender.logoInitials}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-slate-900">{lender.name}</p>
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Loan Management</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        <p className="px-3 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300">Menu</p>
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              clsx(
                'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                'before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-brand-600 before:transition-transform',
                isActive
                  ? 'bg-brand-50 text-brand-700 before:scale-y-100'
                  : 'text-slate-600 before:scale-y-0 hover:bg-slate-50 hover:text-slate-900',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  size={17}
                  strokeWidth={2.1}
                  className={isActive ? 'text-brand-600' : 'text-slate-400'}
                />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="m-3 rounded-xl bg-slate-50 px-3.5 py-3 ring-1 ring-inset ring-slate-200/70">
        <p className="text-xs font-medium text-slate-500">
          Signed in as <span className="font-semibold text-slate-800">{currentUser ? STAFF_ROLE_LABELS[currentUser.role] : ''}</span>
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">The menu reflects this role's access.</p>
      </div>
    </aside>
  )
}
