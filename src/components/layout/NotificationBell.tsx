import { useMemo, useState } from 'react'
import { Bell, AlertTriangle, Clock, Inbox } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { useStore } from '../../store/useStore'
import { buildAlerts, getSeen, markSeen } from '../../lib/alerts'
import type { Alert } from '../../lib/alerts'

const toneRing: Record<Alert['tone'], string> = {
  red: 'text-accent-600 bg-accent-50',
  amber: 'text-amber-600 bg-amber-50',
  brand: 'text-brand-600 bg-brand-50',
}

export function NotificationBell() {
  const navigate = useNavigate()
  const currentUser = useStore((s) => s.currentUser)
  const lender = useStore((s) => s.lender)
  const applications = useStore((s) => s.applications)
  const loans = useStore((s) => s.loans)
  const notifications = useStore((s) => s.notifications)

  const [open, setOpen] = useState(false)
  const [seenTick, setSeenTick] = useState(0)

  const alerts = useMemo(() => {
    if (!currentUser) return []
    return buildAlerts({
      role: currentUser.role,
      branchId: currentUser.branchId,
      lender,
      applications,
      loans,
      notifications,
    })
  }, [currentUser, lender, applications, loans, notifications])

  const unseenCount = useMemo(() => {
    void seenTick
    const seen = getSeen()
    return alerts.filter((a) => !seen.has(a.key)).length
  }, [alerts, seenTick])

  if (!currentUser) return null

  function toggle() {
    setOpen((v) => {
      const next = !v
      if (next) {
        markSeen(alerts.map((a) => a.key))
        setSeenTick((t) => t + 1)
      }
      return next
    })
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
        aria-label="Notifications"
      >
        <Bell size={16} />
        {unseenCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-600 px-1 text-[10px] font-bold text-white">
            {unseenCount > 9 ? '9+' : unseenCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-pop)]">
            <div className="border-b border-slate-100 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-900">Notifications</p>
            </div>
            <div className="max-h-[22rem] overflow-y-auto">
              {alerts.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <Inbox size={22} className="text-slate-300" />
                  <p className="text-sm text-slate-400">You're all caught up.</p>
                </div>
              )}
              {alerts.map((a) => (
                <button
                  key={a.key}
                  onClick={() => {
                    setOpen(false)
                    navigate(a.href)
                  }}
                  className="flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3 text-left transition-colors last:border-0 hover:bg-slate-50"
                >
                  <span className={clsx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', toneRing[a.tone])}>
                    {a.tone === 'red' ? <AlertTriangle size={14} /> : <Clock size={14} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800">{a.title}</span>
                    <span className="block text-xs text-slate-500">{a.detail}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
