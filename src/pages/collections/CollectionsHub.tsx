import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { AlertTriangle, CalendarCheck, HandCoins, MapPin, Phone, UserCheck } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatTile } from '../../components/ui/StatTile'
import { Tabs } from '../../components/ui/Tabs'
import { Table } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card, CardHeader } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import { formatDate, formatMoney } from '../../lib/format'
import { isSupervisor } from '../../lib/permissions'
import type { CollectionCase, CollectionDashboard } from '../../types'
import { groupSummary } from '../groups/groupStats'
import { CASE_STATUS_LABEL, CASE_STATUS_TONE, STAGE_LABEL } from './collectionParts'

type SortKey = 'days' | 'amount' | 'followUp' | 'due'
const filterClass = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none'

export default function CollectionsHub() {
  const navigate = useNavigate()
  const cases = useStore((s) => s.collectionCases)
  const refreshCollectionCases = useStore((s) => s.refreshCollectionCases)
  const loadCollectionDashboard = useStore((s) => s.loadCollectionDashboard)
  const assignCollectionCases = useStore((s) => s.assignCollectionCases)
  const activities = useStore((s) => s.collectionActivities)
  const staff = useStore((s) => s.staff)
  const branches = useStore((s) => s.branches)
  const me = useStore((s) => s.currentUser)
  const currency = useStore((s) => s.lender.currency)
  const [dash, setDash] = useState<CollectionDashboard | null>(null)
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem('lms-col-tab') || 'cases'
    } catch {
      return 'cases'
    }
  })
  const [scope, setScope] = useState<'mine' | 'all'>(me && !isSupervisor(me.role) ? 'mine' : 'all')
  const [status, setStatus] = useState('open')
  const [branch, setBranch] = useState('')
  const [sort, setSort] = useState<SortKey>('days')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState(false)
  const money = (n: number) => formatMoney(n, currency)
  const supervisor = me ? isSupervisor(me.role) : false

  useEffect(() => {
    refreshCollectionCases()
    loadCollectionDashboard().then(setDash).catch(() => setDash(null))
  }, [refreshCollectionCases, loadCollectionDashboard, activities])

  const choose = (t: string) => {
    setTab(t)
    try {
      localStorage.setItem('lms-col-tab', t)
    } catch {
      /* storage unavailable */
    }
  }

  const today = new Date().toLocaleDateString('en-CA')
  const rows = useMemo(() => {
    const list = cases.filter(
      (c) =>
        (scope === 'all' || c.assignedToId === me?.id) &&
        (status === 'all' ? true : status === 'open' ? !['resolved', 'paid'].includes(c.status) : c.status === status) &&
        (!branch || c.branchId === branch),
    )
    const by: Record<SortKey, (a: CollectionCase, b: CollectionCase) => number> = {
      days: (a, b) => b.daysOverdue - a.daysOverdue,
      amount: (a, b) => b.overdueAmount - a.overdueAmount,
      followUp: (a, b) => (a.nextFollowUp ?? '9999').localeCompare(b.nextFollowUp ?? '9999'),
      due: (a, b) => (a.nextDueDate ?? '9999').localeCompare(b.nextDueDate ?? '9999'),
    }
    return [...list].sort(by[sort])
  }, [cases, scope, status, branch, sort, me])

  const mine = cases.filter((c) => c.assignedToId === me?.id && !['resolved', 'paid'].includes(c.status))
  const work = [
    { n: mine.filter((c) => c.nextFollowUp && c.nextFollowUp <= today).length, label: 'follow-ups due', icon: Phone },
    { n: mine.filter((c) => c.openPromise?.date === today).length, label: 'promises due today', icon: HandCoins },
    { n: mine.filter((c) => c.status === 'promise_broken').length, label: 'missed promises', icon: AlertTriangle },
    { n: activities.filter((a) => a.kind === 'visit' && a.visitDate === today && cases.some((c) => c.loanId === a.loanId && c.assignedToId === me?.id)).length, label: 'field visits today', icon: MapPin },
  ]

  return (
    <div>
      <PageHeader title="Collections" subtitle="Payments due, overdue or at risk — and every follow-up on record" />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatTile label="Due today" value={String(dash?.dueToday ?? '—')} tone="brand" />
        <StatTile label="Overdue loans" value={String(dash?.overdueLoans ?? '—')} tone={dash?.overdueLoans ? 'red' : 'green'} />
        <StatTile label="Overdue amount" value={dash ? money(dash.overdueAmount) : '—'} tone="red" />
        <StatTile label="Promises due today" value={String(dash?.promisesDueToday ?? '—')} tone="amber" />
        <StatTile label="Field visits today" value={String(dash?.fieldVisitsToday ?? '—')} tone="brand" />
        <StatTile label="Recovered this month" value={dash ? money(dash.recoveredThisMonth) : '—'} tone="green" />
      </div>

      {mine.length > 0 && (
        <Card className="mb-5 p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-2 font-semibold text-slate-800"><UserCheck size={16} /> My work: {mine.length} open case(s)</span>
            {work.map((w) => (
              <span key={w.label} className={clsx('flex items-center gap-1.5', w.n ? 'font-semibold text-accent-700' : 'text-slate-500')}>
                <w.icon size={14} /> {w.n} {w.label}
              </span>
            ))}
          </div>
        </Card>
      )}
      {supervisor && dash && (dash.escalatedCases > 0 || dash.significantOverdue > 0) && (
        <p className="mb-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {dash.escalatedCases} escalated case(s) and {dash.significantOverdue} loan(s) with large overdue balances need management attention.
        </p>
      )}

      <Tabs
        tabs={[
          { id: 'cases', label: 'Cases' },
          { id: 'promises', label: 'Promises to pay' },
          { id: 'visits', label: 'Field visits' },
          { id: 'groups', label: 'Groups' },
          { id: 'reports', label: 'Reports' },
        ]}
        active={tab}
        onChange={choose}
      />
      <div className="mt-4">
        {tab === 'cases' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select className={filterClass} value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')}>
                <option value="mine">My cases</option>
                <option value="all">All cases</option>
              </select>
              <select className={filterClass} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="open">Open</option>
                <option value="all">All statuses</option>
                {Object.entries(CASE_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select className={filterClass} value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">All branches</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select className={filterClass} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="days">Most days overdue</option>
                <option value="amount">Largest overdue amount</option>
                <option value="followUp">Next follow-up</option>
                <option value="due">Next due date</option>
              </select>
              {supervisor && selected.size > 0 && (
                <Button size="sm" onClick={() => setAssigning(true)}>Assign {selected.size} case(s)</Button>
              )}
            </div>
            <Table
              rowKey={(c) => c.id}
              rows={rows}
              pageSize={15}
              emptyMessage="No cases match."
              onRowClick={(c) => navigate(`/collections/${c.id}`)}
              filterPlaceholder="Borrower, loan or case number"
              filterAccessor={(c) => `${c.borrowerName} ${c.loanNumber} ${c.number} ${c.groupName ?? ''}`}
              columns={[
                ...(supervisor
                  ? [{
                      header: '',
                      cell: (c: CollectionCase) => (
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })}
                        />
                      ),
                    }]
                  : []),
                { header: 'Borrower / group', cell: (c) => <span className="font-medium text-slate-800">{c.borrowerName}{c.groupName && <span className="block text-xs text-slate-400">{c.groupName}</span>}</span> },
                { header: 'Loan', cell: (c) => <span className="font-mono text-xs">{c.loanNumber}</span> },
                { header: 'Outstanding', cell: (c) => money(c.outstanding), sort: (c) => c.outstanding },
                { header: 'Overdue', cell: (c) => <span className={c.overdueAmount ? 'font-semibold text-accent-600' : ''}>{money(c.overdueAmount)}</span>, sort: (c) => c.overdueAmount },
                { header: 'Days', cell: (c) => c.daysOverdue, sort: (c) => c.daysOverdue },
                { header: 'Missed', cell: (c) => c.missedInstalments },
                { header: 'Last payment', cell: (c) => (c.lastPaymentDate ? `${formatDate(c.lastPaymentDate)} · ${money(c.lastPaymentAmount ?? 0)}` : 'None') },
                { header: 'Next action', cell: (c) => <span className="text-xs">{c.nextAction || '—'}{c.nextFollowUp && <span className={clsx('block', c.nextFollowUp <= today ? 'font-semibold text-accent-600' : 'text-slate-400')}>{formatDate(c.nextFollowUp)}</span>}</span> },
                { header: 'Officer', cell: (c) => <span className="text-xs">{c.assignedToName || 'Unassigned'}</span> },
                { header: 'Status', cell: (c) => <span className="flex flex-col gap-1"><Badge tone={CASE_STATUS_TONE[c.status]}>{CASE_STATUS_LABEL[c.status]}</Badge><span className="text-[11px] text-slate-400">{STAGE_LABEL[c.stage] ?? c.stage}</span></span> },
              ]}
            />
          </div>
        )}
        {tab === 'promises' && <PromisesTab />}
        {tab === 'visits' && <VisitsTab />}
        {tab === 'groups' && <GroupsTab />}
        {tab === 'reports' && dash && <ReportsTab dash={dash} />}
      </div>

      <Modal open={assigning} onClose={() => setAssigning(false)} title="Assign cases">
        <AssignForm
          staff={staff.filter((s) => s.active && ['loan_officer', 'branch_manager', 'lender_admin'].includes(s.role))}
          onAssign={async (staffId) => {
            await assignCollectionCases([...selected], staffId)
            setSelected(new Set())
            setAssigning(false)
          }}
        />
      </Modal>
    </div>
  )
}

