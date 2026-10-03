import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { FileDown, FileSpreadsheet, FileText, RotateCcw } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Table } from '../../components/ui/Table'
import { formatMoney } from '../../lib/format'
import { exportCSV, exportPDF, exportXLSX, type ExportTable } from '../../lib/exporters'
import type { AuditLogEntry, LedgerData } from '../../types'
import { MonthlyCashflowChart } from '../../components/reports/MonthlyCashflowChart'
import { CollectionsDonut } from '../../components/reports/CollectionsDonut'
import { AUDIT_KINDS, LOAN_STATE_LABEL, REPORTS, type Column, type FilterKey, type Filters } from './reportDefs'

const iso = (d: Date) => d.toLocaleDateString('en-CA')
const today = new Date()
const PRESETS: { id: string; label: string; range: () => [string, string] }[] = [
  { id: 'month', label: 'This month', range: () => [iso(new Date(today.getFullYear(), today.getMonth(), 1)), iso(today)] },
  { id: 'last', label: 'Last month', range: () => [iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), iso(new Date(today.getFullYear(), today.getMonth(), 0))] },
  { id: 'quarter', label: 'Last 90 days', range: () => [iso(new Date(Date.now() - 90 * 864e5)), iso(today)] },
  { id: 'year', label: 'This year', range: () => [iso(new Date(today.getFullYear(), 0, 1)), iso(today)] },
  { id: 'all', label: 'All time', range: () => ['', ''] },
]
const EMPTY: Filters = { from: '', to: '', branchId: '', productId: '', officerId: '', borrowerType: '', loanStatus: '', paymentMethod: '', action: '' }
const METHODS: Record<string, string> = {
  cash: 'Cash', bank: 'Bank', mobile_money: 'Mobile money', field: 'Field / agent', other: 'Other',
  bank_transfer: 'Bank transfer', wallet: 'Internal wallet', supplier: 'Supplier',
}
const selectClass = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none'

