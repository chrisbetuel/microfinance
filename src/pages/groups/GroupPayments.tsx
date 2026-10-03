import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Plus } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import { formatDate, formatMoney } from '../../lib/format'
import type { BorrowerGroup, GroupPayment, RepaymentChannel } from '../../types'
import { CHANNEL_LABEL, NEEDS_REFERENCE, loanSummary } from '../repayments/repaymentParts'

/** What the group has paid, per member, plus group payments split into member contributions. */
export function GroupPaymentsTab({ group, canEdit }: { group: BorrowerGroup; canEdit: boolean }) {
  const loans = useStore((s) => s.loans)
  const repayments = useStore((s) => s.repayments)
  const currency = useStore((s) => s.lender.currency)
  const loadGroupPayments = useStore((s) => s.loadGroupPayments)
  const recordGroupPayment = useStore((s) => s.recordGroupPayment)
  const [payments, setPayments] = useState<GroupPayment[]>([])
  const [open, setOpen] = useState(false)
  const money = (n: number) => formatMoney(n, currency)

  useEffect(() => {
    loadGroupPayments(group.id).then(setPayments).catch(() => setPayments([]))
  }, [group.id, loadGroupPayments, repayments])

  const memberLoans = group.memberships
    .filter((m) => m.status === 'active')
    .map((m) => ({ m, loan: loans.find((l) => l.borrowerId === m.borrowerId && l.groupId === group.id && l.status === 'active') }))
  const groupLoanIds = new Set(loans.filter((l) => l.groupId === group.id).map((l) => l.id))
  const paidByMember = (borrowerId: string) =>
    repayments
      .filter((r) => !r.reversed && groupLoanIds.has(r.loanId) && loans.find((l) => l.id === r.loanId)?.borrowerId === borrowerId)
      .reduce((t, r) => t + r.amount, 0)
  const groupTotal = repayments.filter((r) => !r.reversed && groupLoanIds.has(r.loanId)).reduce((t, r) => t + r.amount, 0)
  const nameOfLoan = (loanId: string) =>
    group.memberships.find((m) => m.borrowerId === loans.find((l) => l.id === loanId)?.borrowerId)?.borrowerName ?? '—'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          The group has paid <b>{money(groupTotal)}</b> on its loans.
        </p>
        {canEdit && (
          <Button size="sm" icon={<Plus size={14} />} disabled={!memberLoans.some((x) => x.loan)} onClick={() => setOpen(true)}>
            Record group payment
          </Button>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2">Member</th>
              <th className="px-3 py-2">Loan</th>
              <th className="px-3 py-2 text-right">Paid so far</th>
              <th className="px-3 py-2 text-right">Outstanding</th>
              <th className="px-3 py-2 text-right">Overdue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {memberLoans.map(({ m, loan }) => {
              const s = loan ? loanSummary(loan, repayments) : null
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">{m.borrowerName}</td>
                  <td className="px-3 py-2">
                    {loan ? (
                      <Link to={`/loans/${loan.id}`} className="text-brand-700 hover:underline">{loan.loanNumber}</Link>
                    ) : (
                      <span className="text-slate-400">No active group loan</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(paidByMember(m.borrowerId))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s ? money(s.outstanding) : '—'}</td>
                  <td className={clsx('px-3 py-2 text-right tabular-nums', s && s.overdueAmount > 0 && 'font-semibold text-accent-600')}>
                    {s ? money(s.overdueAmount) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-slate-800">Group payments</p>
        {payments.length === 0 && <p className="text-sm text-slate-400">No group payments recorded yet.</p>}
        <ul className="space-y-2">
          {payments.map((p) => (
            <li key={p.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-800">
                  {p.number} · {formatDate(p.paymentDate)} · {CHANNEL_LABEL[p.channel]}
                  {p.reference ? ` · ${p.reference}` : ''}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={p.reconciled ? 'green' : 'amber'}>{p.reconciled ? 'reconciled' : 'unreconciled'}</Badge>
                  <b className="tabular-nums">{money(p.amount)}</b>
                </span>
              </div>
              <div className="mt-2 grid gap-1 sm:grid-cols-2">
                {repayments
                  .filter((r) => r.groupPaymentId === p.id)
                  .map((r) => (
                    <div key={r.id} className={clsx('flex justify-between rounded-lg bg-slate-50 px-3 py-1 text-xs', r.reversed && 'line-through opacity-60')}>
                      <span>{nameOfLoan(r.loanId)}</span>
                      <span className="tabular-nums">{money(r.amount)}</span>
                    </div>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <GroupPaymentModal
        open={open}
        onClose={() => setOpen(false)}
        rows={memberLoans
          .filter((x) => x.loan)
          .map(({ m, loan }) => ({ name: m.borrowerName, loan: loan!, suggested: loanSummary(loan!, repayments).nextPayment }))}
        meetingLocation={group.meetingLocation}
        onSave={async (input) => {
          await recordGroupPayment(group.id, input)
          setOpen(false)
        }}
      />
    </div>
  )
}

type GroupPaymentInput = {
  channel: RepaymentChannel
  paymentDate: string
  reference: string
  collectionPoint: string
  notes: string
  contributions: { loanId: string; amount: number }[]
}

function GroupPaymentModal({
  open,
  onClose,
  rows,
  onSave,
  meetingLocation,
}: {
  open: boolean
  onClose: () => void
  rows: { name: string; loan: { id: string; loanNumber: string; outstandingBalance: number }; suggested: number }[]
  onSave: (input: GroupPaymentInput) => Promise<void>
  meetingLocation: string
}) {
  const currency = useStore((s) => s.lender.currency)
  const today = new Date().toLocaleDateString('en-CA') // local YYYY-MM-DD
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [channel, setChannel] = useState<RepaymentChannel>('cash')
  const [paymentDate, setPaymentDate] = useState(today)
  const [reference, setReference] = useState('')
  const [collectionPoint, setCollectionPoint] = useState(meetingLocation)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [primed, setPrimed] = useState(false)
  if (open && !primed) {
    setAmounts(Object.fromEntries(rows.map((r) => [r.loan.id, r.suggested])))
    setPrimed(true)
  }
  if (!open && primed) setPrimed(false)

  const total = Object.values(amounts).reduce((t, n) => t + (n || 0), 0)
  const over = rows.find((r) => (amounts[r.loan.id] || 0) > r.loan.outstandingBalance + 0.01)
  const money = (n: number) => formatMoney(n, currency)
  return (
    <Modal open={open} onClose={onClose} title="Record group payment" wide>
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Payment method">
            <select className={inputClass} value={channel} onChange={(e) => setChannel(e.target.value as RepaymentChannel)}>
              {Object.entries(CHANNEL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Payment date">
            <input type="date" className={inputClass} value={paymentDate} max={today} onChange={(e) => setPaymentDate(e.target.value)} />
          </Field>
          <Field label={`Reference${NEEDS_REFERENCE.has(channel) ? ' *' : ''}`}>
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Collection point">
            <input className={inputClass} value={collectionPoint} onChange={(e) => setCollectionPoint(e.target.value)} />
          </Field>
        </div>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {rows.map((r) => (
            <div key={r.loan.id} className="flex items-center gap-3 px-3 py-2">
              <span className="flex-1">
                {r.name} <span className="text-xs text-slate-400">{r.loan.loanNumber} · owes {money(r.loan.outstandingBalance)}</span>
              </span>
              <input
                type="number"
                min={0}
                className="w-36 rounded-lg border border-slate-200 bg-transparent px-2 py-1 text-right"
                value={amounts[r.loan.id] ?? 0}
                onChange={(e) => setAmounts({ ...amounts, [r.loan.id]: Number(e.target.value) })}
              />
            </div>
          ))}
          <div className="flex justify-between bg-slate-50 px-3 py-2 font-semibold">
            <span>Group payment total</span>
            <span className="tabular-nums">{money(total)}</span>
          </div>
        </div>
        <Field label="Notes">
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {over && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">{over.name}'s contribution is more than their outstanding balance.</p>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">{error}</p>}
        <Button
          className="w-full"
          disabled={busy || total <= 0 || !!over || (NEEDS_REFERENCE.has(channel) && !reference.trim())}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await onSave({
                channel, paymentDate, reference, collectionPoint, notes,
                contributions: Object.entries(amounts).map(([loanId, amount]) => ({ loanId, amount })),
              })
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not record the payment')
            } finally {
              setBusy(false)
            }
          }}
        >
          Record {money(total)} for the group
        </Button>
      </div>
    </Modal>
  )
}
