import { useMemo, useState } from 'react'
import { BarChart3, Download, Landmark, ArrowUpRight, Users, TrendingUp, ShieldAlert } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Tabs } from '../../components/ui/Tabs'
import { Table } from '../../components/ui/Table'
import { StatTile } from '../../components/ui/StatTile'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { MonthlyCashflowChart } from '../../components/reports/MonthlyCashflowChart'
import { CollectionsDonut } from '../../components/reports/CollectionsDonut'
import { ArrearsChart } from '../../components/dashboard/ArrearsChart'
import { downloadCSV } from '../../lib/csv'
import { formatMoney } from '../../lib/format'
import {
  atRiskLoans,
  branchPerformance,
  officerPerformance,
  portfolioKpis,
  productComposition,
} from '../../lib/reports'
import { STAFF_ROLE_LABELS } from '../../types'

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'collections', label: 'Collections' },
  { id: 'officers', label: 'Officer performance' },
  { id: 'branches', label: 'Branch performance' },
  { id: 'book', label: 'Loan book' },
  { id: 'atrisk', label: 'At-risk loans' },
]

export default function Reports() {
  const loans = useStore((s) => s.loans)
  const repayments = useStore((s) => s.repayments)
  const borrowers = useStore((s) => s.borrowers)
  const staff = useStore((s) => s.staff)
  const branches = useStore((s) => s.branches)
  const products = useStore((s) => s.products)
  const lender = useStore((s) => s.lender)
  const [tab, setTab] = useState('overview')

  const kpis = useMemo(() => portfolioKpis(loans, repayments), [loans, repayments])
  const officers = useMemo(
    () => officerPerformance(staff, borrowers, loans, repayments),
    [staff, borrowers, loans, repayments],
  )
  const branchRows = useMemo(
    () => branchPerformance(branches, borrowers, loans, repayments),
    [branches, borrowers, loans, repayments],
  )
  const book = useMemo(() => productComposition(products, loans), [products, loans])
  const risk = useMemo(
    () => atRiskLoans(loans, borrowers, branches, products),
    [loans, borrowers, branches, products],
  )

  const asOf = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Portfolio performance, collections and exposure across your lending operation"
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Portfolio outstanding" value={formatMoney(kpis.outstanding, lender.currency)} icon={<BarChart3 size={16} />} tone="brand" />
        <StatTile label="Disbursed this month" value={formatMoney(kpis.disbursedThisMonth, lender.currency)} icon={<ArrowUpRight size={16} />} tone="green" />
        <StatTile label="Collected this month" value={formatMoney(kpis.collectedThisMonth, lender.currency)} icon={<TrendingUp size={16} />} tone="green" />
        <StatTile
          label="Portfolio at risk"
          value={`${kpis.par.toFixed(1)}%`}
          hint={formatMoney(kpis.atRiskAmount, lender.currency)}
          icon={<ShieldAlert size={16} />}
          tone={kpis.par > 10 ? 'red' : kpis.par > 5 ? 'amber' : 'brand'}
        />
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="mt-6">
        {tab === 'overview' && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <MonthlyCashflowChart loans={loans} repayments={repayments} currency={lender.currency} />
            </div>
            <div className="grid grid-cols-1 gap-4">
              <Card>
                <CardHeader title="Portfolio health" />
                <ul className="space-y-3 text-sm">
                  <HealthRow label="Active loans" value={kpis.activeLoans.toString()} />
                  <HealthRow label="Closed loans" value={kpis.closedLoans.toString()} />
                  <HealthRow label="Written off" value={kpis.writtenOffLoans.toString()} />
                  <HealthRow label="Disbursed this month" value={formatMoney(kpis.disbursedThisMonth, lender.currency)} />
                  <HealthRow label="Collected this month" value={formatMoney(kpis.collectedThisMonth, lender.currency)} />
                  <HealthRow label="Net cash flow (MoM)" value={formatMoney(kpis.collectedThisMonth - kpis.disbursedThisMonth, lender.currency)} />
                </ul>
              </Card>
              <Card>
                <CardHeader title="Book summary" subtitle={`As of ${asOf}`} />
                <p className="text-sm text-slate-600">
                  {book.length > 0 && (
                  <>
                    <span className="font-semibold text-slate-800">{book.length}</span> active loan product{book.length === 1 ? '' : 's'}
                  </>
                )}
                {book.length === 0 && <span className="text-slate-400">No active loans yet.</span>}
                </p>
              </Card>
            </div>
          </div>
        )}

        {tab === 'collections' && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <MonthlyCashflowChart loans={loans} repayments={repayments} currency={lender.currency} title="Collection trend" subtitle="Monthly collections over the last 12 months" />
              <div className="mt-5">
                <ArrearsChart loans={loans} currency={lender.currency} subtitle="Outstanding balance of active loans by days overdue" />
              </div>
            </div>
            <CollectionsDonut repayments={repayments} currency={lender.currency} />
          </div>
        )}

        {tab === 'officers' && (
          <div>
            <div className="mb-3 flex justify-end">
              <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={() => exportOfficers(officers)}>
                Export CSV
              </Button>
            </div>
            <Table
              rowKey={(r) => r.officer.id}
              rows={officers}
              columns={[
                { header: 'Officer', cell: (r) => <span className="font-medium text-slate-800">{r.officer.name}</span> },
                { header: 'Borrowers', cell: (r) => r.borrowers },
                { header: 'Active loans', cell: (r) => r.activeLoans },
                { header: 'Outstanding', cell: (r) => <span className="tabular-nums">{formatMoney(r.outstanding, lender.currency)}</span> },
                { header: 'Collected', cell: (r) => <span className="tabular-nums">{formatMoney(r.collected, lender.currency)}</span> },
                { header: 'This month', cell: (r) => <span className="tabular-nums">{formatMoney(r.collectedThisMonth, lender.currency)}</span> },
                { header: 'In arrears', cell: (r) => <Badge tone={r.arrearsLoans > 0 ? 'amber' : 'green'}>{r.arrearsLoans}</Badge> },
                { header: 'PAR', cell: (r) => <Badge tone={r.par > 10 ? 'red' : r.par > 5 ? 'amber' : 'green'}>{r.par.toFixed(1)}%</Badge> },
              ]}
            />
          </div>
        )}

        {tab === 'branches' && (
          <div>
            <div className="mb-3 flex justify-end">
              <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={() => exportBranches(branchRows)}>
                Export CSV
              </Button>
            </div>
            <Table
              rowKey={(r) => r.branch.id}
              rows={branchRows}
              columns={[
                { header: 'Branch', cell: (r) => (
                    <span className="flex items-center gap-2">
                      <span className="rounded-lg bg-brand-100 p-1.5 text-brand-600"><Landmark size={14} /></span>
                      <span className="font-medium text-slate-800">{r.branch.name}</span>
                    </span>
                  ) },
                { header: 'Borrowers', cell: (r) => r.borrowers },
                { header: 'Active loans', cell: (r) => r.activeLoans },
                { header: 'Outstanding', cell: (r) => <span className="tabular-nums">{formatMoney(r.outstanding, lender.currency)}</span> },
                { header: 'At risk', cell: (r) => <span className="tabular-nums">{formatMoney(r.atRiskAmount, lender.currency)}</span> },
                { header: 'PAR', cell: (r) => <Badge tone={r.par > 10 ? 'red' : r.par > 5 ? 'amber' : 'green'}>{r.par.toFixed(1)}%</Badge> },
                { header: 'Collected', cell: (r) => <span className="tabular-nums">{formatMoney(r.collected, lender.currency)}</span> },
                { header: 'This month', cell: (r) => <span className="tabular-nums">{formatMoney(r.collectedThisMonth, lender.currency)}</span> },
              ]}
            />
          </div>
        )}

        {tab === 'book' && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Table
                rowKey={(r) => r.product.id}
                rows={book}
                columns={[
                  { header: 'Product', cell: (r) => <span className="font-medium text-slate-800">{r.product.name}</span> },
                  { header: 'Active loans', cell: (r) => r.activeLoans },
                  { header: 'Outstanding', cell: (r) => <span className="tabular-nums">{formatMoney(r.outstanding, lender.currency)}</span> },
                  { header: '% of book', cell: (r) => `${r.amountShare.toFixed(1)}%` },
                ]}
              />
            </div>
            <div className="space-y-4">
              <Card>
                <CardHeader title="Product mix" subtitle="Share of total outstanding balance" />
                <ul className="space-y-3">
                  {book.map((r) => (
                    <li key={r.product.id}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="text-slate-600">{r.product.name}</span>
                        <span className="tabular-nums font-medium text-slate-800">{r.amountShare.toFixed(1)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${r.amountShare}%` }} />
                      </div>
                    </li>
                  ))}
                  {book.length === 0 && <li className="py-6 text-center text-sm text-slate-400">No active loans yet.</li>}
                </ul>
              </Card>
              <div className="grid grid-cols-2 gap-4">
                <Card className="text-center">
                  <Users size={18} className="mx-auto mb-2 text-brand-500" />
                  <p className="text-2xl font-extrabold tabular-nums text-slate-900">{kpis.activeLoans}</p>
                  <p className="text-xs text-slate-500">Active loans</p>
                </Card>
                <Card className="text-center">
                  <TrendingUp size={18} className="mx-auto mb-2 text-emerald-500" />
                  <p className="text-2xl font-extrabold tabular-nums text-slate-900">{kpis.closedLoans}</p>
                  <p className="text-xs text-slate-500">Closed loans</p>
                </Card>
              </div>
            </div>
          </div>
        )}

        {tab === 'atrisk' && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-slate-500">{risk.length} active loan(s) with outstanding arrears</p>
              <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={() => exportAtRisk(risk)}>
                Export CSV
              </Button>
            </div>
            <Table
              rowKey={(r) => r.loan.id}
              rows={risk}
              columns={[
                { header: 'Borrower', cell: (r) => <span className="font-medium text-slate-800">{r.borrowerName}</span> },
                { header: 'Product', cell: (r) => r.productName },
                { header: 'Branch', cell: (r) => r.branchName },
                { header: 'Outstanding', cell: (r) => <span className="tabular-nums">{formatMoney(r.loan.outstandingBalance, lender.currency)}</span> },
                { header: 'Arrears', cell: (r) => <span className="tabular-nums text-red-600">{formatMoney(r.arrearsAmount, lender.currency)}</span> },
                { header: 'Days late', cell: (r) => <Badge tone={r.daysLate > 30 ? 'red' : r.daysLate > 7 ? 'amber' : 'slate'}>{r.daysLate} days</Badge> },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function HealthRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="tabular-nums font-semibold text-slate-800">{value}</span>
    </li>
  )
}

function exportOfficers(
  rows: ReturnType<typeof officerPerformance>,
) {
  downloadCSV('officer-performance.csv', [
    'Officer', 'Role', 'Borrowers', 'Active Loans', 'Outstanding', 'Total Collected', 'Collected This Month', 'In Arrears', 'PAR (%)',
  ], rows.map((r) => [
    r.officer.name, STAFF_ROLE_LABELS[r.officer.role], r.borrowers, r.activeLoans,
    r.outstanding, r.collected, r.collectedThisMonth, r.arrearsLoans, r.par.toFixed(2),
  ]))
}

function exportBranches(
  rows: ReturnType<typeof branchPerformance>,
) {
  downloadCSV('branch-performance.csv', [
    'Branch', 'Borrowers', 'Active Loans', 'Outstanding', 'At Risk', 'PAR (%)', 'Total Collected', 'Collected This Month',
  ], rows.map((r) => [
    r.branch.name, r.borrowers, r.activeLoans, r.outstanding, r.atRiskAmount,
    r.par.toFixed(2), r.collected, r.collectedThisMonth,
  ]))
}

function exportAtRisk(
  rows: ReturnType<typeof atRiskLoans>,
) {
  downloadCSV('at-risk-loans.csv', [
    'Borrower', 'Product', 'Branch', 'Outstanding', 'Arrears Amount', 'Days Late',
  ], rows.map((r) => [
    r.borrowerName, r.productName, r.branchName, r.loan.outstandingBalance, r.arrearsAmount, r.daysLate,
  ]))
}