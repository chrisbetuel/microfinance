import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Download, RefreshCw, Upload } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Tabs } from '../../components/ui/Tabs'
import { Table } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import { StatTile } from '../../components/ui/StatTile'
import { formatDate, formatMoney } from '../../lib/format'
import { downloadCSV } from '../../lib/csv'
import { useCanEdit } from '../../lib/useCanEdit'
import { CashDrawer } from './CashDrawer'
import { CHANNEL_LABEL, RecordPaymentForm, ReceiptModal, ReverseModal, loanSummary } from './repaymentParts'
import type { ReconciliationData, Repayment, StatementLine, StatementSource } from '../../types'

const tabs = [
  { id: 'record', label: 'Record payment' },
  { id: 'register', label: 'Payment register' },
  { id: 'reconcile', label: 'Reconciliation' },
  { id: 'drawer', label: 'Cash drawer' },
]
const supervisorRoles = new Set(['branch_manager', 'lender_admin', 'credit_committee'])

export default function Repayments() {
  const [tab, setTab] = useState('record')
  return (
    <div>
      <PageHeader
        title="Repayments"
        subtitle="Every payment is a transaction: allocated to the schedule, receipted, posted to the ledger, and reconciled"
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="mt-6">
        {tab === 'record' && <RecordTab />}
        {tab === 'register' && <RegisterTab />}
        {tab === 'reconcile' && <ReconciliationTab />}
        {tab === 'drawer' && <CashDrawer />}
      </div>
    </div>
  )
}

function RecordTab() {
  const allLoans = useStore((s) => s.loans)
  const borrowers = useStore((s) => s.borrowers)
  const repayments = useStore((s) => s.repayments)
  const currency = useStore((s) => s.lender.currency)
  const canEdit = useCanEdit()
  const [query, setQuery] = useState('')
  const [loanId, setLoanId] = useState(() => new URLSearchParams(window.location.search).get('loan') ?? '')
  const loans = useMemo(() => allLoans.filter((l) => l.status === 'active'), [allLoans])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return loans
      .map((l) => ({ loan: l, borrower: borrowers.find((b) => b.id === l.borrowerId) }))
      .filter(({ loan, borrower }) => !q || `${borrower?.fullName} ${borrower?.customerNumber} ${borrower?.phone} ${loan.loanNumber}`.toLowerCase().includes(q))
  }, [loans, borrowers, query])
  const selected = loans.find((l) => l.id === loanId)
  const borrower = borrowers.find((b) => b.id === selected?.borrowerId)
  const money = (n: number) => formatMoney(n, currency)
  const s = selected ? loanSummary(selected, repayments) : null

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <Card>
        <CardHeader title="Find loan" />
        <input className={`${inputClass} mb-3`} placeholder="Name, customer ID, phone or loan number" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ul className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
          {rows.map(({ loan, borrower: b }) => (
            <li key={loan.id}>
              <button
                onClick={() => setLoanId(loan.id)}
                className={clsx('w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50', loanId === loan.id && 'bg-brand-50')}
              >
                <p className="font-medium text-slate-800">{b?.fullName}</p>
                <p className="text-xs text-slate-400">{loan.loanNumber} · {money(loan.outstandingBalance)} outstanding{loan.daysInArrears > 0 ? ` · ${loan.daysInArrears}d late` : ''}</p>
              </button>
            </li>
          ))}
          {rows.length === 0 && <p className="py-4 text-center text-sm text-slate-400">No active loans found.</p>}
        </ul>
      </Card>
      <Card className="lg:col-span-2">
        {!selected || !s ? (
          <p className="text-sm text-slate-400">Select a loan to record a payment.</p>
        ) : (
          <>
            <CardHeader
              title={`${borrower?.fullName} · ${selected.loanNumber}`}
              subtitle={borrower?.customerNumber}
              action={<Link to={`/loans/${selected.id}`} className="text-xs font-medium text-brand-600 hover:underline">Open loan</Link>}
            />
            <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Mini k="Outstanding" v={money(s.outstanding)} />
              <Mini k="Next payment" v={s.nextPayment ? money(s.nextPayment) : '—'} />
              <Mini k="Next due" v={s.nextDueDate ? formatDate(s.nextDueDate) : '—'} />
              <Mini k="Overdue" v={money(s.overdueAmount)} bad={s.overdueAmount > 0} />
            </div>
            {canEdit ? <RecordPaymentForm key={selected.id} loan={selected} /> : <p className="text-sm text-slate-400">View only.</p>}
          </>
        )}
      </Card>
    </div>
  )
}

