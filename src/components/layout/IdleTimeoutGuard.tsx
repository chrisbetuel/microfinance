import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Button } from '../ui/Button'
import { cacheTimeoutMinutes, emitSessionExpired, idleMs, markActivity } from '../../lib/session'

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'pointermove'] as const

export function IdleTimeoutGuard() {
  const timeoutMinutes = useStore((s) => s.lender.sessionTimeoutMinutes)
  const status = useStore((s) => s.status)

  const timeoutMs = Math.max(timeoutMinutes, 1) * 60_000
  // Warn one minute ahead, but never more than half the window — a short
  // timeout still gets a quiet period before the prompt.
  const warnLeadMs = Math.min(60_000, Math.floor(timeoutMs / 2))

  const [warnOpen, setWarnOpen] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(Math.round(warnLeadMs / 1000))
  const warnOpenRef = useRef(false)
  const stayRef = useRef<() => void>(() => {})
  const signOutRef = useRef<() => void>(() => emitSessionExpired('idle'))

  useEffect(() => {
    cacheTimeoutMinutes(timeoutMinutes)
  }, [timeoutMinutes])

  useEffect(() => {
    if (status !== 'ready') {
      setWarnOpen(false)
      warnOpenRef.current = false
      return
    }

    let warnTimer: number
    let expireTimer: number
    let countdown: number
    let lastStamp = 0

    const showWarning = () => {
      warnOpenRef.current = true
      setSecondsLeft(Math.round(warnLeadMs / 1000))
      setWarnOpen(true)
      countdown = window.setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            window.clearInterval(countdown)
            expireNow()
            return 0
          }
          return s - 1
        })
      }, 1000)
    }

    const expireNow = () => {
      warnOpenRef.current = false
      setWarnOpen(false)
      emitSessionExpired('idle')
    }

    const arm = () => {
      window.clearTimeout(warnTimer)
      window.clearTimeout(expireTimer)
      window.clearInterval(countdown)
      warnOpenRef.current = false
      setWarnOpen(false)
      warnTimer = window.setTimeout(showWarning, Math.max(timeoutMs - warnLeadMs, 0))
      expireTimer = window.setTimeout(expireNow, timeoutMs)
    }

    const onActivity = () => {
      if (warnOpenRef.current) return // ignore stray moves while the prompt is up
      const now = Date.now()
      if (now - lastStamp < 2000) return
      lastStamp = now
      markActivity()
      arm()
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (idleMs() >= timeoutMs) expireNow()
      else if (!warnOpenRef.current) arm()
    }

    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, onActivity, { passive: true })
    document.addEventListener('visibilitychange', onVisible)

    markActivity()
    arm()
    // expose to the modal buttons
    stayRef.current = () => {
      markActivity()
      arm()
    }
    signOutRef.current = expireNow

    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearTimeout(warnTimer)
      window.clearTimeout(expireTimer)
      window.clearInterval(countdown)
    }
  }, [status, timeoutMs, warnLeadMs])

  if (!warnOpen) return null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-[var(--shadow-pop)]">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <Clock size={20} />
        </span>
        <h2 className="mt-3 text-base font-semibold text-slate-900">Still there?</h2>
        <p className="mt-1 text-sm text-slate-500">
          You'll be signed out in <span className="font-semibold tabular-nums text-slate-800">{secondsLeft}s</span> due to
          inactivity.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => signOutRef.current()}>
            Sign out
          </Button>
          <Button className="flex-1" onClick={() => stayRef.current()}>
            Stay signed in
          </Button>
        </div>
      </div>
    </div>
  )
}
