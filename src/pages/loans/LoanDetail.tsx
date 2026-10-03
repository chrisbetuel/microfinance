import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { Banknote } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import type { BadgeTone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Tabs } from '../../components/ui/Tabs'
import { formatDate, formatDateTime, formatMoney } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'
import type { LedgerData, Repayment, ScheduleInstalment } from '../../types'
import { loanStatusLabel } from '../borrowers/BorrowerExtras'
import { CHANNEL_LABEL, RecordPaymentForm, ReceiptModal, ReverseModal, loanSummary } from '../repayments/repaymentParts'

const INSTALMENT: Record<ScheduleInstalment['status'], [string, BadgeTone]> = {
  paid: ['Paid', 'green'],
  partial: ['Partially paid', 'amber'],
  due: ['Due', 'blue'],
  overdue: ['Overdue', 'red'],
  upcoming: ['Upcoming', 'slate'],
}

export default function LoanDetail() {
  const { id } = useParams()
  const loan = useStore((s) => s.loans.find((l) => l.id === id))
  const borrower = useStore((s) => s.borrowers.find((b) => b.id === loan?.borrowerId))
  const product = useStore((s) => s.products.find((p) => p.id === loan?.productId))
  const group = useStore((s) => s.groups.find((g) => g.id === loan?.groupId))
  const repayments = useStore((s) => s.repayments)
  const activities = useStore((s) => s.collectionActivities)
  const disbursement = useStore((s) => s.disbursements.find((d) => d.loanId === loan?.id && d.status === 'successful'))
  const staff = useStore((s) => s.staff)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const currency = useStore((s) => s.lender.currency)
  const loadLedger = useStore((s) => s.loadLedger)
  const canEdit = useCanEdit()
  const [tab, setTab] = useState('schedule')
  const [paying, setPaying] = useState(false)
  const [receipt, setReceipt] = useState<Repayment | null>(null)
  const [reversing, setReversing] = useState<Repayment | null>(null)
  const [ledger, setLedger] = useState<LedgerData | null>(null)

  useEffect(() => {
    if (tab === 'ledger' && loan) loadLedger(loan.id).then(setLedger).catch(() => setLedger(null))
  }, [tab, loan, loadLedger, repayments])

  if (!loan || !borrower) return <p className="text-sm text-slate-500">Loan not found.</p>
  const s = loanSummary(loan, repayments)
  const money = (n: number) => formatMoney(n, currency)
  const payments = repayments.filter((r) => r.loanId === loan.id).sort((a, b) => (b.paymentDate || b.date).localeCompare(a.paymentDate || a.date) || b.date.localeCompare(a.date))
  const own = activities.filter((a) => a.loanId === loan.id)
  const promise = own.filter((a) => a.promisedDate).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const me = staff.find((x) => x.id === currentStaffId)
  const isSupervisor = !!me && ['branch_manager', 'lender_admin', 'credit_committee'].includes(me.role)
  const statusTone: BadgeTone = loan.status === 'active' ? (loan.daysInArrears > 0 ? 'red' : 'blue') : loan.status === 'closed' ? 'green' : loan.status === 'written_off' ? 'red' : 'slate'

  return (
    <div>
      <PageHeader
        title={`${loan.loanNumber || 'Loan'} · ${borrower.fullName}`}
        subtitle={`${product?.name ?? ''} · disbursed ${loan.disbursement ? formatDate(loan.disbursement.date) : '—'}${group ? ` · ${group.name}` : ''}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link to={`/borrowers/${borrower.id}`}><Button variant="secondary">Borrower file</Button></Link>
            {disbursement && <Link to={`/disbursement/${disbursement.id}`}><Button variant="secondary">{disbursement.number}</Button></Link>}
            {canEdit && loan.status === 'active' && <Button icon={<Banknote size={15} />} onClick={() => setPaying(true)}>Record payment</Button>}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={statusTone} dot>{loan.status === 'active' && loan.daysInArrears > 0 ? `Overdue ${loan.daysInArrears} days` : loanStatusLabel[loan.status]}</Badge>
        <Badge>{borrower.customerNumber}</Badge>
        {loan.restructureCount > 0 && <Badge tone="amber">Restructured</Badge>}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile k="Loan amount" v={money(s.loanAmount)} />
        <Tile k="Total payable" v={money(s.totalPayable)} />
        <Tile k="Total paid" v={money(s.totalPaid)} good />
        <Tile k="Outstanding" v={money(s.outstanding)} strong />
        <Tile k="Next payment" v={s.nextPayment ? money(s.nextPayment) : '—'} />
        <Tile k="Next due date" v={s.nextDueDate ? formatDate(s.nextDueDate) : loan.status === 'closed' ? 'Completed' : '—'} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Outstanding by component" />
          <dl className="space-y-1 text-sm">
            <Row k="Principal" v={money(s.outstandingPrincipal)} />
            <Row k="Interest" v={money(s.outstandingInterest)} />
            <Row k="Fees" v={money(s.outstandingFees)} />
            <Row k="Penalties" v={money(s.outstandingPenalty)} bad={s.outstandingPenalty > 0} />
          </dl>
          <p className="mt-3 text-xs text-slate-400">Allocation order: {(product?.allocationOrder ?? []).join(' → ')}</p>
        </Card>
        <Card className={clsx(loan.daysInArrears > 0 && 'ring-1 ring-red-200')}>
          <CardHeader title="Overdue position" />
          <dl className="space-y-1 text-sm">
            <Row k="Days overdue" v={String(loan.status === 'active' ? loan.daysInArrears : 0)} bad={loan.daysInArrears > 0} />
            <Row k="Overdue amount" v={money(s.overdueAmount)} bad={s.overdueAmount > 0} />
            <Row k="Missed instalments" v={String(s.missedInstalments)} />
            <Row k="Penalties charged" v={money(s.penaltyCharged)} />
            <Row k="Collection actions" v={String(own.length)} />
            <Row k="Promise to pay" v={promise ? `${money(promise.promisedAmount ?? 0)} on ${formatDate(promise.promisedDate!)} (${promise.promiseStatus ?? 'pending'})` : '—'} />
          </dl>
          {own.length > 0 && <Link to="/collections" className="mt-3 inline-block text-xs font-medium text-brand-700 hover:underline">Open in collections</Link>}
        </Card>
        <Card>
          <CardHeader title="Last payment" />
          {s.lastPayment ? (
            <dl className="space-y-1 text-sm">
              <Row k="Amount" v={money(s.lastPayment.amount)} />
              <Row k="Date" v={formatDate(s.lastPayment.paymentDate)} />
              <Row k="Method" v={CHANNEL_LABEL[s.lastPayment.channel]} />
              <Row k="Receipt" v={s.lastPayment.receiptNumber} />
              <Row k="Received by" v={s.lastPayment.receivedByName} />
            </dl>
          ) : (
            <p className="text-sm text-slate-400">No payments yet.</p>
          )}
        </Card>
      </div>

      <Card>
        <Tabs
          tabs={[
            { id: 'schedule', label: 'Repayment schedule' },
            { id: 'payments', label: `Payment history (${payments.length})` },
            { id: 'ledger', label: 'Ledger' },
          ]}
          active={tab}
          onChange={setTab}
        />
        <div className="mt-4 overflow-x-auto">
          {tab === 'schedule' && (
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-2">#</th><th>Due date</th><th className="text-right">Principal</th><th className="text-right">Interest</th>
                  <th className="text-right">Fees + penalty</th><th className="text-right">Total due</th><th className="text-right">Paid</th>
                  <th className="text-right">Remaining</th><th className="pl-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loan.schedule.map((i) => {
                  const [label, tone] = INSTALMENT[i.status]
                  return (
                    <tr key={i.period}>
                      <td className="py-2">{i.period}</td>
                      <td>{formatDate(i.dueDate)}</td>
                      <td className="text-right tabular-nums">{money(i.principalDue)}</td>
                      <td className="text-right tabular-nums">{money(i.interestDue)}</td>
                      <td className="text-right tabular-nums">{money(i.feesDue + i.penaltyDue)}{i.penaltyDue > 0 && <span className="ml-1 text-xs text-accent-600">(pen. {money(i.penaltyDue)})</span>}</td>
                      <td className="text-right font-medium tabular-nums">{money(i.totalDue)}</td>
                      <td className="text-right tabular-nums">{money(i.paidAmount)}</td>
                      <td className="text-right tabular-nums">{money(Math.max(i.totalDue - i.paidAmount, 0))}</td>
                      <td className="pl-4"><Badge tone={tone}>{label}{i.wasLate && i.status === 'paid' ? ' (late)' : ''}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {tab === 'payments' && (
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-2">Date</th><th>Receipt</th><th className="text-right">Amount</th><th>Method / ref</th>
                  <th className="text-right">Pen · Fees · Int · Princ</th><th className="text-right">Balance after</th><th className="pl-4">Status</th><th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((r) => (
                  <tr key={r.id} className={clsx(r.reversed && 'text-slate-400')}>
                    <td className="py-2">{formatDate(r.paymentDate || r.date)}</td>
                    <td><button className={clsx('font-mono text-xs text-brand-700 hover:underline', r.reversed && 'line-through')} onClick={() => setReceipt(r)}>{r.receiptNumber}</button></td>
                    <td className="text-right tabular-nums">{money(r.amount)}</td>
                    <td className="text-xs">{CHANNEL_LABEL[r.channel]}{r.reference ? ` · ${r.reference}` : ''}<br /><span className="text-slate-400">{r.receivedByName}{r.collectionPoint ? ` · ${r.collectionPoint}` : ''}</span></td>
                    <td className="text-right text-xs tabular-nums">{[r.allocation.penalty, r.allocation.fees, r.allocation.interest, r.allocation.principal].map((n) => Math.round(n).toLocaleString()).join(' · ')}</td>
                    <td className="text-right tabular-nums">{r.balanceAfter == null ? '—' : money(r.balanceAfter)}</td>
                    <td className="pl-4">
                      <span className="flex flex-wrap gap-1">
                        {r.reversed ? <Badge tone="red">Reversed</Badge> : <Badge tone="green">Posted</Badge>}
                        {r.correctsId && <Badge tone="blue">Corrects {payments.find((p) => p.id === r.correctsId)?.receiptNumber}</Badge>}
                        {r.groupPaymentId && <Badge>Group</Badge>}
                        {!r.reversed && <Badge tone={r.reconciliationStatus === 'reconciled' ? 'green' : 'amber'}>{r.reconciliationStatus}</Badge>}
                      </span>
                      {r.reversed && <span className="block text-[11px]">{r.reversalReason} · {r.reversedBy}</span>}
                    </td>
                    <td>{isSupervisor && !r.reversed && <button className="text-xs font-medium text-accent-600 hover:underline" onClick={() => setReversing(r)}>Reverse / correct</button>}</td>
                  </tr>
                ))}
                {payments.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-slate-400">No payments yet.</td></tr>}
              </tbody>
            </table>
          )}
          {tab === 'ledger' && (
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <tr><th className="py-2">Journal</th><th>Date</th><th>Account</th><th>Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(ledger?.entries ?? []).map((e) => (
                  <tr key={e.id}>
                    <td className="py-1.5 font-mono text-xs">{e.journal}</td>
                    <td>{formatDateTime(e.date)}</td>
                    <td>{ledger?.accounts.find((a) => a.code === e.account)?.name ?? e.account}</td>
                    <td className="text-xs">{e.description}</td>
                    <td className="text-right tabular-nums">{e.debit ? money(e.debit) : ''}</td>
                    <td className="text-right tabular-nums">{e.credit ? money(e.credit) : ''}</td>
                  </tr>
                ))}
                {!ledger && <tr><td colSpan={6} className="py-4 text-center text-slate-400">Loading…</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Modal open={paying} onClose={() => setPaying(false)} title={`Record payment · ${loan.loanNumber}`} wide>
        <RecordPaymentForm loan={loan} />
      </Modal>
      <ReceiptModal repayment={receipt} onClose={() => setReceipt(null)} />
      <ReverseModal key={reversing?.id} repayment={reversing} onClose={() => setReversing(null)} />
    </div>
  )
}

function Tile({ k, v, strong, good }: { k: string; v: string; strong?: boolean; good?: boolean }) {
  return (
    <div className={clsx('rounded-2xl p-4', strong ? 'bg-brand-700 text-white' : 'bg-white')}>
      <p className={clsx('text-[11px] uppercase tracking-wide', strong ? 'text-brand-100' : 'text-slate-400')}>{k}</p>
      <p className={clsx('mt-1 text-lg font-bold tabular-nums', !strong && (good ? 'text-emerald-700' : 'text-slate-900'))}>{v}</p>
    </div>
  )
}

function Row({ k, v, bad }: { k: string; v: ReactNode; bad?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5">
      <dt className="text-slate-500">{k}</dt>
      <dd className={clsx('text-right font-medium', bad ? 'text-accent-600' : 'text-slate-800')}>{v}</dd>
    </div>
  )
}
