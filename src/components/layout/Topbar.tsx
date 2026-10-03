import { LogOut, Menu, MessageSquare, Search, Sun, Moon, Monitor, UserCircle, Settings } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { STAFF_ROLE_LABELS } from '../../types'
import { initials } from '../../lib/format'
import { NotificationBell } from './NotificationBell'
import { useMobileNav } from './Sidebar'
import { openCommandPalette } from '../CommandPalette'
import { useTheme, type ThemeChoice } from '../../lib/theme'

const themeOrder: ThemeChoice[] = ['light', 'dark', 'system']
const themeIcon = { light: Sun, dark: Moon, system: Monitor }

const iconBtn =
  'flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800'

function ThemeToggle() {
  const choice = useTheme((s) => s.choice)
  const setChoice = useTheme((s) => s.setChoice)
  const Icon = themeIcon[choice]
  return (
    <button
      onClick={() => setChoice(themeOrder[(themeOrder.indexOf(choice) + 1) % themeOrder.length])}
      className={iconBtn}
      title={`Theme: ${choice} — click to change`}
      aria-label={`Theme: ${choice}`}
    >
      <Icon size={17} />
    </button>
  )
}

export function Topbar() {
  const currentUser = useStore((s) => s.currentUser)
  const logout = useStore((s) => s.logout)
  const lender = useStore((s) => s.lender)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const openNav = useMobileNav((s) => s.setOpen)

  if (!currentUser) return null

  return (
    <header className="relative z-30 flex items-center justify-between gap-2 bg-white px-3 py-2.5 sm:px-7 sm:py-3.5">
      <div className="flex min-w-0 items-center gap-1">
        <button onClick={() => openNav(true)} className={`${iconBtn} lg:hidden`} aria-label="Open menu">
          <Menu size={20} />
        </button>
        {/* who's signed in */}
        <button onClick={() => navigate('/profile')} className="flex min-w-0 items-center gap-3 text-left">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
            {initials(currentUser.name)}
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-[15px] font-semibold leading-tight text-slate-900">{currentUser.name}</span>
            <span className="block text-[11px] text-slate-400">{STAFF_ROLE_LABELS[currentUser.role]}</span>
          </span>
        </button>
      </div>

      <div className="flex flex-shrink-0 items-center gap-0.5 sm:gap-1.5">
        <button onClick={openCommandPalette} className={`${iconBtn} md:hidden`} aria-label="Search">
          <Search size={17} />
        </button>
        <button
          onClick={openCommandPalette}
          className="mr-2 hidden w-56 items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-400 transition-colors hover:border-slate-300 md:flex"
        >
          <Search size={15} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">Ctrl K</kbd>
        </button>

        <span
          className="mr-1 hidden items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 lg:flex"
          title="SMS credits remaining"
        >
          <MessageSquare size={13} />
          <span className="tabular-nums font-semibold">{lender.smsBalance.toLocaleString()}</span>
        </span>

        <ThemeToggle />
        <NotificationBell />

        <div className="relative">
          <button onClick={() => setOpen((v) => !v)} className={iconBtn} aria-label="Account menu">
            <Settings size={17} />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[var(--shadow-pop)]">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-slate-800">{currentUser.name}</p>
                  <p className="text-xs text-slate-400">{currentUser.email}</p>
                </div>
                <div className="border-t border-slate-100" />
                <button
                  onClick={() => {
                    setOpen(false)
                    navigate('/profile')
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <UserCircle size={14} className="text-slate-400" />
                  My profile
                </button>
                <button
                  onClick={() => {
                    setOpen(false)
                    logout()
                    navigate('/login', { replace: true })
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <LogOut size={14} className="text-slate-400" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
