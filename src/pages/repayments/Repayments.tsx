import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Tabs } from '../../components/ui/Tabs'
import { Table } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import { BorrowerLink } from '../../components/ui/BorrowerLink'
import { formatDate, formatDateTime, formatMoney } from '../../lib/format'
import { allocatePayment } from '../../lib/loanMath'
import { useCanEdit } from '../../lib/useCanEdit'
import type { Repayment } from '../../types'

const tabs = [
  { id: 'record', label: 'Record repayment' },
  { id: 'register', label: 'Repayment register' },
]

const supervisorRoles = new Set(['branch_manager', 'lender_admin', 'credit_committee'])

export default function Repayments() {
  const [tab, setTab] = useState('record')
  return (
    <div>
      <PageHeader title="Repayments & Collections" subtitle="Money coming in, from any channel, with every balance kept correct" />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="mt-6">{tab === 'record' ? <RecordRepayment /> : <RepaymentRegister />}</div>
    </div>
  )
}

function RecordRepayment() {
  const allLoans = useStore((s) => s.loans)
  const loans = useMemo(() => allLoans.filter((l) => l.status === 'active'), [allLoans])
  const borrowers = useStore((s) => s.borrowers)
  const products = useStore((s) => s.products)
  const lender = useStore((s) => s.lender)
  const recordRepayment = useStore((s) => s.recordRepayment)
  const canEdit = useCanEdit()

  const [query, setQuery] = useState('')
  const [loanId, setLoanId] = useState('')
  const [amount, setAmount] = useState(0)
  const [channel, setChannel] = useState<Repayment['channel']>('mobile_money')
  const [receipt, setReceipt] = useState<{ amount: number; allocation: ReturnType<typeof allocatePayment>['allocation'] } | null>(null)

  const filteredLoans = useMemo(() => {
    const q = query.trim().toLowerCase()
    return loans
      .map((l) => ({ loan: l, borrower: borrowers.find((b) => b.id === l.borrowerId) }))
      .filter(({ borrower }) => !q || borrower?.fullName.toLowerCase().includes(q) || borrower?.nationalId.includes(q))
  }, [loans, borrowers, query])

  const selected = loans.find((l) => l.id === loanId)
  const product = products.find((p) => p.id === selected?.productId)
  const borrower = borrowers.find((b) => b.id === selected?.borrowerId)
  const nextInstalment = selected?.schedule.find((i) => i.status !== 'paid')
  const preview = selected && product && amount > 0 ? allocatePayment(product, selected.schedule, amount) : null

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader title="Find loan" />
        <input className={`${inputClass} mb-3`} placeholder="Search borrower name or ID" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
          {filteredLoans.map(({ loan, borrower: b }) => (
            <li key={loan.id}>
              <button
                onClick={() => {
                  setLoanId(loan.id)
                  setReceipt(null)
                }}
                className={`w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50 ${loanId === loan.id ? 'bg-indigo-50' : ''}`}
              >
                <p className="font-medium text-slate-800">{b?.fullName}</p>
                <p className="text-xs text-slate-400">{formatMoney(loan.outstandingBalance, lender.currency)} outstanding</p>
              </button>
            </li>
          ))}
          {filteredLoans.length === 0 && <p className="py-4 text-center text-sm text-slate-400">No active loans found.</p>}
        </ul>
      </Card>

      <Card className="lg:col-span-2">
        {!selected ? (
          <p className="text-sm text-slate-400">Select a loan to record a repayment.</p>
        ) : (
          <>
            <CardHeader
              title={borrower?.fullName ?? ''}
              subtitle={product?.name}
              action={
                borrower && (
                  <Link to={`/borrowers/${borrower.id}`} className="text-xs font-medium text-indigo-600 hover:underline">
                    View borrower file
                  </Link>
                )
              }
            />
            <dl className="mb-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-slate-400">Outstanding</dt>
                <dd className="font-medium">{formatMoney(selected.outstandingBalance, lender.currency)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Next due</dt>
                <dd className="font-medium">{nextInstalment ? `${formatMoney(nextInstalment.totalDue)} on ${formatDate(nextInstalment.dueDate)}` : 'Fully paid'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Early settlement</dt>
                <dd className="font-medium">{formatMoney(selected.outstandingBalance, lender.currency)}</dd>
              </div>
            </dl>

            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!selected || amount <= 0) return
                const paid = amount
                const repayment = await recordRepayment(selected.id, amount, channel)
                setReceipt({ amount: paid, allocation: repayment.allocation })
                setAmount(0)
              }}
            >
              <div className="grid grid-cols-2 gap-4">
                <Field label="Amount received">
                  <input type="number" className={inputClass} value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} />
                </Field>
                <Field label="Channel">
                  <select className={inputClass} value={channel} onChange={(e) => setChannel(e.target.value as Repayment['channel'])}>
                    <option value="mobile_money">Mobile money (auto-matched)</option>
                    <option value="bank">Bank transfer</option>
                    <option value="cash">Cash</option>
                    <option value="field">Field collection</option>
                  </select>
                </Field>
              </div>

              {preview && (
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Allocation preview — Penalty {formatMoney(preview.allocation.penalty)} · Fees {formatMoney(preview.allocation.fees)} ·
                  Interest {formatMoney(preview.allocation.interest)} · Principal {formatMoney(preview.allocation.principal)}
                  {preview.remainder > 0 && <span className="block text-emerald-700">Overpayment of {formatMoney(preview.remainder)} held as credit.</span>}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={amount <= 0 || !canEdit}>
                {canEdit ? 'Record repayment & send SMS receipt' : 'View only — cannot record repayments'}
              </Button>
            </form>
          </>
        )}
      </Card>

      <Modal open={receipt !== null} onClose={() => setReceipt(null)} title="Payment receipt">
        {receipt && borrower && (
          <div className="space-y-2 text-sm text-slate-700">
            <p>Asante {borrower.fullName}. Tumepokea {formatMoney(receipt.amount, lender.currency)}.</p>
            <p className="text-xs text-slate-400">SMS receipt sent automatically to {borrower.phone}.</p>
            <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs">
              <dt className="text-slate-400">Penalty</dt>
              <dd className="text-right">{formatMoney(receipt.allocation.penalty)}</dd>
              <dt className="text-slate-400">Fees</dt>
              <dd className="text-right">{formatMoney(receipt.allocation.fees)}</dd>
              <dt className="text-slate-400">Interest</dt>
              <dd className="text-right">{formatMoney(receipt.allocation.interest)}</dd>
              <dt className="text-slate-400">Principal</dt>
              <dd className="text-right">{formatMoney(receipt.allocation.principal)}</dd>
            </dl>
          </div>
        )}
      </Modal>
    </div>
  )
}

