import { NavLink, useNavigate } from 'react-router-dom'
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
  UsersRound,
  MessageSquare,
  Smartphone,
  Settings,
  UserCircle,
  LogOut,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { NAV_ACCESS } from '../../lib/permissions'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/borrowers', label: 'Borrowers', icon: Users },
  { to: '/groups', label: 'Groups', icon: UsersRound },
  { to: '/applications', label: 'Applications', icon: FileCheck2 },
  { to: '/disbursement', label: 'Disbursement', icon: Landmark },
  { to: '/repayments', label: 'Repayments', icon: Wallet },
  { to: '/collections', label: 'Collections', icon: PhoneCall },
  { to: '/payments', label: 'Online payments', icon: Smartphone },
  { to: '/messages', label: 'Messages', icon: MessageSquare },
  { to: '/products', label: 'Loan Products', icon: SlidersHorizontal },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/security', label: 'Security & Audit', icon: ShieldCheck },
]

const linkCls = (isActive: boolean) =>
  clsx(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors',
    isActive ? 'bg-white/12 text-white' : 'text-white/65 hover:bg-white/6 hover:text-white',
  )

export function Sidebar() {
  const lender = useStore((s) => s.lender)
  const currentUser = useStore((s) => s.currentUser)
  const logout = useStore((s) => s.logout)
  const navigate = useNavigate()

  const allowed = currentUser ? NAV_ACCESS[currentUser.role] : []
  const visibleItems = navItems.filter((item) => allowed.includes(item.to))

  return (
    <aside className="flex h-full w-60 flex-shrink-0 flex-col bg-[#0c3d34] text-white">
      <div className="flex items-center gap-2.5 px-5 pb-6 pt-6">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-400 text-[13px] font-bold text-white">
          {lender.logoInitials || 'S'}
        </span>
        <p className="truncate text-[15px] font-semibold tracking-tight">{lender.name}</p>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        {visibleItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => linkCls(isActive)}>
            <item.icon size={17} strokeWidth={1.9} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-1 border-t border-white/10 px-3 py-4">
        {allowed.includes('/lender-setup') && (
          <NavLink to="/lender-setup" className={({ isActive }) => linkCls(isActive)}>
            <Building2 size={17} strokeWidth={1.9} />
            Settings
          </NavLink>
        )}
        <NavLink to="/profile" className={({ isActive }) => linkCls(isActive)}>
          {allowed.includes('/lender-setup') ? <UserCircle size={17} strokeWidth={1.9} /> : <Settings size={17} strokeWidth={1.9} />}
          My profile
        </NavLink>
        <button
          onClick={() => {
            logout()
            navigate('/login', { replace: true })
          }}
          className={clsx(linkCls(false), 'w-full')}
        >
          <LogOut size={17} strokeWidth={1.9} />
          Logout
        </button>
      </div>
    </aside>
  )
}
