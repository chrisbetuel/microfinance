import { useState } from 'react'
import { Printer } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import { formatDate, formatDateTime, formatMoney } from '../../lib/format'
import { allocatePayment } from '../../lib/loanMath'
import type { Loan, Repayment, RepaymentChannel } from '../../types'

export const CHANNEL_LABEL: Record<RepaymentChannel, string> = {
  cash: 'Cash',
  bank: 'Bank',
  mobile_money: 'Mobile money',
  field: 'Field / agent collection',
  other: 'Other approved method',
}
export const NEEDS_REFERENCE = new Set<RepaymentChannel>(['bank', 'mobile_money', 'other'])

const today = () => new Date().toLocaleDateString('en-CA') // local YYYY-MM-DD
const r2 = (n: number) => Math.round(n * 100) / 100

/** The loan's position, worked out from its schedule and the payments posted to it. */
export function loanSummary(loan: Loan, repayments: Repayment[]) {
  const own = repayments.filter((r) => r.loanId === loan.id && !r.reversed)
  const sum = (f: (i: Loan['schedule'][number]) => number) => loan.schedule.reduce((s, i) => s + f(i), 0)
  const paid = (k: keyof Repayment['allocation']) => own.reduce((s, r) => s + (r.allocation?.[k] ?? 0), 0)
  const live = loan.status === 'active'
  const next = live ? loan.schedule.find((i) => i.status !== 'paid') : undefined
  const now = new Date()
  const overdueRows = live ? loan.schedule.filter((i) => i.status !== 'paid' && new Date(i.dueDate) < now) : []
  return {
    loanAmount: loan.principal,
    totalPayable: r2(sum((i) => i.totalDue)),
    totalPaid: r2(own.reduce((s, r) => s + r.amount, 0)),
    outstanding: live ? loan.outstandingBalance : 0,
    outstandingPrincipal: live ? Math.max(r2(sum((i) => i.principalDue) - paid('principal')), 0) : 0,
    outstandingInterest: live ? Math.max(r2(sum((i) => i.interestDue) - paid('interest')), 0) : 0,
    outstandingFees: live ? Math.max(r2(sum((i) => i.feesDue) - paid('fees')), 0) : 0,
    outstandingPenalty: live ? Math.max(r2(sum((i) => i.penaltyDue) - paid('penalty')), 0) : 0,
    nextPayment: next ? r2(next.totalDue - next.paidAmount) : 0,
    nextDueDate: next?.dueDate ?? null,
    missedInstalments: overdueRows.length,
    overdueAmount: r2(overdueRows.reduce((s, i) => s + i.totalDue - i.paidAmount, 0)),
    penaltyCharged: r2(sum((i) => i.penaltyDue)),
    lastPayment: [...own].sort((a, b) => (b.paymentDate || b.date).localeCompare(a.paymentDate || a.date))[0] ?? null,
  }
}

