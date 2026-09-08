import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Mail, Send } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Button } from '../components/ui/Button'
import { api, ApiError, setToken } from '../lib/api'
import background from '../assets/login/viettel-hq.jpg'

const fieldIcon = 'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400'
const fieldInput =
  'w-full rounded-lg border border-transparent bg-slate-100 py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-1 focus:ring-brand-500'
const plainInput = fieldInput.replace('pl-10', 'pl-3')
const fieldLabel = 'mb-1.5 block text-sm font-semibold text-slate-800'

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
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-slate-900">
      {/* full-bleed background */}
      <img src={background} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover object-center" />
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900/30 via-transparent to-slate-900/40" />

      {/* centred login card */}
      <div className="relative flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[380px] rounded-3xl bg-white p-8 shadow-[0_25px_70px_-15px_rgba(2,6,23,0.5)]">
          <div className="mb-7 flex items-center justify-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-600 text-white">
              <Send size={18} strokeWidth={2.25} />
            </span>
            <span className="text-xl font-extrabold tracking-tight text-slate-900">
              Sele<span className="text-accent-600">MF</span>
            </span>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className={fieldLabel}>Lender / organisation name</label>
                  <input required className={plainInput} value={lenderName} onChange={(e) => setLenderName(e.target.value)} />
                </div>
                <div>
                  <label className={fieldLabel}>Your full name</label>
                  <input required className={plainInput} value={adminName} onChange={(e) => setAdminName(e.target.value)} />
                </div>
              </>
            )}

            <div>
              <label className={fieldLabel}>Email Address</label>
              <div className="relative">
                <Mail size={16} className={fieldIcon} />
                <input
                  required
                  type="email"
                  autoComplete="username"
                  placeholder="you@lender.co"
                  className={fieldInput}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className={fieldLabel}>Password</label>
              <div className="relative">
                <Lock size={16} className={fieldIcon} />
                <input
                  required
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="••••••••"
                  className={fieldInput}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <Button type="submit" className="mt-1 w-full py-2.5 text-sm" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Login' : 'Create workspace'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
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
          </p>
        </div>
      </div>

      <footer className="relative pb-6 text-center text-xs leading-relaxed text-white/70">
        © {new Date().getFullYear()} Sele Microfinance · Loan Management System
        <br />
        For access issues contact your lender administrator
      </footer>
    </div>
  )
}