function Mini({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[11px] text-slate-400">{k}</p>
      <p className={clsx('font-semibold tabular-nums', bad ? 'text-accent-600' : 'text-slate-800')}>{v}</p>
    </div>
  )
}

function RegisterTab() {
  const navigate = useNavigate()
  const repayments = useStore((s) => s.repayments)
  const loans = useStore((s) => s.loans)
  const borrowers = useStore((s) => s.borrowers)
  const staff = useStore((s) => s.staff)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const currency = useStore((s) => s.lender.currency)
  const me = staff.find((s) => s.id === currentStaffId)
  const isSupervisor = me ? supervisorRoles.has(me.role) : false
  const [receipt, setReceipt] = useState<Repayment | null>(null)
  const [reversing, setReversing] = useState<Repayment | null>(null)
  const money = (n: number) => formatMoney(n, currency)
  const loanOf = (r: Repayment) => loans.find((l) => l.id === r.loanId)
  const nameOf = (r: Repayment) => borrowers.find((b) => b.id === loanOf(r)?.borrowerId)?.fullName ?? '—'
  const sorted = [...repayments].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="secondary"
          icon={<Download size={14} />}
          onClick={() =>
            downloadCSV(
              `repayments-${new Date().toISOString().slice(0, 10)}.csv`,
              ['Receipt', 'Payment date', 'Loan', 'Borrower', 'Amount', 'Method', 'Reference', 'Received by', 'Penalty', 'Fees', 'Interest', 'Principal', 'Balance after', 'Status', 'Reconciled'],
              sorted.map((r) => [
                r.receiptNumber, r.paymentDate, loanOf(r)?.loanNumber ?? '', nameOf(r), r.amount, CHANNEL_LABEL[r.channel], r.reference,
                r.receivedByName, r.allocation.penalty, r.allocation.fees, r.allocation.interest, r.allocation.principal,
                r.balanceAfter ?? '', r.reversed ? 'Reversed' : 'Posted', r.reconciliationStatus,
              ]),
            )
          }
        >
          Export CSV
        </Button>
      </div>
      <Table
        rowKey={(r) => r.id}
        rows={sorted}
        pageSize={15}
        filterPlaceholder="Receipt, reference, loan or borrower"
        filterAccessor={(r) => `${r.receiptNumber} ${r.reference} ${loanOf(r)?.loanNumber ?? ''} ${nameOf(r)}`}
        onRowClick={(r) => setReceipt(r)}
        columns={[
          { header: 'Receipt', cell: (r) => <span className={clsx('font-mono text-xs', r.reversed && 'line-through')}>{r.receiptNumber}</span>, sort: (r) => r.receiptNumber },
          { header: 'Date', cell: (r) => formatDate(r.paymentDate || r.date), sort: (r) => r.paymentDate || r.date },
          {
            header: 'Loan',
            cell: (r) => (
              <button className="text-left text-brand-700 hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/loans/${r.loanId}`) }}>
                {loanOf(r)?.loanNumber} · {nameOf(r)}
              </button>
            ),
          },
          { header: 'Amount', cell: (r) => money(r.amount), sort: (r) => r.amount },
          { header: 'Method', cell: (r) => <span className="text-xs">{CHANNEL_LABEL[r.channel]}{r.reference ? ` · ${r.reference}` : ''}</span> },
          { header: 'Received by', cell: (r) => <span className="text-xs">{r.receivedByName}</span> },
          {
            header: 'Status',
            cell: (r) => (
              <span className="flex flex-wrap gap-1">
                {r.reversed ? <Badge tone="red">Reversed</Badge> : <Badge tone="green">Posted</Badge>}
                {r.correctsId && <Badge tone="blue">Correction</Badge>}
                {!r.reversed && <Badge tone={r.reconciliationStatus === 'reconciled' ? 'green' : 'amber'}>{r.reconciliationStatus}</Badge>}
                {r.groupPaymentId && <Badge>Group</Badge>}
              </span>
            ),
          },
          {
            header: '',
            cell: (r) =>
              isSupervisor && !r.reversed && (
                <button className="text-xs font-medium text-accent-600 hover:underline" onClick={(e) => { e.stopPropagation(); setReversing(r) }}>
                  Reverse / correct
                </button>
              ),
          },
        ]}
      />
      <ReceiptModal repayment={receipt} onClose={() => setReceipt(null)} />
      <ReverseModal key={reversing?.id} repayment={reversing} onClose={() => setReversing(null)} />
    </div>
  )
}

