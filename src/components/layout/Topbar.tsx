import { LogOut, MessageSquare, ChevronDown, Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { STAFF_ROLE_LABELS } from '../../types'
import { initials } from '../../lib/format'
import { NotificationBell } from './NotificationBell'
import { openCommandPalette } from '../CommandPalette'

export function Topbar() {
  const currentUser = useStore((s) => s.currentUser)
  const logout = useStore((s) => s.logout)
  const lender = useStore((s) => s.lender)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  if (!currentUser) return null

  return (
    <header className="relative z-30 flex items-center justify-between border-b border-slate-200 bg-white/80 px-6 py-3 backdrop-blur-sm">
      <button
        onClick={openCommandPalette}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-400 transition-colors hover:border-slate-300 hover:bg-white"
      >
        <Search size={14} />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="ml-2 hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:inline">
          Ctrl K
        </kbd>
      </button>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-100 sm:flex">
          <MessageSquare size={13} />
          SMS balance: <span className="tabular-nums font-semibold">{lender.smsBalance.toLocaleString()}</span>
        </div>

        <NotificationBell />

        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-2.5 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-semibold text-white shadow-sm">
              {initials(currentUser.name)}
            </span>
            <span className="text-left">
              <span className="block text-xs font-semibold text-slate-900">{currentUser.name}</span>
              <span className="block text-[11px] text-slate-400">{STAFF_ROLE_LABELS[currentUser.role]}</span>
            </span>
            <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
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
                    logout()
                    navigate('/login', { replace: true })
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
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
