import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, TrendingUp, Users } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Button } from '../components/ui/Button'
import { Field, inputClass } from '../components/ui/Field'
import { api, ApiError, setToken } from '../lib/api'
import loginBg from '../assets/login-bg.jpg'

const highlights = [
  { icon: TrendingUp, text: 'Purpose-built for microfinance lending' },
  { icon: ShieldCheck, text: 'Four-eyes approval, disbursement and a full audit trail' },
  { icon: Users, text: 'One borrower, one file — individuals and businesses' },
]

export default function Login() {
  const navigate = useNavigate()
  const login = useStore((s) => s.login)
  const bootstrap = useStore((s) => s.bootstrap)

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      {/* full-bleed imagery + gradient */}
      <img src={loginBg} alt="" className="absolute inset-0 h-full w-full object-cover object-center" loading="eager" />
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/85 via-indigo-950/75 to-slate-950/95" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(99,102,241,0.4),transparent_55%)]" />

      {/* content starts at the top */}
      <div className="relative flex min-h-screen flex-col items-center px-4 pb-16 pt-10 sm:pt-14">
        <div className="mb-7 flex items-center gap-3 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-sm font-bold ring-1 ring-inset ring-white/20 backdrop-blur">
            LMS
          </div>
          <span className="text-sm font-semibold tracking-tight text-white/90">Loan Management System</span>
        </div>

        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white p-6 shadow-[0_30px_60px_-15px_rgba(2,6,23,0.6)] sm:p-7">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
            {mode === 'login' ? 'Welcome back' : 'Create your workspace'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === 'login'
              ? 'Sign in to continue to your lender workspace.'
              : 'Set up a new, private lender workspace in seconds.'}
          </p>

          <form onSubmit={submit} className="mt-5 space-y-4">
            {mode === 'register' && (
              <>
                <Field label="Lender / organisation name">
                  <input required className={inputClass} value={lenderName} onChange={(e) => setLenderName(e.target.value)} />
                </Field>
                <Field label="Your full name">
                  <input required className={inputClass} value={adminName} onChange={(e) => setAdminName(e.target.value)} />
                </Field>
              </>
            )}
            <Field label="Email address">
              <input
                required
                type="email"
                autoComplete="username"
                placeholder="you@lender.co"
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <input
                required
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="••••••••"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <Button type="submit" className="w-full py-2.5" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create workspace'}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500">
            {mode === 'login' ? 'New to the platform? ' : 'Already have an account? '}
            <button
              type="button"
              className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setError(null)
              }}
            >
              {mode === 'login' ? 'Create a workspace' : 'Sign in instead'}
            </button>
          </p>
        </div>

        <ul className="mt-8 w-full max-w-sm space-y-2.5">
          {highlights.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5 text-sm text-white/75">
              <Icon size={15} className="flex-shrink-0 text-white/50" />
              {text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