const SOURCES: { id: StatementSource; label: string; hint: string }[] = [
  { id: 'bank', label: 'Bank', hint: 'Bank statement credits (bank and “other” payments)' },
  { id: 'mobile_money', label: 'Mobile money', hint: 'M-Pesa / Tigo / Airtel statement. Gateway payments are matched automatically' },
  { id: 'cash', label: 'Cash', hint: 'Cash and field collections. Matched when the cashier closes the drawer, or from a cash count' },
]

/** CSV → statement rows. Accepts headers containing date, reference/ref/receipt, amount/credit, description/details. */
function parseStatement(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const split = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim())
  const head = split(lines[0]).map((h) => h.toLowerCase())
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)))
  const iDate = col('date'), iRef = col('ref', 'receipt', 'transaction id', 'code'), iAmt = col('amount', 'credit', 'paid in'), iDesc = col('desc', 'detail', 'narr')
  return lines.slice(1).map(split).map((c) => ({
    date: (c[iDate] ?? '').slice(0, 10),
    reference: iRef >= 0 ? c[iRef] ?? '' : '',
    amount: Number((c[iAmt] ?? '0').replace(/[^0-9.-]/g, '')),
    description: iDesc >= 0 ? c[iDesc] ?? '' : '',
  })).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.amount)
}