export function RecordPaymentForm({
  loan,
  onRecorded,
  collectionActivityId,
  defaultChannel = 'cash',
}: {
  loan: Loan
  onRecorded?: (r: Repayment) => void
  collectionActivityId?: string | null
  defaultChannel?: RepaymentChannel
}) {
  const products = useStore((s) => s.products)
  const staff = useStore((s) => s.staff)
  const branches = useStore((s) => s.branches)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const repayments = useStore((s) => s.repayments)
  const currency = useStore((s) => s.lender.currency)
  const recordRepayment = useStore((s) => s.recordRepayment)
  const me = staff.find((s) => s.id === currentStaffId)
  const lender = useStore((s) => s.lender)
  const product = products.find((p) => p.id === loan.productId)
  const summary = loanSummary(loan, repayments)

  const [amount, setAmount] = useState(summary.nextPayment || 0)
  const [channel, setChannel] = useState<RepaymentChannel>(defaultChannel)
  const [paymentDate, setPaymentDate] = useState(today())
  const [reference, setReference] = useState('')
  const [receivedById, setReceivedById] = useState(currentStaffId)
  const [branchId, setBranchId] = useState(me?.branchId || loan.branchId)
  const [collectionPoint, setCollectionPoint] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Repayment | null>(null)

  const preview = product && amount > 0 ? allocatePayment(product, loan.schedule, amount) : null
  const money = (n: number) => formatMoney(n, currency)
  const tooMuch = amount > loan.outstandingBalance + 0.01
  const missingRef = NEEDS_REFERENCE.has(channel) && !reference.trim()
  const order = product?.allocationOrder ?? ['penalty', 'fee', 'interest', 'principal']
  const label: Record<string, keyof NonNullable<typeof preview>['allocation']> = { penalty: 'penalty', fee: 'fees', interest: 'interest', principal: 'principal' }

  return (
    <div>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            const r = await recordRepayment({
              loanId: loan.id, amount, channel, paymentDate, reference, receivedById, branchId, collectionPoint, notes,
              collectionActivityId: collectionActivityId ?? null,
            })
            setReceipt(r)
            onRecorded?.(r)
            setReference('')
            setNotes('')
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not record the payment')
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount paid" error={tooMuch ? `More than the ${money(loan.outstandingBalance)} outstanding` : undefined}>
            <input type="number" min={0} className={inputClass} value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} />
          </Field>
          <Field label="Payment date">
            <input type="date" max={today()} className={inputClass} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </Field>
          <Field label="Payment method">
            <select className={inputClass} value={channel} onChange={(e) => setChannel(e.target.value as RepaymentChannel)}>
              {Object.entries(CHANNEL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label={`Transaction reference${NEEDS_REFERENCE.has(channel) ? ' *' : ''}`} hint={channel === 'mobile_money' ? 'e.g. the M-Pesa code' : channel === 'bank' ? 'Deposit slip / bank reference' : undefined}>
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Received by">
            <select className={inputClass} value={receivedById ?? ''} onChange={(e) => setReceivedById(e.target.value)}>
              {staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Branch">
            <select className={inputClass} value={branchId ?? ''} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Collection point" hint="Till, agent, group meeting, field visit…">
            <input className={inputClass} value={collectionPoint} onChange={(e) => setCollectionPoint(e.target.value)} />
          </Field>
          <Field label="Notes">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        {channel === 'mobile_money' && lender.mobileMoneyNumber && (
          <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
            The borrower sends the money to the company number <b>{lender.mobileMoneyNumber}</b>
            {lender.mobileMoneyNetwork ? ` (${lender.mobileMoneyNetwork})` : ''} with loan number <b>{loan.loanNumber}</b> as the reference.
            Enter the transaction code from their confirmation SMS. The mobile-money statement import then confirms the money arrived.
          </p>
        )}
        {preview && !tooMuch && (
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">How this payment is applied ({order.join(' → ')})</p>
            {order.map((k) => (
              <div key={k} className="flex justify-between py-0.5 text-sm">
                <span className="capitalize text-slate-600">{k === 'fee' ? 'Fees' : k}</span>
                <span className="tabular-nums">{money(preview.allocation[label[k]])}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1.5 text-sm font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{money(amount)}</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">Balance after this payment: {money(Math.max(loan.outstandingBalance - amount, 0))}</p>
          </div>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || amount <= 0 || tooMuch || missingRef}>
          {missingRef ? 'Enter the transaction reference' : 'Record payment & send SMS receipt'}
        </Button>
      </form>
      <ReceiptModal repayment={receipt} onClose={() => setReceipt(null)} />
    </div>
  )
}

export function ReceiptModal({ repayment, onClose }: { repayment: Repayment | null; onClose: () => void }) {
  const loan = useStore((s) => s.loans.find((l) => l.id === repayment?.loanId))
  const borrower = useStore((s) => s.borrowers.find((b) => b.id === loan?.borrowerId))
  const lender = useStore((s) => s.lender)
  if (!repayment || !loan || !borrower) return null
  const money = (n: number) => formatMoney(n, lender.currency)
  const rows: [string, string][] = [
    ['Receipt number', repayment.receiptNumber],
    ['Borrower', `${borrower.fullName} (${borrower.customerNumber})`],
    ['Loan number', loan.loanNumber || '—'],
    ['Amount', money(repayment.amount)],
    ['Payment date', formatDate(repayment.paymentDate || repayment.date)],
    ['Payment method', CHANNEL_LABEL[repayment.channel]],
    ['Transaction reference', repayment.reference || '—'],
    ['Amount remaining', repayment.balanceAfter == null ? '—' : money(repayment.balanceAfter)],
    ['Received by', repayment.receivedByName || repayment.recordedBy],
  ]
  const alloc: [string, number][] = [
    ['Penalty', repayment.allocation.penalty],
    ['Fees', repayment.allocation.fees],
    ['Interest', repayment.allocation.interest],
    ['Principal', repayment.allocation.principal],
  ]

  function print() {
    const w = window.open('', '_blank', 'width=420,height=640')
    if (!w) return
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(repayment!.receiptNumber)}</title>
      <style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}h1{font-size:18px;margin:0}small{color:#666}
      table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}td{padding:5px 0;border-bottom:1px solid #eee}
      td:last-child{text-align:right;font-weight:600}.void{color:#b91c1c;font-weight:700;margin-top:10px}</style></head><body>
      <h1>${esc(lender.name)}</h1><small>${esc(lender.address)} · ${esc(lender.phone)}</small>
      <h2 style="font-size:15px;margin-top:18px">Payment receipt</h2>
      ${repayment!.reversed ? '<p class="void">REVERSED — ' + esc(repayment!.reversalReason ?? '') + '</p>' : ''}
      <table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
      <table>${alloc.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(money(v))}</td></tr>`).join('')}</table>
      <p style="font-size:11px;color:#666;margin-top:18px">Printed ${esc(formatDateTime(new Date().toISOString()))}</p>
      <script>window.print()</script></body></html>`)
    w.document.close()
  }

  return (
    <Modal open onClose={onClose} title="Payment receipt">
      <div className="space-y-3 text-sm">
        {repayment.reversed && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">Reversed: {repayment.reversalReason}</p>}
        <dl className="divide-y divide-slate-100">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-1.5">
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-right font-medium text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          {alloc.map(([k, v]) => (
            <div key={k} className="flex justify-between text-xs text-slate-600">
              <span>{k}</span>
              <span className="tabular-nums">{money(v)}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400">An SMS receipt was sent to {borrower.phone}.</p>
        <Button variant="secondary" icon={<Printer size={14} />} className="w-full" onClick={print}>Print receipt</Button>
      </div>
    </Modal>
  )
}

export function ReverseModal({ repayment, onClose }: { repayment: Repayment | null; onClose: () => void }) {
  const reverseRepayment = useStore((s) => s.reverseRepayment)
  const currency = useStore((s) => s.lender.currency)
  const [reason, setReason] = useState('')
  const [correct, setCorrect] = useState(false)
  const [amount, setAmount] = useState(0)
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!repayment) return null
  return (
    <Modal open onClose={onClose} title={`Reverse ${repayment.receiptNumber}`}>
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">
          The original payment of <b>{formatMoney(repayment.amount, currency)}</b> stays on record, marked reversed with your reason. The loan
          balance is recalculated from the remaining payments.
        </p>
        <Field label="Reason for reversal">
          <textarea rows={2} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={correct}
            onChange={(e) => {
              setCorrect(e.target.checked)
              setAmount(repayment.amount)
              setReference(repayment.reference)
            }}
          />
          Record the corrected payment now
        </label>
        {correct && (
          <div className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
            <Field label="Correct amount">
              <input type="number" className={inputClass} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </Field>
            <Field label="Reference">
              <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          </div>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">{error}</p>}
        <Button
          variant="danger"
          className="w-full"
          disabled={busy || !reason.trim() || (correct && amount <= 0)}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await reverseRepayment(repayment.id, reason, correct ? { amount, reference } : null)
              onClose()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not reverse')
            } finally {
              setBusy(false)
            }
          }}
        >
          {correct ? 'Reverse and record correction' : 'Reverse payment'}
        </Button>
      </div>
    </Modal>
  )
}