function AssignForm({ staff, onAssign }: { staff: { id: string; name: string }[]; onAssign: (id: string) => Promise<void> }) {
  const [id, setId] = useState(staff[0]?.id ?? '')
  return (
    <div className="space-y-4">
      <Field label="Collection officer">
        <select className={inputClass} value={id} onChange={(e) => setId(e.target.value)}>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Button className="w-full" disabled={!id} onClick={() => onAssign(id)}>Assign</Button>
    </div>
  )
}

function PromisesTab() {
  const navigate = useNavigate()
  const activities = useStore((s) => s.collectionActivities)
  const cases = useStore((s) => s.collectionCases)
  const borrowers = useStore((s) => s.borrowers)
  const currency = useStore((s) => s.lender.currency)
  const today = new Date().toLocaleDateString('en-CA')
  const promises = activities.filter((a) => a.kind === 'promise').sort((a, b) => (b.promisedDate ?? '').localeCompare(a.promisedDate ?? ''))
  const count = (k: string) => promises.filter((p) => p.promiseStatus === k).length
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini k="Due today" v={String(promises.filter((p) => p.promisedDate === today && p.promiseStatus === 'pending').length)} />
        <Mini k="Pending" v={String(count('pending'))} />
        <Mini k="Fulfilled" v={String(count('kept'))} good />
        <Mini k="Missed" v={String(count('broken'))} bad />
      </div>
      <Table
        rowKey={(p) => p.id}
        rows={promises}
        pageSize={15}
        emptyMessage="No promises recorded."
        onRowClick={(p) => { const c = cases.find((x) => x.loanId === p.loanId); if (c) navigate(`/collections/${c.id}`) }}
        columns={[
          { header: 'Borrower', cell: (p) => borrowers.find((b) => b.id === p.borrowerId)?.fullName ?? '—' },
          { header: 'Promised', cell: (p) => formatMoney(p.promisedAmount ?? 0, currency) },
          { header: 'By', cell: (p) => (p.promisedDate ? formatDate(p.promisedDate) : '—'), sort: (p) => p.promisedDate ?? '' },
          { header: 'Reason', cell: (p) => <span className="text-xs">{p.reason || p.note || '—'}</span> },
          { header: 'Officer', cell: (p) => <span className="text-xs">{p.createdBy}</span> },
          { header: 'Status', cell: (p) => <Badge tone={p.promiseStatus === 'kept' ? 'green' : p.promiseStatus === 'broken' ? 'red' : p.promisedDate === today ? 'blue' : 'amber'}>{p.promiseStatus === 'kept' ? 'Fulfilled' : p.promiseStatus === 'broken' ? 'Missed' : p.promisedDate === today ? 'Due today' : 'Pending'}</Badge> },
        ]}
      />
    </div>
  )
}