function ReconciliationTab() {
  const loadReconciliation = useStore((s) => s.loadReconciliation)
  const importStatement = useStore((s) => s.importStatement)
  const rematchStatement = useStore((s) => s.rematchStatement)
  const statementLineAction = useStore((s) => s.statementLineAction)
  const repayments = useStore((s) => s.repayments)
  const loans = useStore((s) => s.loans)
  const borrowers = useStore((s) => s.borrowers)
  const currency = useStore((s) => s.lender.currency)
  const canEdit = useCanEdit()
  const [source, setSource] = useState<StatementSource>('bank')
  const [data, setData] = useState<ReconciliationData | null>(null)
  const [matching, setMatching] = useState<StatementLine | null>(null)
  const [ignoring, setIgnoring] = useState<StatementLine | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const money = (n: number) => formatMoney(n, currency)

  const reload = useCallback(() => {
    loadReconciliation(source).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Could not load'))
  }, [loadReconciliation, source])
  useEffect(reload, [reload, repayments])

  const channels: Record<StatementSource, string[]> = { bank: ['bank', 'other'], mobile_money: ['mobile_money'], cash: ['cash', 'field'] }
  const open = repayments.filter((r) => !r.reversed && r.reconciliationStatus === 'unreconciled' && channels[source].includes(r.channel))
  const describe = (r: Repayment) => {
    const loan = loans.find((l) => l.id === r.loanId)
    return `${r.receiptNumber} · ${borrowers.find((b) => b.id === loan?.borrowerId)?.fullName ?? ''} · ${formatDate(r.paymentDate)} · ${r.reference || 'no ref'}`
  }
  const latest = data?.summary.latestStatementDate
  const s = data?.summary

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {SOURCES.map((x) => (
          <button
            key={x.id}
            onClick={() => setSource(x.id)}
            className={clsx('rounded-full px-3 py-1.5 text-xs font-semibold', source === x.id ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200')}
          >
            {x.label}
          </button>
        ))}
        <span className="text-xs text-slate-500">{SOURCES.find((x) => x.id === source)?.hint}</span>
      </div>

      {s && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Recorded payments" value={money(s.recordedAmount)} hint={`${s.recordedCount} payment(s)`} tone="brand" />
          <StatTile label="Reconciled" value={money(s.reconciledAmount)} hint={`${s.reconciledCount} matched to money received`} tone="green" />
          <StatTile
            label="Not on statement"
            value={money(s.missingFromStatementAmount)}
            hint={latest ? `${s.missingFromStatementCount} recorded but not seen by ${formatDate(latest)}` : 'Import a statement to check'}
            tone={s.missingFromStatementCount ? 'red' : 'green'}
          />
          <StatTile
            label="Money not posted"
            value={money(s.statementUnmatchedAmount)}
            hint={`${s.statementUnmatchedCount} statement line(s) without a payment`}
            tone={s.statementUnmatchedCount ? 'amber' : 'green'}
          />
        </div>
      )}

      {canEdit && source !== 'cash' && (
        <Card>
          <CardHeader title="Import statement" subtitle="CSV with columns: date (YYYY-MM-DD), reference, amount, description. Debits are skipped." />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
              <Upload size={14} /> Choose CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  setError(null)
                  const rows = parseStatement(await f.text())
                  if (!rows.length) return setError('No usable lines found. Check the columns and date format.')
                  try {
                    await importStatement(source, rows)
                    reload()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Import failed')
                  }
                }}
              />
            </label>
            <Button variant="secondary" size="sm" icon={<Download size={13} />} onClick={() => downloadCSV('statement-template.csv', ['date', 'reference', 'amount', 'description'], [[new Date().toISOString().slice(0, 10), 'NMB123456', 150000, 'Deposit']])}>
              Template
            </Button>
            <Button variant="secondary" size="sm" icon={<RefreshCw size={13} />} onClick={async () => { await rematchStatement(source); reload() }}>
              Re-run matching
            </Button>
          </div>
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Statement lines" subtitle="Money that actually arrived" />
          <Table
            rowKey={(l) => l.id}
            rows={data?.lines ?? []}
            pageSize={10}
            emptyMessage="No statement imported yet."
            columns={[
              { header: 'Date', cell: (l) => formatDate(l.date) },
              { header: 'Reference', cell: (l) => <span className="font-mono text-xs">{l.reference || l.description || '—'}</span> },
              { header: 'Amount', cell: (l) => money(l.amount) },
              {
                header: 'Status',
                cell: (l) => (
                  <Badge tone={l.status === 'matched' ? 'green' : l.status === 'ignored' ? 'slate' : 'amber'}>
                    {l.status === 'matched' ? `Matched${l.groupPaymentId ? ' (group)' : ''}` : l.status === 'ignored' ? 'Not a repayment' : 'Unmatched'}
                  </Badge>
                ),
              },
              {
                header: '',
                cell: (l) =>
                  canEdit && (
                    <span className="flex gap-2 text-xs font-medium">
                      {l.status === 'unmatched' && <button className="text-brand-700 hover:underline" onClick={() => setMatching(l)}>Match</button>}
                      {l.status === 'unmatched' && <button className="text-slate-500 hover:underline" onClick={() => { setNote(''); setIgnoring(l) }}>Ignore</button>}
                      {l.status !== 'unmatched' && (
                        <button className="text-slate-500 hover:underline" onClick={async () => { await statementLineAction(l.id, 'unmatch'); reload() }}>Undo</button>
                      )}
                    </span>
                  ),
              },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Recorded, not yet reconciled" subtitle="Payments in the system without matching money yet" />
          <Table
            rowKey={(r) => r.id}
            rows={open}
            pageSize={10}
            emptyMessage="Everything recorded has been reconciled."
            columns={[
              { header: 'Receipt', cell: (r) => <span className="font-mono text-xs">{r.receiptNumber}</span> },
              { header: 'Date', cell: (r) => formatDate(r.paymentDate) },
              { header: 'Reference', cell: (r) => r.reference || '—' },
              { header: 'Amount', cell: (r) => money(r.amount) },
              {
                header: '',
                cell: (r) =>
                  latest && (Date.parse(latest) - Date.parse(r.paymentDate)) / 864e5 > 3 ? <Badge tone="red">Not on statement</Badge> : <Badge tone="amber">Waiting</Badge>,
              },
            ]}
          />
        </Card>
      </div>

      <Modal open={!!matching} onClose={() => setMatching(null)} title="Match statement line">
        {matching && (
          <div className="space-y-3 text-sm">
            <p className="text-slate-600">
              {formatDate(matching.date)} · {matching.reference || matching.description} · <b>{money(matching.amount)}</b>
            </p>
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {open.filter((r) => Math.abs(r.amount - matching.amount) < 0.01).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="text-xs text-slate-700">{describe(r)}</span>
                  <Button size="sm" onClick={async () => { await statementLineAction(matching.id, 'match', { repaymentId: r.id }); setMatching(null); reload() }}>
                    Match
                  </Button>
                </li>
              ))}
              {open.filter((r) => Math.abs(r.amount - matching.amount) < 0.01).length === 0 && (
                <li className="px-3 py-3 text-xs text-slate-500">
                  No unreconciled payment of this amount. If the borrower paid but it wasn't recorded, record the payment first, or
                  correct a payment keyed with the wrong amount.
                </li>
              )}
            </ul>
          </div>
        )}
      </Modal>
      <Modal open={!!ignoring} onClose={() => setIgnoring(null)} title="Not a loan repayment">
        <div className="space-y-3">
          <Field label="What is this money?" hint="e.g. savings deposit, bank interest, transfer between accounts">
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button className="w-full" disabled={!note.trim()} onClick={async () => { await statementLineAction(ignoring!.id, 'ignore', { note }); setIgnoring(null); reload() }}>
            Mark as not a repayment
          </Button>
        </div>
      </Modal>
    </div>
  )
}
