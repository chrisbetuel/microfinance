import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Download, Scale } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Tabs } from '../../components/ui/Tabs'
import { Table } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import { StatTile } from '../../components/ui/StatTile'
import { formatDate, formatDateTime, formatMoney } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'
import { downloadCSV } from '../../lib/csv'
import type { Disbursement, LedgerData } from '../../types'
import { DISB_STATUS_LABEL, DISB_STATUS_TONE, METHOD_LABEL } from './disbursementParts'

const OPEN = ['pending', 'under_verification', 'approved', 'processing']

const NEXT_STEP: Record<string, (d: Disbursement) => string> = {
  pending: () => 'Send for verification',
  under_verification: (d) =>
    !d.verifiedById ? 'Verify (not the preparer)' : d.requiresDualAuthorisation && d.authorisedById ? 'Second authorisation' : 'Authorise',
  approved: () => 'Release money',
  processing: (d) => (d.method === 'mobile_money' ? 'Awaiting gateway confirmation' : 'Confirm transaction'),
}

export default function DisbursementQueue() {
  const navigate = useNavigate()
  const canEdit = useCanEdit()
  const applications = useStore((s) => s.applications)
  const disbursements = useStore((s) => s.disbursements)
  const borrowers = useStore((s) => s.borrowers)
  const products = useStore((s) => s.products)
  const currency = useStore((s) => s.lender.currency)
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem('lms-disb-tab') || 'ready'
    } catch {
      return 'ready'
    }
  })
  const choose = (t: string) => {
    setTab(t)
    try {
      localStorage.setItem('lms-disb-tab', t)
    } catch {
      /* storage unavailable */
    }
  }
  const money = (n: number) => formatMoney(n, currency)

  const ready = useMemo(
    () => applications.filter((a) => a.status === 'approved' && !disbursements.some((d) => d.applicationId === a.id && OPEN.includes(d.status))),
    [applications, disbursements],
  )
  const inProgress = disbursements.filter((d) => OPEN.includes(d.status))
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const thisMonth = disbursements.filter((d) => d.status === 'successful' && d.confirmedAt && new Date(d.confirmedAt) >= monthStart)

  const tabs = [
    { id: 'ready', label: `Ready to prepare (${ready.length})` },
    { id: 'progress', label: `In progress (${inProgress.length})` },
    { id: 'register', label: 'Disbursement register' },
    { id: 'ledger', label: 'Ledger & reconciliation' },
  ]

  return (
    <div>
      <PageHeader
        title="Disbursement"
        subtitle="An approved loan is not a disbursed loan: prepare → verify → authorise → release → confirm"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Approved, not prepared" value={String(ready.length)} hint={money(ready.reduce((s, a) => s + a.amount, 0))} tone="brand" />
        <StatTile
          label="Awaiting verification / authorisation"
          value={String(inProgress.filter((d) => d.status === 'pending' || d.status === 'under_verification').length)}
          tone="amber"
        />
        <StatTile
          label="Authorised / in transit"
          value={String(inProgress.filter((d) => d.status === 'approved' || d.status === 'processing').length)}
          hint={money(inProgress.filter((d) => d.status === 'approved' || d.status === 'processing').reduce((s, d) => s + d.netAmount, 0))}
          tone="brand"
        />
        <StatTile label="Disbursed this month" value={money(thisMonth.reduce((s, d) => s + d.netAmount, 0))} hint={`${thisMonth.length} loan(s) net`} tone="green" />
      </div>

      <Tabs tabs={tabs} active={tab} onChange={choose} />
      <div className="mt-4">
        {tab === 'ready' && (
          <Table
            rowKey={(a) => a.id}
            rows={ready}
            emptyMessage="No approved applications waiting."
            onRowClick={(a) => navigate(`/applications/${a.id}`)}
            columns={[
              { header: 'Application', cell: (a) => <span className="font-medium text-slate-800">{a.reference}</span> },
              { header: 'Borrower', cell: (a) => borrowers.find((b) => b.id === a.borrowerId)?.fullName ?? '—' },
              { header: 'Product', cell: (a) => products.find((p) => p.id === a.productId)?.name ?? '—' },
              { header: 'Approved amount', cell: (a) => money(a.amount), sort: (a) => a.amount },
              { header: 'Approved', cell: (a) => { const ap = a.approvals.filter((x) => x.decision === 'approved').at(-1); return ap ? `${formatDate(ap.date)} · ${ap.approverName}` : '—' } },
              { header: 'Preferred method', cell: (a) => (a.disbursementMethod ? METHOD_LABEL[a.disbursementMethod] : '—') },
              {
                header: '',
                cell: (a) =>
                  canEdit && (
                    <Button size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/disbursement/prepare/${a.id}`) }}>
                      Prepare
                    </Button>
                  ),
              },
            ]}
          />
        )}

        {tab === 'progress' && (
          <Table
            rowKey={(d) => d.id}
            rows={inProgress}
            emptyMessage="Nothing in progress."
            onRowClick={(d) => navigate(`/disbursement/${d.id}`)}
            columns={[
              { header: 'ID', cell: (d) => <span className="font-mono text-xs">{d.number}</span> },
              { header: 'Borrower', cell: (d) => d.borrowerName },
              { header: 'Net amount', cell: (d) => money(d.netAmount), sort: (d) => d.netAmount },
              { header: 'Method', cell: (d) => METHOD_LABEL[d.method] },
              { header: 'Prepared', cell: (d) => `${formatDate(d.preparedAt)} · ${d.staffNames.preparedBy}` },
              {
                header: 'Status',
                cell: (d) => (
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge tone={DISB_STATUS_TONE[d.status]} dot>{DISB_STATUS_LABEL[d.status]}</Badge>
                    {d.requiresDualAuthorisation && <Badge tone="blue">2 authorisers</Badge>}
                    {d.warnings.length > 0 && <Badge tone="amber">{d.warnings.length} warning(s)</Badge>}
                  </span>
                ),
              },
              { header: 'Next step', cell: (d) => <span className="text-xs font-medium text-brand-700">{NEXT_STEP[d.status]?.(d)}</span> },
            ]}
          />
        )}

        {tab === 'register' && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                icon={<Download size={14} />}
                onClick={() =>
                  downloadCSV(
                    `disbursement-register-${new Date().toISOString().slice(0, 10)}.csv`,
                    ['Disbursement', 'Loan', 'Application', 'Borrower', 'Approved', 'Deductions', 'Net', 'Method', 'Reference', 'Prepared by', 'Authorised by', 'Processed by', 'Date', 'Status'],
                    disbursements.map((d) => [
                      d.number, d.loanNumber ?? '', d.applicationReference, d.borrowerName, d.approvedAmount,
                      d.approvedAmount - d.netAmount, d.netAmount, METHOD_LABEL[d.method], d.transactionReference,
                      d.staffNames.preparedBy, [d.staffNames.authorisedBy, d.staffNames.secondAuthorisedBy].filter(Boolean).join(' + '),
                      d.staffNames.processedBy, d.confirmedAt ?? d.preparedAt, DISB_STATUS_LABEL[d.status],
                    ]),
                  )
                }
              >
                Export CSV
              </Button>
            </div>
            <Table
              rowKey={(d) => d.id}
              rows={disbursements}
              pageSize={15}
              filterPlaceholder="Filter by ID, loan, borrower or reference"
              filterAccessor={(d) => `${d.number} ${d.loanNumber ?? ''} ${d.borrowerName} ${d.transactionReference}`}
              onRowClick={(d) => navigate(`/disbursement/${d.id}`)}
              columns={[
                { header: 'ID', cell: (d) => <span className="font-mono text-xs">{d.number}</span>, sort: (d) => d.number },
                { header: 'Loan', cell: (d) => <span className="font-mono text-xs">{d.loanNumber ?? '—'}</span> },
                { header: 'Borrower', cell: (d) => d.borrowerName },
                { header: 'Amount', cell: (d) => money(d.approvedAmount), sort: (d) => d.approvedAmount },
                { header: 'Net', cell: (d) => money(d.netAmount), sort: (d) => d.netAmount },
                { header: 'Method', cell: (d) => METHOD_LABEL[d.method] },
                { header: 'Reference', cell: (d) => d.transactionReference || '—' },
                { header: 'Date', cell: (d) => formatDateTime(d.confirmedAt ?? d.preparedAt), sort: (d) => d.confirmedAt ?? d.preparedAt },
                { header: 'Status', cell: (d) => <Badge tone={DISB_STATUS_TONE[d.status]}>{DISB_STATUS_LABEL[d.status]}</Badge>, sort: (d) => d.status },
              ]}
            />
          </div>
        )}

        {tab === 'ledger' && <LedgerPanel />}
      </div>
    </div>
  )
}

function LedgerPanel() {
  const loadLedger = useStore((s) => s.loadLedger)
  const disbursements = useStore((s) => s.disbursements)
  const currency = useStore((s) => s.lender.currency)
  const [data, setData] = useState<LedgerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadLedger().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Could not load the ledger'))
  }, [loadLedger, disbursements])
  const money = (n: number) => formatMoney(n, currency)
  if (error) return <p className="text-sm text-red-700">{error}</p>
  if (!data) return <p className="text-sm text-slate-400">Loading ledger…</p>
  const r = data.reconciliation
  const flow = [
    ['Approved, awaiting disbursement', r.approvedAwaitingDisbursement],
    ['Disbursed principal', r.disbursedPrincipal],
    ['Repaid principal', r.repaidPrincipal],
    ['Written off', r.writtenOffPrincipal],
    ['Outstanding (ledger)', r.outstandingPrincipalLedger],
  ] as const
  const balanced = Math.abs(r.difference) < 0.01
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Reconciliation"
          subtitle="Approved → Disbursed → Repaid → Outstanding, from ledger postings"
          action={<Badge tone={balanced ? 'green' : 'red'} dot>{balanced ? 'Ledger agrees with loan records' : `Difference ${money(r.difference)}`}</Badge>}
        />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {flow.map(([k, v], i) => (
            <div key={k} className={clsx('rounded-xl px-3 py-2.5', i === 4 ? 'bg-brand-50' : 'bg-slate-50')}>
              <p className="text-[11px] text-slate-400">{k}</p>
              <p className={clsx('font-semibold tabular-nums', i === 4 ? 'text-brand-800' : 'text-slate-800')}>{money(v)}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <Scale size={13} /> Disbursed − repaid − written off = {money(r.disbursedPrincipal - r.repaidPrincipal - r.writtenOffPrincipal)} · outstanding per loan records {money(r.outstandingPrincipalLoans)}
        </p>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader title="Account balances" subtitle="Debit (+) / credit (−)" />
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {data.accounts.map((a) => (
                <tr key={a.code}>
                  <td className="py-1.5 text-slate-600">{a.name}</td>
                  <td className={clsx('py-1.5 text-right tabular-nums', a.balance < 0 ? 'text-slate-500' : 'text-slate-800')}>{money(a.balance)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="pt-2">Total</td>
                <td className="pt-2 text-right tabular-nums">{money(data.accounts.reduce((s, a) => s + a.balance, 0))}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <div className="xl:col-span-2">
          <Table
            rowKey={(e) => e.id}
            rows={data.entries}
            pageSize={12}
            filterPlaceholder="Filter by journal, loan or description"
            filterAccessor={(e) => `${e.journal} ${e.loanNumber ?? ''} ${e.description} ${e.reference}`}
            columns={[
              { header: 'Journal', cell: (e) => <span className="font-mono text-xs">{e.journal}</span> },
              { header: 'Date', cell: (e) => formatDate(e.date) },
              { header: 'Account', cell: (e) => data.accounts.find((a) => a.code === e.account)?.name ?? e.account },
              { header: 'Description', cell: (e) => <span className="text-xs">{e.description}</span> },
              { header: 'Debit', cell: (e) => (e.debit ? money(e.debit) : '') },
              { header: 'Credit', cell: (e) => (e.credit ? money(e.credit) : '') },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
