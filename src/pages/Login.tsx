import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Mail, Send, Eye, EyeOff, Check } from 'lucide-react'
import { takeLogoutReason } from '../lib/session'
import { useStore } from '../store/useStore'
import { api, ApiError, setToken } from '../lib/api'
import background from '../assets/login/login-bg.svg'

const label = 'mb-1.5 block text-[13px] font-semibold text-slate-700'
const inputBase =
  'w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/25'
const plainInput = inputBase.replace('pl-10', 'pl-3.5')
const iconCls = 'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400'

const points = [
  'Applications, approvals & four-eyes disbursement',
  'Automated arrears, penalties & a collections desk',
  'Group lending, compulsory savings & a full audit trail',
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

  return (
    <div className="relative min-h-screen overflow-hidden">
      <img src={background} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover object-center" />
      {/* literal rgba so the theme's palette remap never touches the scrim */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(3,7,18,0.80),rgba(3,7,18,0.34)_45%,transparent_80%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(3,7,18,0.45),transparent_55%)]" />

      <div className="relative z-10 flex min-h-screen flex-col px-6 py-8 sm:px-10 lg:px-[8%] lg:py-12">
        {/* header */}
        <header className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-600 text-white shadow-lg">
            <Send size={17} strokeWidth={2.25} />
          </span>
          <span className="text-lg font-extrabold tracking-tight text-white">
            Sele<span className="text-accent-400">MF</span>
          </span>
        </header>

        {/* body — hero + card as one centred stack */}
        <div className="flex flex-1 items-center py-10">
          <div className="w-full max-w-[430px]">
            <div className="mb-9 hidden lg:block">
              <h1 className="text-[34px] font-black leading-[1.15] tracking-tight text-balance text-white">
                Every loan, every payment,
                <br />
                one calm workspace.
              </h1>
              <ul className="mt-7 space-y-2.5">
                {points.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-sm text-white/80">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/15">
                      <Check size={11} strokeWidth={3} />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl bg-white p-7 shadow-[0_30px_80px_-24px_rgba(2,6,23,0.7)] ring-1 ring-black/5 sm:p-8">
              <h2 className="text-xl font-bold tracking-tight text-slate-900">
                {mode === 'login' ? 'Welcome back' : 'Create your workspace'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {mode === 'login'
                  ? 'Sign in to your microfinance workspace.'
                  : 'A private, branded workspace for your institution.'}
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
                      <input
                        required
                        className={plainInput}
                        value={lenderName}
                        onChange={(e) => setLenderName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={label}>Your full name</label>
                      <input
                        required
                        className={plainInput}
                        value={adminName}
                        onChange={(e) => setAdminName(e.target.value)}
                      />
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
                  className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 active:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                  {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create workspace'}
                </button>
              </form>

              <div className="mt-6 border-t border-slate-100 pt-4 text-center text-sm text-slate-500">
                {mode === 'login' ? 'New to the platform? ' : 'Already have an account? '}
                <button
                  type="button"
                  className="font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                  onClick={() => {
                    setMode(mode === 'login' ? 'register' : 'login')
                    setError(null)
                  }}
                >
                  {mode === 'login' ? 'Create a workspace' : 'Sign in'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* footer */}
        <footer className="text-xs text-white/50">
          © {new Date().getFullYear()} Sele Microfinance — Loan Management System
        </footer>
      </div>
    </div>
  )
}
