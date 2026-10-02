import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import { formatDate, formatDateTime, formatMoney } from '../../lib/format'
import type { Borrower, CollateralStatus, Loan, LoanStatus } from '../../types'

export const loanStatusLabel: Record<LoanStatus, string> = {
  pending_disbursement: 'Pending disbursement',
  active: 'Active',
  closed: 'Completed',
  written_off: 'Defaulted (written off)',
  reversed: 'Reversed (disbursement undone)',
}
const loanTone: Record<LoanStatus, BadgeTone> = {
  pending_disbursement: 'amber',
  active: 'blue',
  closed: 'green',
  written_off: 'red',
  reversed: 'slate',
}

const loanNumber = (loans: Loan[], loan: Loan) => {
  if (loan.loanNumber) return loan.loanNumber
  const ordered = [...loans].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return `#${String(ordered.findIndex((l) => l.id === loan.id) + 1).padStart(3, '0')}`
}

/** Every loan the borrower has had — the internal repayment record. */
export function LoanHistory({ loans }: { loans: Loan[] }) {
  const repayments = useStore((s) => s.repayments)
  const products = useStore((s) => s.products)
  const rows = [...loans].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardHeader title="Loan history" subtitle="How this borrower has handled every loan" />
      </div>
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-slate-400">No loans yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                {['Loan', 'Product', 'Disbursed', 'Amount', 'Paid', 'Outstanding', 'Late payments', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((l) => {
                const paid = repayments.filter((r) => r.loanId === l.id && !r.reversed).reduce((s, r) => s + r.amount, 0)
                const late = l.schedule.filter((i) => i.wasLate).length
                return (
                  <tr key={l.id}>
                    <td className="px-4 py-3 font-mono text-xs">{loanNumber(loans, l)}</td>
                    <td className="px-4 py-3">{products.find((p) => p.id === l.productId)?.name ?? '—'}</td>
                    <td className="px-4 py-3">{l.disbursement ? formatDate(l.disbursement.date) : '—'}</td>
                    <td className="px-4 py-3 tabular-nums">{formatMoney(l.principal)}</td>
                    <td className="px-4 py-3 tabular-nums">{formatMoney(paid)}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatMoney(l.status === 'active' || l.status === 'written_off' ? l.outstandingBalance : 0)}
                      {l.daysInArrears > 0 && (
                        <span className="ml-1.5 text-xs font-semibold text-accent-600">{formatMoney(l.arrearsAmount)} overdue</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 tabular-nums ${late ? 'font-semibold text-accent-600' : ''}`}>{late}</td>
                    <td className="px-4 py-3">
                      <Badge tone={loanTone[l.status]}>{loanStatusLabel[l.status]}</Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/** Chronological, append-only money movements for the borrower. */
export function TransactionLedger({ loans }: { loans: Loan[] }) {
  const repayments = useStore((s) => s.repayments)
  const entries = useMemo(() => {
    const out: { date: string; label: string; loan: string; amount: number; by: string; muted?: boolean }[] = []
    for (const l of loans) {
      const no = loanNumber(loans, l)
      if (l.disbursement) {
        out.push({ date: l.disbursement.date, label: `Loan disbursed (${l.disbursement.channel.replace('_', ' ')})`, loan: no, amount: l.netDisbursed, by: l.disbursement.disbursedBy })
        if (l.feesDeducted) out.push({ date: l.disbursement.date, label: 'Fees deducted at disbursement', loan: no, amount: l.feesDeducted, by: 'System' })
        if (l.savingsDeducted) out.push({ date: l.disbursement.date, label: 'Compulsory savings deducted', loan: no, amount: l.savingsDeducted, by: 'System' })
      }
      if (l.restructuredAt) out.push({ date: l.restructuredAt, label: 'Loan restructured', loan: no, amount: 0, by: '—' })
      if (l.closedAt) out.push({ date: l.closedAt, label: l.status === 'written_off' ? 'Loan written off' : 'Loan completed', loan: no, amount: l.status === 'written_off' ? l.outstandingBalance : 0, by: '—' })
    }
    for (const r of repayments) {
      const l = loans.find((x) => x.id === r.loanId)
      if (!l) continue
      out.push({ date: r.date, label: `Payment ${r.receiptNumber} (${r.channel.replace('_', ' ')})`, loan: loanNumber(loans, l), amount: -r.amount, by: r.recordedBy, muted: r.reversed })
      if (r.reversed) out.push({ date: r.date, label: `Payment ${r.receiptNumber} reversed — ${r.reversalReason ?? ''}`, loan: loanNumber(loans, l), amount: r.amount, by: '—' })
    }
    return out.sort((a, b) => b.date.localeCompare(a.date))
  }, [loans, repayments])

  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardHeader title="Transactions" subtitle="Every financial event, in order. Entries are never edited — corrections appear as reversals." />
      </div>
      {entries.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-slate-400">No transactions yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {entries.map((e, i) => (
            <li key={i} className={`flex items-center justify-between gap-4 px-5 py-3 text-sm ${e.muted ? 'opacity-50 line-through' : ''}`}>
              <div>
                <p className="font-medium text-slate-800">{e.label}</p>
                <p className="text-xs text-slate-400">
                  {formatDateTime(e.date)} · Loan {e.loan} · {e.by}
                </p>
              </div>
              {e.amount !== 0 && (
                <span className={`tabular-nums font-semibold ${e.amount < 0 ? 'text-emerald-600' : 'text-slate-800'}`}>
                  {e.amount < 0 ? '−' : '+'}
                  {formatMoney(Math.abs(e.amount))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

const collateralTone: Record<CollateralStatus, BadgeTone> = { pledged: 'amber', active: 'blue', released: 'green', seized: 'red' }

export function CollateralTab({ borrower, loans, canEdit }: { borrower: Borrower; loans: Loan[]; canEdit: boolean }) {
  const all = useStore((s) => s.collateral)
  const addCollateral = useStore((s) => s.addCollateral)
  const updateCollateral = useStore((s) => s.updateCollateral)
  const items = all.filter((c) => c.borrowerId === borrower.id)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    assetType: 'Vehicle',
    description: '',
    estimatedValue: 0,
    ownerName: borrower.fullName,
    ownershipDocument: '',
    valuationDate: new Date().toISOString().slice(0, 10),
    loanId: '',
  })

  return (
    <Card>
      <CardHeader
        title="Collateral"
        subtitle="Pledged assets automatically secure the borrower's next disbursed loan, are released on completion and marked seized on write-off"
        action={canEdit && <Button size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)}>Add collateral</Button>}
      />
      {items.length === 0 && <p className="text-sm text-slate-400">No collateral recorded.</p>}
      <ul className="divide-y divide-slate-100">
        {items.map((c) => {
          const loan = loans.find((l) => l.id === c.loanId)
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div>
                <p className="font-medium text-slate-800">{c.description} <span className="font-normal text-slate-400">· {c.assetType}</span></p>
                <p className="text-xs text-slate-500">
                  Value <b>{formatMoney(c.estimatedValue)}</b>
                  {c.valuationDate && ` (valued ${formatDate(c.valuationDate)})`} · Owner {c.ownerName || '—'}
                  {c.ownershipDocument && ` · ${c.ownershipDocument}`}
                </p>
                <p className="text-xs text-slate-400">{loan ? `Securing loan ${loanNumber(loans, loan)}` : 'Not yet linked to a loan'}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={collateralTone[c.status]} className="capitalize">{c.status}</Badge>
                {canEdit && (
                  <select
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                    value={c.status}
                    onChange={(e) => void updateCollateral(c.id, { status: e.target.value as CollateralStatus })}
                    aria-label="Collateral status"
                  >
                    {(['pledged', 'active', 'released', 'seized'] as const).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <Modal open={open} onClose={() => setOpen(false)} title="Add collateral">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              await addCollateral(borrower.id, { ...form, loanId: form.loanId || null })
              setOpen(false)
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Asset type">
              <select className={inputClass} value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })}>
                {['Vehicle', 'Land / title deed', 'Building', 'Machinery', 'Household items', 'Livestock', 'Stock / inventory', 'Other'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Estimated value">
              <input type="number" min={0} required className={inputClass} value={form.estimatedValue} onChange={(e) => setForm({ ...form, estimatedValue: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Description">
            <input required className={inputClass} placeholder="e.g. Toyota Hiace T123 ABC" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Owner">
              <input className={inputClass} value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
            </Field>
            <Field label="Ownership document no.">
              <input className={inputClass} placeholder="Card / deed number" value={form.ownershipDocument} onChange={(e) => setForm({ ...form, ownershipDocument: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valuation date">
              <input type="date" className={inputClass} value={form.valuationDate} onChange={(e) => setForm({ ...form, valuationDate: e.target.value })} />
            </Field>
            <Field label="Link to loan" hint="Optional">
              <select className={inputClass} value={form.loanId} onChange={(e) => setForm({ ...form, loanId: e.target.value })}>
                <option value="">Next loan</option>
                {loans.filter((l) => l.status === 'active').map((l) => (
                  <option key={l.id} value={l.id}>{loanNumber(loans, l)} · {formatMoney(l.principal)}</option>
                ))}
              </select>
            </Field>
          </div>
          <Button type="submit" className="w-full" disabled={busy || !form.description || !form.estimatedValue}>Save collateral</Button>
        </form>
      </Modal>
    </Card>
  )
}

/** Other borrowers this person currently guarantees (matched by ID number). */
export function AlsoGuarantees({ nationalId, selfId }: { nationalId: string; selfId: string }) {
  const borrowers = useStore((s) => s.borrowers)
  const others = borrowers.filter((b) => b.id !== selfId && b.guarantors.some((g) => g.nationalId === nationalId))
  if (others.length === 0) return null
  return (
    <p className="mt-0.5 text-xs text-amber-700">
      Also guaranteeing:{' '}
      {others.map((b, i) => (
        <span key={b.id}>
          {i > 0 && ', '}
          <Link to={`/borrowers/${b.id}`} className="underline">{b.fullName}</Link>
        </span>
      ))}
    </p>
  )
}

/** Borrowers this borrower guarantees for — shown on their own profile. */
export function GuaranteesGiven({ borrower }: { borrower: Borrower }) {
  const borrowers = useStore((s) => s.borrowers)
  const given = borrowers.filter((b) => b.id !== borrower.id && b.guarantors.some((g) => g.nationalId === borrower.nationalId))
  if (given.length === 0) return null
  return (
    <Card>
      <CardHeader title="Guarantees given" subtitle="Borrowers this person is currently guaranteeing" />
      <ul className="space-y-1.5 text-sm">
        {given.map((b) => {
          const g = b.guarantors.find((x) => x.nationalId === borrower.nationalId)!
          return (
            <li key={b.id} className="flex justify-between">
              <Link to={`/borrowers/${b.id}`} className="font-medium text-brand-700 hover:underline">{b.fullName}</Link>
              <span className="tabular-nums text-slate-600">{formatMoney(g.guaranteeAmount)} · {g.status}</span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
