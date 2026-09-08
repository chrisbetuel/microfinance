import { useMemo, useState } from 'react'
import { Download, Layers } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Tabs } from '../../components/ui/Tabs'
import { Table } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { BorrowerLink } from '../../components/ui/BorrowerLink'
import { Field, inputClass } from '../../components/ui/Field'
import type { Application, DisbursementChannel } from '../../types'
import { formatDateTime, formatMoney } from '../../lib/format'
import { totalFeeAmount } from '../../lib/loanMath'
import { useCanEdit } from '../../lib/useCanEdit'
import { downloadCSV } from '../../lib/csv'

const channelLabels: Record<DisbursementChannel, string> = {
  mobile_money: 'Mobile money',
  bank_transfer: 'Bank transfer',
  supplier: 'Direct to supplier',
  cash: 'Cash',
}

const tabs = [
  { id: 'queue', label: 'Awaiting disbursement' },
  { id: 'register', label: 'Disbursement register' },
]

export default function DisbursementQueue() {
  const [tab, setTab] = useState('queue')
  const allApplications = useStore((s) => s.applications)
  const applications = useMemo(() => allApplications.filter((a) => a.status === 'approved'), [allApplications])
  const borrowers = useStore((s) => s.borrowers)
  const products = useStore((s) => s.products)
  const lender = useStore((s) => s.lender)
  const disburseLoan = useStore((s) => s.disburseLoan)
  const disburseBatch = useStore((s) => s.disburseBatch)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const staff = useStore((s) => s.staff)
  const loans = useStore((s) => s.loans)
  const canEdit = useCanEdit()

  const [active, setActive] = useState<Application | null>(null)
  const [channel, setChannel] = useState<DisbursementChannel>('mobile_money')
  const [reference, setReference] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchOpen, setBatchOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const currentStaff = staff.find((s) => s.id === currentStaffId)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectableIds = applications
    .filter((a) => (a.approvals.at(-1)?.approverName ?? '') !== currentStaff?.name)
    .map((a) => a.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))
  const selectedApps = applications.filter((a) => selected.has(a.id))
  const selectedTotal = selectedApps.reduce((s, a) => s + a.amount, 0)

  function downloadPaymentFile() {
    downloadCSV(
      `disbursement-queue-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Reference', 'Borrower', 'Phone', 'Product', 'Approved amount', 'Approved by'],
      applications.map((a) => {
        const b = borrowers.find((x) => x.id === a.borrowerId)
        return [
          a.reference,
          b?.fullName ?? '',
          b?.phone ?? '',
          products.find((p) => p.id === a.productId)?.name ?? '',
          a.amount,
          a.approvals.at(-1)?.approverName ?? '',
        ]
      }),
    )
  }

  return (
    <div>
      <PageHeader
        title="Disbursement"
        subtitle="Every shilling traceable to an approval and a destination"
        action={
          tab === 'queue' && applications.length > 0 ? (
            <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={downloadPaymentFile}>
              Payment file
            </Button>
          ) : undefined
        }
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="mt-6">
        {tab === 'queue' && (
          <>
            {canEdit && selected.size > 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5">
                <p className="text-sm font-medium text-brand-800">
                  {selected.size} selected · {formatMoney(selectedTotal, lender.currency)}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                  <Button size="sm" icon={<Layers size={14} />} onClick={() => setBatchOpen(true)}>
                    Disburse selected
                  </Button>
                </div>
              </div>
            )}
            <Table
              rowKey={(a) => a.id}
              rows={applications}
              columns={[
                ...(canEdit
                  ? [
                      {
                        header: '',
                        className: 'w-10',
                        cell: (a: Application) => {
                          const disqualified = (a.approvals.at(-1)?.approverName ?? '') === currentStaff?.name
                          return (
                            <input
                              type="checkbox"
                              disabled={disqualified}
                              checked={selected.has(a.id)}
                              onChange={() => toggle(a.id)}
                              title={disqualified ? 'You approved this loan — someone else must release it' : ''}
                            />
                          )
                        },
                      },
                    ]
                  : []),
                { header: 'Reference', cell: (a) => a.reference },
                { header: 'Borrower', cell: (a) => <BorrowerLink id={a.borrowerId} borrowers={borrowers} /> },
                { header: 'Product', cell: (a) => products.find((p) => p.id === a.productId)?.name },
                { header: 'Amount', cell: (a) => formatMoney(a.amount, lender.currency), sort: (a) => a.amount },
                { header: 'Approved by', cell: (a) => a.approvals.at(-1)?.approverName ?? '—' },
                {
                  header: '',
                  cell: (a) =>
                    canEdit && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setActive(a)
                          setReference(`REF-${Date.now().toString().slice(-6)}`)
                        }}
                      >
                        Disburse
                      </Button>
                    ),
                },
              ]}
            />
            {canEdit && selectableIds.length > 0 && (
              <button
                onClick={() => setSelected(allSelected ? new Set() : new Set(selectableIds))}
                className="mt-2 text-xs font-medium text-brand-600 hover:underline"
              >
                {allSelected ? 'Deselect all' : `Select all ${selectableIds.length} eligible`}
              </button>
            )}
          </>
        )}

        {tab === 'register' && (
          <Table
            rowKey={(l) => l.id}
            rows={loans.filter((l) => l.disbursement)}
            columns={[
              { header: 'Loan', cell: (l) => l.id.slice(0, 8) },
              { header: 'Borrower', cell: (l) => <BorrowerLink id={l.borrowerId} borrowers={borrowers} /> },
              { header: 'Net disbursed', cell: (l) => formatMoney(l.netDisbursed, lender.currency) },
              { header: 'Channel', cell: (l) => channelLabels[l.disbursement!.channel] },
              { header: 'Reference', cell: (l) => l.disbursement!.reference },
              { header: 'Date', cell: (l) => formatDateTime(l.disbursement!.date) },
              { header: 'Approved / Disbursed by', cell: (l) => `${l.disbursement!.approvedBy} / ${l.disbursement!.disbursedBy}` },
            ]}
          />
        )}
      </div>

      <Modal open={batchOpen} onClose={() => setBatchOpen(false)} title={`Batch disbursement — ${selectedApps.length} loans`} wide>
        <BatchDisburseForm
          apps={selectedApps}
          total={selectedTotal}
          currency={lender.currency}
          busy={busy}
          borrowerName={(id) => borrowers.find((b) => b.id === id)?.fullName ?? '—'}
          onConfirm={async (batchChannel, prefix) => {
            setBusy(true)
            try {
              const res = await disburseBatch(
                selectedApps.map((a, i) => ({
                  applicationId: a.id,
                  channel: batchChannel,
                  reference: `${prefix}-${String(i + 1).padStart(3, '0')}`,
                })),
              )
              setSelected(new Set())
              setBatchOpen(false)
              void res
            } finally {
              setBusy(false)
            }
          }}
        />
      </Modal>

      <Modal open={active !== null} onClose={() => setActive(null)} title="Confirm disbursement">
        {active && (
          <DisburseForm
            application={active}
            currentStaffName={currentStaff?.name ?? ''}
            approverName={active.approvals.at(-1)?.approverName ?? ''}
            channel={channel}
            setChannel={setChannel}
            reference={reference}
            setReference={setReference}
            onConfirm={async () => {
              await disburseLoan(active.id, channel, reference)
              setActive(null)
            }}
          />
        )}
      </Modal>
    </div>
  )
}

function BatchDisburseForm({
  apps,
  total,
  currency,
  busy,
  borrowerName,
  onConfirm,
}: {
  apps: Application[]
  total: number
  currency: string
  busy: boolean
  borrowerName: (id: string) => string
  onConfirm: (channel: DisbursementChannel, referencePrefix: string) => void
}) {
  const [channel, setChannel] = useState<DisbursementChannel>('bank_transfer')
  const [prefix, setPrefix] = useState(`BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`)

  return (
    <div className="space-y-4">
      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {apps.map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2">{a.reference}</td>
                <td className="px-3 py-2 text-slate-600">{borrowerName(a.borrowerId)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatMoney(a.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-200 bg-slate-50">
            <tr>
              <td className="px-3 py-2 font-semibold" colSpan={2}>
                Total ({apps.length} loans)
              </td>
              <td className="px-3 py-2 text-right font-bold">{formatMoney(total, currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Channel — applied to all">
          <select className={inputClass} value={channel} onChange={(e) => setChannel(e.target.value as DisbursementChannel)}>
            <option value="bank_transfer">Bank transfer</option>
            <option value="mobile_money">Mobile money</option>
            <option value="cash">Cash</option>
            <option value="supplier">Direct to supplier</option>
          </select>
        </Field>
        <Field label="Reference prefix" hint="Each loan gets prefix-001, -002…">
          <input className={inputClass} value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </Field>
      </div>

      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Loans you approved yourself are excluded — the approver and the person releasing funds must differ.
      </p>

      <Button className="w-full" disabled={busy || !prefix.trim()} onClick={() => onConfirm(channel, prefix.trim())}>
        {busy ? 'Releasing…' : `Release ${apps.length} loans`}
      </Button>
    </div>
  )
}

function DisburseForm({
  application,
  currentStaffName,
  approverName,
  channel,
  setChannel,
  reference,
  setReference,
  onConfirm,
}: {
  application: Application
  currentStaffName: string
  approverName: string
  channel: DisbursementChannel
  setChannel: (c: DisbursementChannel) => void
  reference: string
  setReference: (r: string) => void
  onConfirm: () => void
}) {
  const products = useStore((s) => s.products)
  const lender = useStore((s) => s.lender)
  const product = products.find((p) => p.id === application.productId)
  const sameDoer = currentStaffName === approverName
  const feesDeducted = product ? totalFeeAmount(product, application.amount, 'deducted') : 0
  const savingsDeducted = product ? (application.amount * (product.compulsorySavingsPercent || 0)) / 100 : 0
  const net = application.amount - feesDeducted - savingsDeducted

  return (
    <div className="space-y-4">
      {sameDoer && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          The approver and the person releasing funds must be different people. Switch to another staff account to disburse this
          loan.
        </div>
      )}
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-slate-400">Approved amount</dt>
        <dd className="text-right font-medium">{formatMoney(application.amount, lender.currency)}</dd>
        <dt className="text-slate-400">Fees deducted</dt>
        <dd className="text-right font-medium">{formatMoney(feesDeducted, lender.currency)}</dd>
        {savingsDeducted > 0 && (
          <>
            <dt className="text-slate-400">Compulsory savings</dt>
            <dd className="text-right font-medium">{formatMoney(savingsDeducted, lender.currency)}</dd>
          </>
        )}
        <dt className="text-slate-400">Borrower receives</dt>
        <dd className="text-right font-semibold text-emerald-700">{formatMoney(net, lender.currency)}</dd>
      </dl>

      <Field label="Disbursement channel">
        <select className={inputClass} value={channel} onChange={(e) => setChannel(e.target.value as DisbursementChannel)}>
          <option value="mobile_money">Mobile money</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="supplier">Direct to supplier</option>
          <option value="cash">Cash</option>
        </select>
      </Field>
      <Field label="Reference / transaction number">
        <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
      </Field>

      <Button className="w-full" disabled={sameDoer} onClick={onConfirm}>
        Confirm and disburse
      </Button>
    </div>
  )
}