export default function Reports() {
  const [params, setParams] = useSearchParams()
  const reportId = params.get('r') ?? 'dashboard'
  const def = REPORTS.find((r) => r.id === reportId) ?? REPORTS[0]
  const s = useStore()
  const money = (n: number) => formatMoney(n, s.lender.currency)
  const [filters, setFilters] = useState<Filters>(() => {
    const [from, to] = PRESETS[0].range()
    return { ...EMPTY, from, to }
  })
  const [ledger, setLedger] = useState<LedgerData | null>(null)
  const [audit, setAudit] = useState<AuditLogEntry[] | null>(null)
  useEffect(() => {
    if (def.id !== 'audit') return
    s.loadAuditPeriod(filters.from, filters.to).then(setAudit).catch(() => setAudit([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id, filters.from, filters.to])

  useEffect(() => {
    if (def.id === 'financial' && !ledger) s.loadLedger().then(setLedger).catch(() => setLedger(null))
  }, [def.id, ledger, s])
  useEffect(() => {
    if (def.id === 'collections' || def.id === 'overdue') s.refreshCollectionCases()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id])

  const built = useMemo(
    () =>
      def.build(
        {
          loans: s.loans, applications: s.applications, repayments: s.repayments, disbursements: s.disbursements,
          borrowers: s.borrowers, groups: s.groups, products: s.products, branches: s.branches, staff: s.staff,
          cases: s.collectionCases, activities: s.collectionActivities, audit: audit ?? [], ledger,
        },
        filters,
        money,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [def, filters, ledger, s.loans, s.applications, s.repayments, s.disbursements, s.borrowers, s.groups, s.products,
      s.branches, s.staff, s.collectionCases, s.collectionActivities, audit],
  )

  const has = (k: FilterKey) => def.filters.includes(k)
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))
  const period = !has('from') ? 'as of today' : filters.from || filters.to
    ? `${filters.from || 'start'} to ${filters.to || 'today'}`
    : 'all time'
  const preset = PRESETS.find((p) => { const [a, b] = p.range(); return a === filters.from && b === filters.to })
  const monthTitle = preset?.id === 'month' || preset?.id === 'last'
    ? new Date(filters.from + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : period
  const title = `${def.label} Report — ${has('from') ? monthTitle : `as of ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`}`
  const filterText = [
    has('from') && `Period: ${period}`,
    filters.branchId && has('branchId') && `Branch: ${s.branches.find((b) => b.id === filters.branchId)?.name}`,
    filters.productId && has('productId') && `Product: ${s.products.find((p) => p.id === filters.productId)?.name}`,
    filters.officerId && has('officerId') && `${def.id === 'audit' ? 'User' : 'Officer'}: ${s.staff.find((x) => x.id === filters.officerId)?.name}`,
    filters.borrowerType && has('borrowerType') && `Borrower type: ${filters.borrowerType}`,
    filters.loanStatus && has('loanStatus') && `Status: ${LOAN_STATE_LABEL[filters.loanStatus]}`,
    filters.paymentMethod && has('paymentMethod') && `Method: ${METHODS[filters.paymentMethod]}`,
    filters.action && has('action') && `Action: ${AUDIT_KINDS[filters.action as keyof typeof AUDIT_KINDS]}`,
  ].filter(Boolean).join(' · ')

  const cols = built.columns as (Column & { value: (r: unknown) => string | number; link?: (r: unknown) => string | null })[]
  const table: ExportTable = {
    title,
    subtitle: filterText,
    organisation: s.lender.name,
    summary: built.tiles.map(([k, v]) => [k, String(v)]),
    headers: cols.map((c) => c.header),
    rows: built.rows.map((r) => cols.map((c) => c.value(r))),
  }
  const auditBlocked = def.id === 'audit' && !!s.currentUser && !['lender_admin', 'platform_admin', 'auditor'].includes(s.currentUser.role)
  const methodOptions = def.id === 'disbursements'
    ? ['bank_transfer', 'mobile_money', 'cash', 'wallet', 'supplier']
    : ['cash', 'bank', 'mobile_money', 'field', 'other']

  return (
    <div>
      <PageHeader title="Reports" subtitle="Generated from the transaction records — every figure can be traced to the loans, payments and journals behind it" />
      <div className="grid gap-5 lg:grid-cols-[210px_1fr]">
        <nav className="flex h-fit gap-1 overflow-x-auto rounded-2xl bg-white p-2 lg:block">
          {REPORTS.map((r) => (
            <button
              key={r.id}
              onClick={() => setParams({ r: r.id })}
              className={clsx('block flex-shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm lg:w-full', r.id === def.id ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-600 hover:bg-slate-50')}
            >
              {r.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-5">
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-2">
              {has('from') && (
                <>
                  <label className="text-xs text-slate-500">From<input type="date" className={`${selectClass} mt-1 block`} value={filters.from} onChange={(e) => set({ from: e.target.value })} /></label>
                  <label className="text-xs text-slate-500">To<input type="date" className={`${selectClass} mt-1 block`} value={filters.to} onChange={(e) => set({ to: e.target.value })} /></label>
                  <div className="flex flex-wrap gap-1 pb-0.5">
                    {PRESETS.map((p) => (
                      <button key={p.id} onClick={() => { const [from, to] = p.range(); set({ from, to }) }}
                        className={clsx('rounded-full px-2.5 py-1 text-xs font-medium', preset?.id === p.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {has('branchId') && (
                <select className={selectClass} value={filters.branchId} onChange={(e) => set({ branchId: e.target.value })}>
                  <option value="">All branches</option>
                  {s.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
              {has('productId') && (
                <select className={selectClass} value={filters.productId} onChange={(e) => set({ productId: e.target.value })}>
                  <option value="">All products</option>
                  {s.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {has('officerId') && (
                <select className={selectClass} value={filters.officerId} onChange={(e) => set({ officerId: e.target.value })}>
                  <option value="">{def.id === 'audit' ? 'All users' : 'All officers'}</option>
                  {s.staff.filter((x) => def.id === 'audit' || ['loan_officer', 'branch_manager'].includes(x.role)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              )}
              {has('borrowerType') && (
                <select className={selectClass} value={filters.borrowerType} onChange={(e) => set({ borrowerType: e.target.value as Filters['borrowerType'] })}>
                  <option value="">Individual & group</option>
                  <option value="individual">Individual</option>
                  <option value="group">Group</option>
                </select>
              )}
              {has('loanStatus') && (
                <select className={selectClass} value={filters.loanStatus} onChange={(e) => set({ loanStatus: e.target.value as Filters['loanStatus'] })}>
                  <option value="">Any status</option>
                  {Object.entries(LOAN_STATE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}
              {has('paymentMethod') && (
                <select className={selectClass} value={filters.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value })}>
                  <option value="">Any method</option>
                  {methodOptions.map((m) => <option key={m} value={m}>{METHODS[m]}</option>)}
                </select>
              )}
              {has('action') && (
                <select className={selectClass} value={filters.action} onChange={(e) => set({ action: e.target.value })}>
                  <option value="">All actions</option>
                  {Object.entries(AUDIT_KINDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}
              <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setFilters({ ...EMPTY, from: PRESETS[0].range()[0], to: PRESETS[0].range()[1] })}>Reset</Button>
            </div>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">{title}</h2>
              <p className="text-sm text-slate-500">{def.description}</p>
              {filterText && <p className="mt-0.5 text-xs text-slate-400">{filterText}</p>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={<FileText size={14} />} disabled={!built.rows.length} onClick={() => exportPDF(table)}>PDF</Button>
              <Button size="sm" variant="secondary" icon={<FileSpreadsheet size={14} />} disabled={!built.rows.length} onClick={() => exportXLSX(table)}>Excel</Button>
              <Button size="sm" variant="secondary" icon={<FileDown size={14} />} disabled={!built.rows.length} onClick={() => exportCSV(table)}>CSV</Button>
            </div>
          </div>

          {auditBlocked ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">The audit trail is available to administrators and auditors.</p>
          ) : (
            <>
              {built.tiles.length > 0 && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                  {built.tiles.map(([k, v, tone]) => (
                    <div key={k} className="rounded-2xl bg-white p-4">
                      <p className="text-[11px] uppercase tracking-wide text-slate-400">{k}</p>
                      <p className={clsx('mt-1 text-lg font-bold tabular-nums', tone === 'bad' ? 'text-accent-600' : tone === 'good' ? 'text-emerald-700' : 'text-slate-900')}>{v}</p>
                    </div>
                  ))}
                </div>
              )}
              {built.blocks && built.blocks.length > 0 && (
                <div className="grid gap-5 xl:grid-cols-2">
                  {built.blocks.map((b) => (
                    <Card key={b.title}>
                      <CardHeader title={b.title} />
                      <table className="w-full text-sm">
                        {b.headers && (
                          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                            <tr>{b.headers.map((h, i) => <th key={i} className={clsx('py-1.5', i > 0 && 'text-right')}>{h}</th>)}</tr>
                          </thead>
                        )}
                        <tbody className="divide-y divide-slate-100">
                          {b.rows.map((row, i) => (
                            <tr key={i}>{row.map((v, j) => <td key={j} className={clsx('py-1.5', j > 0 ? 'text-right tabular-nums' : 'capitalize text-slate-600')}>{v}</td>)}</tr>
                          ))}
                          {b.rows.length === 0 && <tr><td className="py-2 text-slate-400">Nothing in this period.</td></tr>}
                        </tbody>
                      </table>
                    </Card>
                  ))}
                </div>
              )}
              {def.id === 'dashboard' && (
                <div className="grid gap-5 xl:grid-cols-3">
                  <div className="xl:col-span-2"><MonthlyCashflowChart loans={s.loans} repayments={s.repayments} currency={s.lender.currency} /></div>
                  <CollectionsDonut repayments={s.repayments.filter((x) => !x.reversed)} currency={s.lender.currency} />
                </div>
              )}
              {built.note && <p className="text-xs text-slate-500">{built.note}</p>}
              {cols.length > 0 && (
                <Card className="p-0 sm:p-0">
                  <div className="overflow-x-auto p-4">
                    <Table
                      rowKey={(r) => String(built.rows.indexOf(r))}
                      rows={built.rows}
                      pageSize={20}
                      emptyMessage="No records match these filters."
                      filterPlaceholder="Search within the report"
                      filterAccessor={(r) => cols.map((c) => String(c.value(r))).join(' ')}
                      columns={cols.map((c) => ({
                        header: c.header,
                        sort: (r: unknown) => c.value(r),
                        cell: (r: unknown) => {
                          const v = c.value(r)
                          const shown = c.money && typeof v === 'number' ? money(v) : v
                          const href = c.link?.(r)
                          return href ? <Link to={href} className="text-brand-700 hover:underline">{shown}</Link> : <span className={clsx(c.money && 'tabular-nums')}>{shown}</span>
                        },
                      }))}
                    />
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