function RepaymentRegister() {
  const repayments = useStore((s) => s.repayments)
  const loans = useStore((s) => s.loans)
  const borrowers = useStore((s) => s.borrowers)
  const reverseRepayment = useStore((s) => s.reverseRepayment)
  const staff = useStore((s) => s.staff)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const currentStaff = staff.find((s) => s.id === currentStaffId)
  const isSupervisor = currentStaff ? supervisorRoles.has(currentStaff.role) : false

  const [reversing, setReversing] = useState<Repayment | null>(null)
  const [reason, setReason] = useState('')

  function borrowerIdFor(loanId: string) {
    return loans.find((l) => l.id === loanId)?.borrowerId ?? ''
  }

  return (
    <div>
      <Table
        rowKey={(r) => r.id}
        rows={[...repayments].sort((a, b) => b.date.localeCompare(a.date))}
        columns={[
          { header: 'Receipt', cell: (r) => r.receiptNumber },
          { header: 'Borrower', cell: (r) => <BorrowerLink id={borrowerIdFor(r.loanId)} borrowers={borrowers} /> },
          { header: 'Amount', cell: (r) => formatMoney(r.amount) },
          { header: 'Channel', cell: (r) => r.channel },
          { header: 'Recorded by', cell: (r) => r.recordedBy },
          { header: 'Date', cell: (r) => formatDateTime(r.date) },
          {
            header: 'Status',
            cell: (r) => (r.reversed ? <Badge tone="red">Reversed</Badge> : <Badge tone="green">Posted</Badge>),
          },
          {
            header: '',
            cell: (r) =>
              !r.reversed && (
                <button
                  disabled={!isSupervisor}
                  onClick={() => setReversing(r)}
                  className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300"
                  title={isSupervisor ? 'Reverse payment' : 'Only a supervisor can reverse a payment'}
                >
                  Reverse
                </button>
              ),
          },
        ]}
      />

      <Modal open={reversing !== null} onClose={() => setReversing(null)} title="Reverse payment">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!reversing) return
            await reverseRepayment(reversing.id, reason)
            setReversing(null)
            setReason('')
          }}
        >
          <Field label="Reason" hint="Permanently recorded against this payment">
            <textarea required rows={3} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button type="submit" variant="danger" className="w-full">
            Confirm reversal
          </Button>
        </form>
      </Modal>
    </div>
  )
}
