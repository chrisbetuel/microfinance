import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { LogOut, Smartphone, Users } from 'lucide-react'
import { API_BASE_URL } from '../../lib/api'

/** What the portal API returns (services/portal.snapshot). */
interface PortalData {
  group: { name: string; number: string; status: string; meeting: string; meetingLocation: string }
  lender: { name: string; phone: string; currency: string }
  asOf: string
  totals: { members: number; activeLoans: number; outstanding: number; overdue: number; repaid: number; savings: number }
  members: {
    name: string; role: string; membershipNumber: string; loanNumbers: string[]; outstanding: number
    overdue: number; daysOverdue: number; nextDueDate: string | null; nextPayment: number
  }[]
  payments: { date: string; member: string; loanNumber: string; amount: number; receipt: string; method: string }[]
  meetings: { date: string; present: number; members: number; collected: number }[]
  payTo: { number: string; network: string; accountName: string }
}

const KEY = 'lms-portal-token'
const read = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
const write = (t: string | null) => {
  try {
    if (t) localStorage.setItem(KEY, t)
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: the session lasts until the page closes */
  }
}

async function call<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Portal ${token}` } : {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.detail ?? 'Something went wrong'), { status: res.status })
  return body as T
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

export default function GroupPortal() {
  const [token, setToken] = useState<string | null>(read)
  const [data, setData] = useState<PortalData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const signOut = useCallback(() => {
    write(null)
    setToken(null)
    setData(null)
  }, [])

  useEffect(() => {
    if (!token) return
    call<PortalData>('/portal/me', {}, token)
      .then(setData)
      .catch((e: Error & { status?: number }) => {
        if (e.status === 401) signOut()
        setError(e.message)
      })
  }, [token, signOut])

  if (!token) return <PortalLogin onToken={(t) => { write(t); setError(null); setToken(t) }} />
  if (!data) return <div className="flex min-h-screen items-center justify-center bg-[#eef3f1] text-sm text-slate-500">{error ?? 'Loading your group…'}</div>

  const cur = data.lender.currency
  const money = (n: number) => `${cur} ${Math.round(n).toLocaleString('en-US')}`
  return (
    <div className="min-h-screen bg-[#eef3f1] text-slate-800">
      <header className="bg-[#0c3d34] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <p className="text-xs text-white/60">{data.lender.name} · Group portal</p>
            <h1 className="text-lg font-bold">{data.group.name} <span className="text-sm font-normal text-white/60">{data.group.number}</span></h1>
          </div>
          <button onClick={signOut} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {[
            ['Members', String(data.totals.members)],
            ['Active loans', String(data.totals.activeLoans)],
            ['Outstanding', money(data.totals.outstanding)],
            ['Overdue', money(data.totals.overdue), data.totals.overdue > 0],
            ['Repaid so far', money(data.totals.repaid)],
            ['Savings', money(data.totals.savings)],
          ].map(([k, v, bad]) => (
            <div key={k as string} className="rounded-2xl bg-white p-4">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">{k}</p>
              <p className={clsx('mt-1 font-bold tabular-nums', bad ? 'text-red-600' : 'text-slate-900')}>{v}</p>
            </div>
          ))}
        </div>

        {data.payTo.number && (
          <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-[#14705d] p-5 text-white">
            <Smartphone size={28} className="shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-white/70">Repay by {data.payTo.network ? `${data.payTo.network} ` : ''}mobile money to</p>
              <p className="text-2xl font-bold tracking-wide">{data.payTo.number}</p>
              <p className="text-xs text-white/70">Account name: {data.payTo.accountName}. Use the member's loan number as the reference and keep the confirmation SMS.</p>
            </div>
          </div>
        )}

        <section className="rounded-2xl bg-white p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Users size={16} /> Members</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <tr><th className="py-2">Member</th><th className="hidden sm:table-cell">Loan</th><th className="text-right">Outstanding</th><th className="text-right">Next payment</th><th className="text-right">Overdue</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.members.map((m) => (
                  <tr key={m.membershipNumber || m.name}>
                    <td className="py-2"><span className="font-medium">{m.name}</span> <span className="text-xs capitalize text-slate-400">{m.role}</span></td>
                    <td className="hidden font-mono text-xs sm:table-cell">{m.loanNumbers.join(', ') || '—'}</td>
                    <td className="text-right tabular-nums">{m.outstanding ? money(m.outstanding) : '—'}</td>
                    <td className="text-right text-xs tabular-nums">{m.nextDueDate ? `${money(m.nextPayment)} · ${fmtDate(m.nextDueDate)}` : '—'}</td>
                    <td className={clsx('text-right tabular-nums', m.overdue > 0 && 'font-semibold text-red-600')}>{m.overdue ? `${money(m.overdue)} · ${m.daysOverdue}d` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl bg-white p-5">
            <h2 className="mb-3 font-semibold">Recent payments</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {data.payments.length === 0 && <li className="py-2 text-slate-400">No payments yet.</li>}
              {data.payments.map((p) => (
                <li key={p.receipt} className="flex justify-between gap-3 py-2">
                  <span>{fmtDate(p.date)} · {p.member}<span className="block text-xs text-slate-400">{p.receipt} · {p.method.replace('_', ' ')}</span></span>
                  <b className="tabular-nums">{money(p.amount)}</b>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-2xl bg-white p-5">
            <h2 className="mb-1 font-semibold">Meetings</h2>
            <p className="mb-3 text-xs text-slate-400">{data.group.meeting}{data.group.meetingLocation ? ` · ${data.group.meetingLocation}` : ''}</p>
            <ul className="divide-y divide-slate-100 text-sm">
              {data.meetings.length === 0 && <li className="py-2 text-slate-400">No meetings recorded.</li>}
              {data.meetings.map((m) => (
                <li key={m.date} className="flex justify-between py-2">
                  <span>{fmtDate(m.date)} · {m.present}/{m.members} present</span>
                  <span className="tabular-nums">{money(m.collected)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <p className="text-center text-xs text-slate-400">
          As of {fmtDate(data.asOf)}. Questions? Call {data.lender.phone || 'your loan officer'}. This view is read-only.
        </p>
      </main>
    </div>
  )
}

function PortalLogin({ onToken }: { onToken: (t: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0c3d34] px-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-7 shadow-xl"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            const { token } = await call<{ token: string }>('/portal/login', { method: 'POST', body: JSON.stringify({ username, password }) })
            onToken(token)
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not sign in')
          } finally {
            setBusy(false)
          }
        }}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#14705d]">Group portal</p>
          <h1 className="text-xl font-bold text-slate-900">Sign in to your group</h1>
          <p className="mt-1 text-sm text-slate-500">Use the username and password your loan officer gave the group.</p>
        </div>
        <label className="block text-sm font-medium text-slate-700">
          Username
          <input autoComplete="username" className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2.5" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Password
          <input type="password" autoComplete="current-password" className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2.5" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={busy || !username || !password} className="w-full rounded-xl bg-[#14705d] py-2.5 font-semibold text-white hover:bg-[#0f5a4a] disabled:opacity-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
