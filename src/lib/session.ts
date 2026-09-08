// Idle-session bookkeeping. Activity is stamped in localStorage so the timeout
// survives reloads and is shared across tabs of the same workspace.

const ACTIVITY_KEY = 'lms-last-activity'
const TIMEOUT_KEY = 'lms-session-timeout-min'

export const SESSION_EXPIRED_EVENT = 'lms:session-expired'
export type SessionExpiredReason = 'idle' | 'token'

export function markActivity(): void {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()))
  } catch {
    /* storage unavailable */
  }
}

export function lastActivity(): number {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || Date.now()
  } catch {
    return Date.now()
  }
}

export function clearActivity(): void {
  try {
    localStorage.removeItem(ACTIVITY_KEY)
  } catch {
    /* ignore */
  }
}

/** Cached so bootstrap can decide before the lender profile has loaded. */
export function cacheTimeoutMinutes(minutes: number): void {
  try {
    localStorage.setItem(TIMEOUT_KEY, String(minutes))
  } catch {
    /* ignore */
  }
}

export function cachedTimeoutMinutes(): number {
  try {
    const n = Number(localStorage.getItem(TIMEOUT_KEY))
    return n >= 1 ? n : 20
  } catch {
    return 20
  }
}

export function idleMs(): number {
  return Date.now() - lastActivity()
}

const REASON_KEY = 'lms-logout-reason'

export function emitSessionExpired(reason: SessionExpiredReason): void {
  try {
    sessionStorage.setItem(REASON_KEY, reason)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { reason } }))
}

/** Read (and clear) why the last session ended, for the login screen to explain. */
export function takeLogoutReason(): SessionExpiredReason | null {
  try {
    const r = sessionStorage.getItem(REASON_KEY)
    sessionStorage.removeItem(REASON_KEY)
    return r === 'idle' || r === 'token' ? r : null
  } catch {
    return null
  }
}
