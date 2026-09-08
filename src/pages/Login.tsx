import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Mail, Send, Eye, EyeOff, ShieldCheck, TrendingUp, Users } from 'lucide-react'
import { takeLogoutReason } from '../lib/session'
import { useStore } from '../store/useStore'
import { api, ApiError, setToken } from '../lib/api'
import texture from '../assets/login/microfinance-bg.svg'

const label = 'mb-1.5 block text-[13px] font-semibold text-slate-700'
const inputBase =
  'w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/25'
const plainInput = inputBase.replace('pl-10', 'pl-3.5')
const iconCls = 'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400'

const highlights = [
  { icon: ShieldCheck, text: 'Four-eyes approval & disbursement, full audit trail' },
  { icon: TrendingUp, text: 'Automated arrears, penalties and a collections desk' },
  { icon: Users, text: 'Group lending, compulsory savings, seven roles' },
]

export default function Login() {
  const navigate = useNavigate()
  const login = useStore((s) => s.login)
  const bootstrap = useStore((s) => s.bootstrap)

  const [notice] = useState(() => {
    const reason = takeLogoutReason()
    if (reason === 'idle') return 'You were signed out after a period of inactivity.'
    if (reason === 'token') return 'Your session ended. Please sign in again.'
    return null
  })

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
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

  const wordmark = (dark: boolean) => (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-600 text-white shadow-sm">
        <Send size={17} strokeWidth={2.25} />
      </span>
      <span className={`text-xl font-extrabold tracking-tight ${dark ? 'text-white' : 'text-slate-900'}`}>
        Sele<span className="text-accent-500">MF</span>
      </span>
    </div>
  )

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* ── brand panel ─────────────────────────────────────────── */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-800 via-brand-700 to-brand-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <img
          src={texture}
          alt=""
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/2 w-full object-cover object-bottom opacity-[0.14]"
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: 'radial-gradient(90% 60% at 85% 0%, rgba(255,255,255,0.14), transparent 60%)' }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'linear-gradient(160deg, black, transparent 75%)',
            WebkitMaskImage: 'linear-gradient(160deg, black, transparent 75%)',
          }}
        />

        <div className="relative">{wordmark(true)}</div>

        <div className="relative max-w-md">
          <h1 className="text-[34px] font-extrabold leading-[1.15] tracking-tight">
            Your whole loan book, in one calm workspace.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            Borrower files, product rules, approvals, disbursement, repayments and collections — with every action on an
            immutable trail.
          </p>
          <ul className="mt-8 space-y-3.5">
            {highlights.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-white/85">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/12 ring-1 ring-inset ring-white/15">
                  <Icon size={13} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/45">
          © {new Date().getFullYear()} Sele Microfinance · Loan Management System
        </p>
      </aside>

      {/* ── form panel ──────────────────────────────────────────── */}
      <main className="flex flex-col justify-center bg-white px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-[380px]">
          <div className="mb-8 lg:hidden">{wordmark(false)}</div>

          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            {mode === 'login' ? 'Welcome back' : 'Create your workspace'}
          </h2>
          <p className="mt-1.5 text-sm text-slate-500">
            {mode === 'login'
              ? 'Sign in to your microfinance workspace.'
              : 'Set up a private, branded workspace for your institution.'}
          </p>

          {notice && mode === 'login' && (
            <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
              {notice}
            </p>
          )}

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className={label}>Lender / organisation name</label>
                  <input required className={plainInput} value={lenderName} onChange={(e) => setLenderName(e.target.value)} />
                </div>
                <div>
                  <label className={label}>Your full name</label>
                  <input required className={plainInput} value={adminName} onChange={(e) => setAdminName(e.target.value)} />
                </div>
              </>
            )}

            <div>
              <label className={label}>Email address</label>
              <div className="relative">
                <Mail size={16} className={iconCls} />
                <input
                  required
                  type="email"
                  autoComplete="username"
                  placeholder="you@lender.co"
                  className={inputBase}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className={label}>Password</label>
              <div className="relative">
                <Lock size={16} className={iconCls} />
                <input
                  required
                  type={showPw ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="••••••••"
                  className={`${inputBase} pr-10`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 active:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create workspace'}
            </button>
          </form>

          <div className="mt-7 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-slate-300">
            <span className="h-px flex-1 bg-slate-200" />
            {mode === 'login' ? 'New here' : 'Have an account'}
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError(null)
            }}
            className="mt-4 w-full rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            {mode === 'login' ? 'Create a workspace' : 'Sign in instead'}
          </button>

          <p className="mt-8 text-center text-xs text-slate-400">
            For access issues contact your lender administrator
          </p>
        </div>
      </main>
    </div>
  )
}