function VisitsTab() {
  const navigate = useNavigate()
  const activities = useStore((s) => s.collectionActivities)
  const cases = useStore((s) => s.collectionCases)
  const borrowers = useStore((s) => s.borrowers)
  const currency = useStore((s) => s.lender.currency)
  const visits = activities.filter((a) => a.kind === 'visit').sort((a, b) => (b.visitDate ?? b.createdAt).localeCompare(a.visitDate ?? a.createdAt))
  return (
    <Table
      rowKey={(v) => v.id}
      rows={visits}
      pageSize={15}
      emptyMessage="No field visits recorded."
      onRowClick={(v) => { const c = cases.find((x) => x.loanId === v.loanId); if (c) navigate(`/collections/${c.id}`) }}
      columns={[
        { header: 'Date', cell: (v) => formatDate(v.visitDate ?? v.createdAt), sort: (v) => v.visitDate ?? v.createdAt },
        { header: 'Borrower', cell: (v) => borrowers.find((b) => b.id === v.borrowerId)?.fullName ?? '—' },
        { header: 'Officer', cell: (v) => <span className="text-xs">{v.createdBy}</span> },
        { header: 'Location / meeting point', cell: (v) => <span className="text-xs">{v.location || '—'}</span> },
        { header: 'Purpose', cell: (v) => <span className="text-xs">{v.purpose || '—'}</span> },
        { header: 'Result', cell: (v) => <span className="text-xs capitalize">{v.outcome ? v.outcome.replace('_', ' ') : '—'}</span> },
        { header: 'Collected', cell: (v) => (v.amountCollected ? formatMoney(v.amountCollected, currency) : '—') },
        { header: 'Status', cell: (v) => <Badge tone={v.visitStatus === 'scheduled' ? 'amber' : 'green'}>{v.visitStatus === 'scheduled' ? 'Scheduled' : 'Done'}</Badge> },
      ]}
    />
  )
}

