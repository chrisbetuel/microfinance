import { useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Info, Smartphone, RefreshCw } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatTile } from '../../components/ui/StatTile'
import { Table } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import { formatDateTime, formatMoney } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'
import type { PaymentNetwork, PaymentTransaction } from '../../types'

export const NETWORK_LABELS: Record<PaymentNetwork, string> = {
  mpesa: 'M-Pesa',
  tigopesa: 'Tigo Pesa',
  airtel: 'Airtel Money',
  halopesa: 'HaloPesa',
  bank: 'Bank',
}

const statusTone = { pending: 'amber', success: 'green', failed: 'red' } as const

export default function Payments() {
  const payments = useStore((s) => s.payments)
  const borrowers = useStore((s) => s.borrowers)
  const integrations = useStore((s) => s.integrations)
  const currency = useStore((s) => s.lender.currency)
  const simulate = useStore((s) => s.simulatePayment)
  const refresh = useStore((s) => s.refreshPayments)
  const canEdit = useCanEdit()
  const [open, setOpen] = useState(false)
  const simulated = integrations?.payments.simulated ?? true

  const totals = useMemo(() => {
    const ok = payments.filter((p) => p.status === 'success')
    return {
      received: ok.filter((p) => p.direction === 'inbound').reduce((s, p) => s + p.amount, 0),
      paidOut: ok.filter((p) => p.direction === 'outbound').reduce((s, p) => s + p.amount, 0),
      pending: payments.filter((p) => p.status === 'pending').length,
      failed: payments.filter((p) => p.status === 'failed').length,
    }
  }, [payments])

  return (
    <div>
      <PageHeader
        title="Online payments"
        subtitle="Collect repayments from customers' mobile wallets and send disbursements through the payment gateway"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void refresh()}>Refresh</Button>
            {canEdit && <Button icon={<Smartphone size={15} />} onClick={() => setOpen(true)}>Request payment</Button>}
          </div>
        }
      />

      {simulated && (
        <div className="mb-5 flex items-start gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>
            Payment gateway: <b>{integrations?.payments.provider ?? 'mock'}</b> (test mode). No real money moves — use{' '}
            <b>Approve / Decline</b> on a pending payment to stand in for the customer. Connect a mobile-money aggregator by
            setting <code className="rounded bg-white px-1">LMS_PAYMENT_PROVIDER</code> and pointing its callback at{' '}
            <code className="rounded bg-white px-1">/payments/callback</code>.
          </span>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Received online" value={formatMoney(totals.received, currency)} icon={<ArrowDownLeft size={16} />} tone="green" />
        <StatTile label="Paid out online" value={formatMoney(totals.paidOut, currency)} icon={<ArrowUpRight size={16} />} tone="brand" />
        <StatTile label="Awaiting confirmation" value={totals.pending.toString()} tone="amber" />
        <StatTile label="Failed" value={totals.failed.toString()} tone={totals.failed ? 'red' : 'green'} />
      </div>

      <Table
        rowKey={(p) => p.id}
        rows={payments}
        pageSize={20}
        emptyMessage="No online payments yet."
        filterPlaceholder="Filter by reference, phone, receipt or borrower"
        filterAccessor={(p) => `${p.reference} ${p.phone} ${p.receipt} ${p.providerRef} ${borrowers.find((b) => b.id === p.borrowerId)?.fullName ?? ''}`}
        columns={[
          { header: 'Time', cell: (p) => formatDateTime(p.createdAt), sort: (p) => p.createdAt },
          {
            header: 'Reference',
            cell: (p) => (
              <div>
                <p className="font-mono text-xs text-slate-700">{p.reference}</p>
                <p className="font-mono text-[11px] text-slate-400">{p.receipt || p.providerRef}</p>
              </div>
            ),
          },
          {
            header: 'Type',
            cell: (p) =>
              p.direction === 'inbound' ? (
                <span className="inline-flex items-center gap-1 text-emerald-700"><ArrowDownLeft size={13} /> Repayment</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-brand-700"><ArrowUpRight size={13} /> Disbursement</span>
              ),
          },
          { header: 'Borrower', cell: (p) => borrowers.find((b) => b.id === p.borrowerId)?.fullName ?? '—' },
          { header: 'Wallet', cell: (p) => `${NETWORK_LABELS[p.network] ?? p.network} · ${p.phone}` },
          { header: 'Amount', cell: (p) => formatMoney(p.amount, currency), sort: (p) => p.amount },
          {
            header: 'Status',
            cell: (p) => (
              <div>
                <Badge tone={statusTone[p.status]} className="capitalize">{p.status}</Badge>
                {p.failureReason && <p className="mt-1 max-w-[16rem] text-[11px] text-accent-700">{p.failureReason}</p>}
              </div>
            ),
          },
          {
            header: '',
            cell: (p) =>
              simulated && canEdit && p.status === 'pending' ? (
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={() => void simulate(p.id, 'success')}>Approve</Button>
                  <Button size="sm" variant="ghost" onClick={() => void simulate(p.id, 'failed')}>Decline</Button>
                </div>
              ) : null,
          },
        ]}
      />

      <RequestPaymentModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

export function RequestPaymentModal({ open, onClose, loanId: initialLoan }: { open: boolean; onClose: () => void; loanId?: string }) {
  const loans = useStore((s) => s.loans)
  const borrowers = useStore((s) => s.borrowers)
  const currency = useStore((s) => s.lender.currency)
  const requestPayment = useStore((s) => s.requestPayment)
  const active = loans.filter((l) => l.status === 'active')
  const [loanId, setLoanId] = useState(initialLoan ?? '')
  const loan = active.find((l) => l.id === (loanId || initialLoan))
  const borrower = borrowers.find((b) => b.id === loan?.borrowerId)
  const next = loan?.schedule.find((i) => i.status !== 'paid')
  const suggested = loan ? (loan.daysInArrears > 0 ? loan.arrearsAmount : next ? next.totalDue - next.paidAmount : 0) : 0
  const [amount, setAmount] = useState<number | ''>('')
  const [phone, setPhone] = useState('')
  const [network, setNetwork] = useState<PaymentNetwork>('mpesa')
  const [busy, setBusy] = useState(false)

  const effAmount = amount === '' ? Math.round(suggested) : amount
  const effPhone = phone || borrower?.mobileMoneyNumber || borrower?.phone || ''

  return (
    <Modal open={open} onClose={onClose} title="Request payment from customer">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Sends a payment prompt to the customer's phone. The repayment is recorded automatically once they approve it.
        </p>
        <Field label="Loan">
          <select
            className={inputClass}
            value={loanId || initialLoan || ''}
            onChange={(e) => {
              setLoanId(e.target.value)
              setAmount('')
              setPhone('')
            }}
          >
            <option value="">Select a loan…</option>
            {active.map((l) => {
              const b = borrowers.find((x) => x.id === l.borrowerId)
              return (
                <option key={l.id} value={l.id}>
                  {b?.fullName} · {formatMoney(l.outstandingBalance, currency)} outstanding{l.daysInArrears ? ` · ${l.daysInArrears}d late` : ''}
                </option>
              )
            })}
          </select>
        </Field>
        {loan && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount" hint={`Suggested: ${formatMoney(suggested, currency)}`}>
                <input type="number" min={1} max={loan.outstandingBalance} className={inputClass} value={effAmount} onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))} />
              </Field>
              <Field label="Network">
                <select className={inputClass} value={network} onChange={(e) => setNetwork(e.target.value as PaymentNetwork)}>
                  {(Object.keys(NETWORK_LABELS) as PaymentNetwork[]).filter((n) => n !== 'bank').map((n) => (
                    <option key={n} value={n}>{NETWORK_LABELS[n]}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Customer's mobile-money number">
              <input className={inputClass} value={effPhone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </>
        )}
        <Button
          className="w-full"
          disabled={!loan || !effAmount || !effPhone || busy || effAmount > (loan?.outstandingBalance ?? 0)}
          onClick={async () => {
            if (!loan) return
            setBusy(true)
            try {
              await requestPayment({ loanId: loan.id, phone: effPhone, amount: Number(effAmount), network })
              onClose()
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Sending…' : `Send payment request${effAmount ? ` for ${formatMoney(Number(effAmount), currency)}` : ''}`}
        </Button>
      </div>
    </Modal>
  )
}

export type { PaymentTransaction }
