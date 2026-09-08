import { useMemo, useState } from 'react'
import {
  Phone,
  MapPin,
  MessageSquare,
  StickyNote,
  HandCoins,
  Send,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatTile } from '../../components/ui/StatTile'
import { Table } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Field, inputClass } from '../../components/ui/Field'
import { BorrowerLink } from '../../components/ui/BorrowerLink'
import { formatMoney, formatDateTime } from '../../lib/format'
import { buildArrearsBook, type ArrearsRow } from '../../lib/collections'
import { useCanEdit } from '../../lib/useCanEdit'
import type { CollectionActivityKind, CollectionOutcome } from '../../types'

const kindIcon: Record<CollectionActivityKind, typeof Phone> = {
  call: Phone,
  visit: MapPin,
  message: MessageSquare,
  note: StickyNote,
  promise: HandCoins,
}

const promiseTone = { kept: 'green', broken: 'red', pending: 'amber' } as const

export default function Collections() {
  const loans = useStore((s) => s.loans)
  const borrowers = useStore((s) => s.borrowers)
  const branches = useStore((s) => s.branches)
  const staff = useStore((s) => s.staff)
  const activities = useStore((s) => s.collectionActivities)
  const lender = useStore((s) => s.lender)
  const logActivity = useStore((s) => s.logCollectionActivity)
  const sendReminder = useStore((s) => s.sendLoanReminder)
  const canEdit = useCanEdit()

  const [openLoanId, setOpenLoanId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo(
    () => buildArrearsBook(loans, borrowers, branches, staff, activities),
    [loans, borrowers, branches, staff, activities],
  )

  const totalArrears = rows.reduce((s, r) => s + r.arrears, 0)
  const atRisk = rows.reduce((s, r) => s + r.outstanding, 0)
  const promisesOpen = activities.filter((a) => a.promiseStatus === 'pending').length
  const active = openLoanId ? rows.find((r) => r.loan.id === openLoanId) : undefined

  return (
    <div>
      <PageHeader title="Collections" subtitle="Work the overdue book — contact, promise-to-pay, escalate" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Loans in arrears" value={rows.length.toString()} icon={<AlertTriangle size={16} />} tone="red" />
        <StatTile label="Arrears due" value={formatMoney(totalArrears, lender.currency)} tone="amber" />
        <StatTile label="Outstanding at risk" value={formatMoney(atRisk, lender.currency)} tone="brand" />
        <StatTile label="Open promises" value={promisesOpen.toString()} icon={<HandCoins size={16} />} tone="brand" />
      </div>

      <Table
        rowKey={(r) => r.loan.id}
        rows={rows}
        onRowClick={(r) => setOpenLoanId(r.loan.id)}
        pageSize={20}
        emptyMessage="No loans are in arrears. Nice."
        filterPlaceholder="Filter by borrower, branch or officer"
        filterAccessor={(r) => `${r.borrower?.fullName ?? ''} ${r.branchName} ${r.officerName}`}
        columns={[
          {
            header: 'Borrower',
            cell: (r) => <BorrowerLink id={r.loan.borrowerId} borrowers={borrowers} />,
            sort: (r) => r.borrower?.fullName ?? '',
          },
          { header: 'Branch', cell: (r) => r.branchName },
          { header: 'Officer', cell: (r) => r.officerName },
          {
            header: 'Days late',
            cell: (r) => <span className="font-semibold text-accent-700">{r.days}</span>,
            sort: (r) => r.days,
          },
          { header: 'Arrears', cell: (r) => formatMoney(r.arrears, lender.currency), sort: (r) => r.arrears },
          { header: 'Outstanding', cell: (r) => formatMoney(r.outstanding, lender.currency), sort: (r) => r.outstanding },
          {
            header: 'Last contact',
            cell: (r) => (r.lastActivity ? formatDateTime(r.lastActivity.createdAt) : <span className="text-slate-400">—</span>),
            sort: (r) => r.lastActivity?.createdAt ?? '',
          },
          {
            header: 'Promise',
            cell: (r) =>
              r.openPromise ? (
                <Badge tone="amber">
                  {formatMoney(r.openPromise.promisedAmount ?? 0, lender.currency)} by{' '}
                  {r.openPromise.promisedDate ?? '—'}
                </Badge>
              ) : r.brokenPromises > 0 ? (
                <Badge tone="red">{r.brokenPromises} broken</Badge>
              ) : (
                <span className="text-slate-400">—</span>
              ),
          },
        ]}
      />

      <Modal open={!!active} onClose={() => setOpenLoanId(null)} title="Collections — loan detail" wide>
        {active && (
          <LoanCollectionPanel
            row={active}
            activities={activities.filter((a) => a.loanId === active.loan.id)}
            currency={lender.currency}
            canEdit={canEdit}
            busy={busy}
            onLog={async (input) => {
              setBusy(true)
              try {
                await logActivity(active.loan.id, input)
              } finally {
                setBusy(false)
              }
            }}
            onRemind={async () => {
              setBusy(true)
              try {
                await sendReminder(active.loan.id)
              } finally {
                setBusy(false)
              }
            }}
          />
        )}
      </Modal>
    </div>
  )
}

function LoanCollectionPanel({
  row,
  activities,
  currency,
  canEdit,
  busy,
  onLog,
  onRemind,
}: {
  row: ArrearsRow
  activities: import('../../types').CollectionActivity[]
  currency: string
  canEdit: boolean
  busy: boolean
  onLog: (input: {
    kind: CollectionActivityKind
    outcome?: CollectionOutcome
    note?: string
    promisedAmount?: number | null
    promisedDate?: string | null
  }) => Promise<void>
  onRemind: () => Promise<void>
}) {
  const [kind, setKind] = useState<CollectionActivityKind>('call')
  const [outcome, setOutcome] = useState<CollectionOutcome>('reached')
  const [note, setNote] = useState('')
  const [promisedAmount, setPromisedAmount] = useState('')
  const [promisedDate, setPromisedDate] = useState('')

  const timeline = activities.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  async function submit() {
    await onLog({
      kind,
      outcome: kind === 'promise' ? 'promised' : outcome,
      note: note.trim(),
      promisedAmount: kind === 'promise' ? Number(promisedAmount) || null : null,
      promisedDate: kind === 'promise' ? promisedDate || null : null,
    })
    setNote('')
    setPromisedAmount('')
    setPromisedDate('')
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200/70">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-900">{row.borrower?.fullName}</p>
            <p className="text-xs text-slate-500">
              {row.borrower?.phone} · {row.branchName} · Officer {row.officerName}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-accent-700">{row.days} days late</p>
            <p className="text-xs text-slate-500">
              {formatMoney(row.arrears, currency)} in arrears · {formatMoney(row.outstanding, currency)} outstanding
            </p>
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Log an action</p>
            <Button size="sm" variant="secondary" icon={<Send size={13} />} onClick={onRemind} disabled={busy}>
              Send SMS reminder
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(['call', 'visit', 'message', 'note', 'promise'] as CollectionActivityKind[]).map((k) => {
              const Icon = kindIcon[k]
              return (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium capitalize ${
                    kind === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Icon size={13} />
                  {k === 'promise' ? 'Promise to pay' : k}
                </button>
              )
            })}
          </div>

          {kind === 'promise' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Promised amount">
                <input
                  type="number"
                  className={inputClass}
                  value={promisedAmount}
                  onChange={(e) => setPromisedAmount(e.target.value)}
                />
              </Field>
              <Field label="Promised by">
                <input
                  type="date"
                  className={inputClass}
                  value={promisedDate}
                  onChange={(e) => setPromisedDate(e.target.value)}
                />
              </Field>
            </div>
          ) : (
            <Field label="Outcome">
              <select className={inputClass} value={outcome} onChange={(e) => setOutcome(e.target.value as CollectionOutcome)}>
                <option value="reached">Reached borrower</option>
                <option value="no_answer">No answer</option>
                <option value="disputed">Amount disputed</option>
                <option value="paid">Paid on the spot</option>
                <option value="other">Other</option>
              </select>
            </Field>
          )}

          <Field label="Note">
            <textarea
              rows={2}
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was said, next step…"
            />
          </Field>

          <Button
            size="sm"
            onClick={submit}
            disabled={busy || (kind === 'promise' && !promisedAmount)}
          >
            {kind === 'promise' ? 'Record promise' : 'Log contact'}
          </Button>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-800">Activity timeline</p>
        {timeline.length === 0 && <p className="text-sm text-slate-400">No activity logged yet.</p>}
        <ul className="space-y-2.5">
          {timeline.map((a) => {
            const Icon = kindIcon[a.kind]
            return (
              <li key={a.id} className="flex gap-3 rounded-lg border border-slate-100 p-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Icon size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium capitalize text-slate-800">
                      {a.kind === 'promise' ? 'Promise to pay' : a.kind}
                    </span>
                    {a.kind === 'promise' && a.promiseStatus && (
                      <Badge tone={promiseTone[a.promiseStatus]} dot>
                        {a.promiseStatus === 'kept' && <CheckCircle2 size={11} />}
                        {a.promiseStatus === 'broken' && <AlertTriangle size={11} />}
                        {a.promiseStatus === 'pending' && <Clock size={11} />}
                        {a.promiseStatus}
                      </Badge>
                    )}
                    <span className="text-xs text-slate-400">
                      {formatDateTime(a.createdAt)} · {a.createdBy}
                    </span>
                  </div>
                  {a.kind === 'promise' && a.promisedAmount != null && (
                    <p className="text-xs text-slate-600">
                      {formatMoney(a.promisedAmount, currency)}
                      {a.promisedDate ? ` by ${a.promisedDate}` : ''}
                    </p>
                  )}
                  {a.note && <p className="mt-0.5 text-xs text-slate-500">{a.note}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