function GroupsTab() {
  const groups = useStore((s) => s.groups)
  const applications = useStore((s) => s.applications)
  const loans = useStore((s) => s.loans)
  const repayments = useStore((s) => s.repayments)
  const currency = useStore((s) => s.lender.currency)
  const money = (n: number) => formatMoney(n, currency)
  const rows = groups.map((g) => ({ g, s: groupSummary(g, applications, loans, repayments) })).sort((a, b) => b.s.overdue - a.s.overdue)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {rows.map(({ g, s }) => {
        const behind = g.memberships
          .filter((m) => m.status === 'active')
          .map((m) => ({ m, loan: loans.find((l) => l.borrowerId === m.borrowerId && l.groupId === g.id && l.status === 'active') }))
          .filter((x) => x.loan && x.loan.daysInArrears > 0)
        return (
          <Card key={g.id}>
            <CardHeader
              title={g.name}
              subtitle={`${g.groupNumber} · ${s.activeMembers} members`}
              action={<Link to={`/groups/${g.id}`} className="text-xs font-medium text-brand-700 hover:underline">Open group</Link>}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Mini k="Outstanding" v={money(s.outstanding)} />
              <Mini k="Overdue" v={money(s.overdue)} bad={s.overdue > 0} />
              <Mini k="Overdue members" v={String(s.overdueMembers)} bad={s.overdueMembers > 0} />
              <Mini k="Paid collectively" v={money(s.repaid)} good />
            </div>
            {behind.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {behind.map(({ m, loan }) => (
                  <li key={m.id} className="flex justify-between rounded-lg bg-red-50 px-3 py-1.5 text-red-800">
                    <Link to={`/loans/${loan!.id}`} className="hover:underline">{m.borrowerName} · {loan!.loanNumber}</Link>
                    <span>{money(loan!.arrearsAmount)} · {loan!.daysInArrears}d</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )
      })}
      {rows.length === 0 && <p className="text-sm text-slate-400">No groups.</p>}
    </div>
  )
}

function ReportsTab({ dash }: { dash: CollectionDashboard }) {
  const currency = useStore((s) => s.lender.currency)
  const money = (n: number) => formatMoney(n, currency)
  const maxAmount = Math.max(1, ...dash.aging.map((a) => a.amount))
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader title="Collection performance" subtitle="This month" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Mini k="Total overdue" v={money(dash.overdueAmount)} bad />
          <Mini k="Overdue loans" v={String(dash.overdueLoans)} />
          <Mini k="Collection rate" v={dash.collectionRate == null ? '—' : `${dash.collectionRate}%`} good={(dash.collectionRate ?? 0) >= 90} />
          <Mini k="Due this month" v={money(dash.dueThisMonth)} />
          <Mini k="Collected on it" v={money(dash.collectedThisMonth)} />
          <Mini k="Recovered (cases)" v={money(dash.recoveredThisMonth)} good />
          <Mini k="Promises made" v={String(dash.promises.made)} />
          <Mini k="Fulfilled" v={String(dash.promises.fulfilled)} good />
          <Mini k="Missed" v={String(dash.promises.missed)} bad={dash.promises.missed > 0} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Aging of overdue loans" />
        <div className="space-y-2">
          {dash.aging.map((a) => (
            <div key={a.bucket}>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">{a.bucket}</span>
                <span className="tabular-nums text-slate-800">{a.loans} loan(s) · {money(a.amount)}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-accent-500" style={{ width: `${(a.amount / maxAmount) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title="Officer activity" subtitle="This month" />
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
            <tr><th className="py-2">Officer</th><th className="text-right">Open cases</th><th className="text-right">Calls</th><th className="text-right">Visits</th><th className="text-right">Messages</th><th className="text-right">Promises</th><th className="text-right">Escalations</th><th className="text-right">Total actions</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dash.officerActivity.map((o) => (
              <tr key={o.officer}>
                <td className="py-1.5 font-medium text-slate-800">{o.officer}</td>
                <td className="text-right tabular-nums">{o.openCases ?? 0}</td>
                <td className="text-right tabular-nums">{o.calls}</td>
                <td className="text-right tabular-nums">{o.visits}</td>
                <td className="text-right tabular-nums">{o.messages}</td>
                <td className="text-right tabular-nums">{o.promises}</td>
                <td className="text-right tabular-nums">{o.escalations}</td>
                <td className="text-right font-semibold tabular-nums">{o.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-slate-400 xl:col-span-2">
        <CalendarCheck size={12} className="mr-1 inline" />
        Figures are objective indicators for staff review. A single missed payment does not by itself mark anyone as high risk.
      </p>
    </div>
  )
}

function Mini({ k, v, bad, good }: { k: string; v: string; bad?: boolean; good?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[11px] text-slate-400">{k}</p>
      <p className={clsx('font-semibold tabular-nums', bad ? 'text-accent-600' : good ? 'text-emerald-700' : 'text-slate-800')}>{v}</p>
    </div>
  )
}
