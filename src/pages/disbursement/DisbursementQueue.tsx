import { useMemo, useState } from 'react'
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
  const currentStaffId = useStore((s) => s.currentStaffId)
  const staff = useStore((s) => s.staff)
  const loans = useStore((s) => s.loans)
  const canEdit = useCanEdit()

  const [active, setActive] = useState<Application | null>(null)
  const [channel, setChannel] = useState<DisbursementChannel>('mobile_money')
  const [reference, setReference] = useState('')

  const currentStaff = staff.find((s) => s.id === currentStaffId)

  return (
    <div>
      <PageHeader title="Disbursement" subtitle="Every shilling traceable to an approval and a destination" />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="mt-6">
        {tab === 'queue' && (
          <Table
            rowKey={(a) => a.id}
            rows={applications}
            columns={[
              { header: 'Reference', cell: (a) => a.reference },
              { header: 'Borrower', cell: (a) => <BorrowerLink id={a.borrowerId} borrowers={borrowers} /> },
              { header: 'Product', cell: (a) => products.find((p) => p.id === a.productId)?.name },
              { header: 'Amount', cell: (a) => formatMoney(a.amount, lender.currency) },
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
  const net = application.amount - feesDeducted

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
