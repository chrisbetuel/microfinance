import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { takeLogoutReason } from '../lib/session'
import { useStore } from '../store/useStore'
import { api, ApiError, setToken } from '../lib/api'

// This screen is always dark (it doesn't follow the app theme), so it uses
// literal colours — the dark-mode palette remap never touches them.
const input =
  'w-full rounded-full border border-[rgba(255,255,255,0.28)] bg-[rgba(255,255,255,0.04)] px-5 py-3 text-sm text-[#ffffff] outline-none transition placeholder:text-[rgba(255,255,255,0.75)] focus:border-[#2bb594] focus:bg-[rgba(255,255,255,0.07)] focus:ring-2 focus:ring-[rgba(43,181,148,0.35)]'

const REMEMBER_KEY = 'lms-remember-email'

function rememberedEmail(): string {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? ''
  } catch {
    return ''
  }
}

export default function Login() {
  const navigate = useNavigate()
  const login = useStore((s) => s.login)
  const bootstrap = useStore((s) => s.bootstrap)

  const [notice, setNotice] = useState<string | null>(() => {
    const reason = takeLogoutReason()
    if (reason === 'idle') return 'You were signed out after a period of inactivity.'
    if (reason === 'token') return 'Your session ended. Please sign in again.'
    return null
  })

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState(rememberedEmail)
  const [remember, setRemember] = useState(() => rememberedEmail() !== '')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [lenderName, setLenderName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(email, password)
        try {
          if (remember) localStorage.setItem(REMEMBER_KEY, email)
          else localStorage.removeItem(REMEMBER_KEY)
        } catch {
          /* storage unavailable */
        }
      } else {
        const { accessToken } = await api.post<{ accessToken: string }>('/auth/register', {
          lenderName,
          adminName,
          adminEmail: email,
          adminPassword: password,
        })
        setToken(accessToken)
        await bootstrap()
      }
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function switchMode() {
    setMode(mode === 'login' ? 'register' : 'login')
    setError(null)
    setNotice(null)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#010806] px-5 py-12">
      {/* glowing arcs */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-[42%] top-[-28vmin] h-[96vmin] w-[96vmin] rounded-full border-[7px] border-[#2bb594]"
        style={{
          boxShadow:
            '0 0 40px rgba(43,181,148,0.6), inset 0 0 60px rgba(43,181,148,0.3), inset 0 0 220px rgba(10,90,72,0.35)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-40vmin] right-[44%] h-[96vmin] w-[96vmin] rounded-full border-[7px] border-[#2bb594]"
        style={{
          boxShadow:
            '0 0 40px rgba(43,181,148,0.6), inset 0 0 60px rgba(43,181,148,0.3), inset 0 0 220px rgba(10,90,72,0.35)',
        }}
      />
      {/* diagonal light beam */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(135deg, transparent 38%, rgba(40,170,140,0.08) 46%, rgba(90,210,180,0.18) 50%, rgba(40,170,140,0.08) 54%, transparent 62%)',
        }}
      />
      {/* faint grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />

      {/* glass card */}
      <div className="relative w-full max-w-[400px] rounded-2xl border border-[rgba(255,255,255,0.16)] bg-[rgba(6,40,33,0.35)] px-8 py-9 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:px-10">
        <h1 className="text-center text-3xl font-bold tracking-tight text-[#ffffff]">
          {mode === 'login' ? 'Login' : 'Register'}
        </h1>

        {notice && mode === 'login' && (
          <p className="mt-5 rounded-xl border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.10)] px-4 py-2.5 text-center text-xs text-[#fde68a]">
            {notice}
          </p>
        )}

        <form onSubmit={submit} className="mt-7 space-y-4">
          {mode === 'register' && (
            <>
              <input
                required
                placeholder="Organisation name"
                className={input}
                value={lenderName}
                onChange={(e) => setLenderName(e.target.value)}
              />
              <input
                required
                placeholder="Your full name"
                className={input}
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
              />
            </>
          )}

          <input
            required
            type="email"
            autoComplete="username"
            placeholder="Email"
            aria-label="Email"
            className={input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <div className="relative">
            <input
              required
              type={showPw ? 'text' : 'password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="Password"
              aria-label="Password"
              className={`${input} pr-12`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.6)] hover:text-[#ffffff]"
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {mode === 'login' && (
            <div className="flex items-center justify-between px-1 text-xs text-[rgba(255,255,255,0.85)]">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#2bb594]"
                />
                Remember me
              </label>
              <button
                type="button"
                className="hover:text-[#ffffff] hover:underline"
                onClick={() => setNotice('Ask your lender administrator to reset your password.')}
              >
                Forgot password?
              </button>
            </div>
          )}

          {error && (
            <p className="rounded-xl border border-[rgba(248,113,113,0.4)] bg-[rgba(248,113,113,0.12)] px-4 py-2.5 text-center text-sm text-[#fecaca]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-full bg-[#14705d] py-3 text-sm font-semibold text-[#ffffff] shadow-[0_8px_24px_-8px_rgba(43,181,148,0.7)] transition hover:bg-[#0f5b4c] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-[rgba(255,255,255,0.35)] border-t-[#ffffff]" />}
            {busy ? 'Please wait…' : mode === 'login' ? 'Login' : 'Create workspace'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[rgba(255,255,255,0.8)]">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button type="button" onClick={switchMode} className="font-semibold text-[#ffffff] hover:underline">
            {mode === 'login' ? 'Register' : 'Login'}
          </button>
        </p>
      </div>
    </div>
  )
}
