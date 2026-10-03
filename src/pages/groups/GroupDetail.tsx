import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Pencil, MessageSquare, Plus, CalendarPlus, FileText, Users, Wallet, TrendingUp, AlertTriangle, PiggyBank } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import type { BadgeTone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Tabs } from '../../components/ui/Tabs'
import { Table } from '../../components/ui/Table'
import { StatTile } from '../../components/ui/StatTile'
import { Field, inputClass } from '../../components/ui/Field'
import { formatDate, formatDateTime, formatMoney } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'
import type { BorrowerGroup, GroupMemberRole, GroupMemberStatus, GroupStatus } from '../../types'
import { GROUP_TYPE_LABELS, groupSummary } from './groupStats'
import type { GroupLoanStatus } from './groupStats'
import { GROUP_STATUS_TONE } from './Groups'
import { GroupPaymentsTab } from './GroupPayments'

const ROLE_LABEL: Record<GroupMemberRole, string> = { chair: 'Chairperson', secretary: 'Secretary', treasurer: 'Treasurer', member: 'Member' }
const ROLE_TONE: Record<GroupMemberRole, BadgeTone> = { chair: 'blue', secretary: 'green', treasurer: 'amber', member: 'slate' }
const MEMBER_TONE: Record<GroupMemberStatus, BadgeTone> = { active: 'green', inactive: 'slate', suspended: 'red', left: 'slate' }
const LOAN_TONE: Record<GroupLoanStatus, BadgeTone> = {
  Pending: 'amber', Approved: 'blue', Declined: 'slate', Active: 'violet', Overdue: 'red', Completed: 'green', Defaulted: 'red',
}
const FREQ: Record<string, string> = { weekly: 'Weekly', biweekly: 'Every two weeks', monthly: 'Monthly' }

const TABS = [
  { id: 'members', label: 'Members' },
  { id: 'loans', label: 'Group loans' },
  { id: 'payments', label: 'Group payments' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'documents', label: 'Documents' },
  { id: 'history', label: 'History' },
]

export default function GroupDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const group = useStore((s) => s.groups.find((g) => g.id === id))
  const branches = useStore((s) => s.branches)
  const staff = useStore((s) => s.staff)
  const applications = useStore((s) => s.applications)
  const loans = useStore((s) => s.loans)
  const repayments = useStore((s) => s.repayments)
  const currency = useStore((s) => s.lender.currency)
  const updateGroup = useStore((s) => s.updateGroup)
  const canEdit = useCanEdit()
  const [tab, setTab] = useState('members')
  const [statusOpen, setStatusOpen] = useState(false)

  if (!group) {
    return (
      <div className="py-20 text-center text-sm text-slate-500">
        Group not found. <Link to="/groups" className="text-brand-600 underline">Back to groups</Link>
      </div>
    )
  }

  const s = groupSummary(group, applications, loans, repayments)
  const money = (n: number) => formatMoney(n, currency)
  const leader = (role: GroupMemberRole) => group.memberships.find((m) => m.role === role && m.status !== 'left')

  return (
    <div>
      <PageHeader
        title={group.name}
        subtitle={`${group.groupNumber} · ${GROUP_TYPE_LABELS[group.groupType] ?? group.groupType} group · formed ${formatDate(group.formedOn)}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<MessageSquare size={15} />} onClick={() => navigate(`/messages?group=${group.id}`)}>
              SMS group
            </Button>
            {canEdit && (
              <>
                <Button variant="secondary" onClick={() => setStatusOpen(true)}>Change status</Button>
                <Button icon={<Pencil size={15} />} onClick={() => navigate(`/groups/${group.id}/edit`)}>Edit group</Button>
              </>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={GROUP_STATUS_TONE[group.status]} dot className="capitalize">{group.status}</Badge>
        <Badge>{branches.find((b) => b.id === group.branchId)?.name ?? '—'}</Badge>
        {s.overdueMembers > 0 && (
          <Badge tone="red" dot>Joint liability: {s.overdueMembers} member(s) overdue</Badge>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Active members" value={String(s.activeMembers)} hint={`${group.memberships.length} ever joined`} icon={<Users size={16} />} tone="brand" />
        <StatTile label="Group savings" value={money(s.savings)} hint={`Contributions ${money(s.contributions)}`} icon={<PiggyBank size={16} />} tone="brand" />
        <StatTile
          label="Outstanding"
          value={money(s.outstanding)}
          hint={group.loanLimit ? `Limit ${money(group.loanLimit)}${s.limitUsed != null ? ` · ${s.limitUsed.toFixed(0)}% used` : ''}` : 'No limit set'}
          icon={<Wallet size={16} />}
          tone="brand"
        />
        <StatTile
          label="Overdue"
          value={money(s.overdue)}
          hint={`${s.overdueMembers} overdue member(s)`}
          icon={<AlertTriangle size={16} />}
          tone={s.overdue > 0 ? 'red' : 'green'}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Group information</h3>
          <dl className="space-y-1.5 text-sm">
            <Info k="Purpose" v={group.purpose} />
            <Info k="Location" v={[group.location, group.ward, group.district, group.region].filter(Boolean).join(', ')} />
            <Info k="Meets" v={`${FREQ[group.meetingFrequency] ?? group.meetingFrequency}, ${group.meetingDay}${group.meetingTime ? ` ${group.meetingTime}` : ''}`} />
            <Info k="Meeting place" v={group.meetingLocation} />
          </dl>
        </Card>
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Leadership</h3>
          <dl className="space-y-1.5 text-sm">
            {(['chair', 'secretary', 'treasurer'] as const).map((r) => {
              const m = leader(r)
              return (
                <Info
                  key={r}
                  k={ROLE_LABEL[r]}
                  v={m ? <Link to={`/borrowers/${m.borrowerId}`} className="hover:text-brand-600 hover:underline">{m.borrowerName}</Link> : 'Not assigned'}
                />
              )
            })}
            <Info k="Group officer" v={staff.find((x) => x.id === group.officerId)?.name} />
          </dl>
        </Card>
        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><TrendingUp size={15} /> Performance</h3>
          <dl className="space-y-1.5 text-sm">
            <Info k="Repayment rate" v={s.repaymentRate == null ? 'No instalments due yet' : `${s.repaymentRate.toFixed(1)}%`} />
            <Info k="Active loans" v={String(s.activeLoans)} />
            <Info k="Overdue members" v={String(s.overdueMembers)} />
            <Info k="Total repaid" v={money(s.repaid)} />
            <Info k="Total contributions" v={money(s.contributions)} />
            <Info k="Meeting attendance" v={s.attendanceRate == null ? '—' : `${s.attendanceRate.toFixed(0)}%`} />
          </dl>
        </Card>
      </div>

      <Card className="p-5">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        <div className="mt-5">
          {tab === 'members' && <MembersTab group={group} canEdit={canEdit} />}
          {tab === 'loans' && (
            <Table
              rowKey={(r) => r.key}
              rows={s.rows}
              emptyMessage="No group loans yet. Applications tagged with this group appear here."
              onRowClick={(r) => navigate(`/applications/${r.key}`)}
              columns={[
                { header: 'Reference', cell: (r) => <span className="font-mono text-xs">{r.reference}</span> },
                { header: 'Member', cell: (r) => group.memberships.find((m) => m.borrowerId === r.borrowerId)?.borrowerName ?? '—' },
                { header: 'Purpose', cell: (r) => r.purpose || '—' },
                { header: 'Requested', cell: (r) => money(r.requested), sort: (r) => r.requested },
                { header: 'Approved', cell: (r) => (r.approved == null ? '—' : money(r.approved)) },
                { header: 'Terms', cell: (r) => <ProductTerms productId={r.productId} instalments={r.termInstalments} /> },
                { header: 'Outstanding', cell: (r) => money(r.outstanding), sort: (r) => r.outstanding },
                { header: 'Status', cell: (r) => <Badge tone={LOAN_TONE[r.status]} dot>{r.status}</Badge>, sort: (r) => r.status },
              ]}
            />
          )}
          {tab === 'payments' && <GroupPaymentsTab group={group} canEdit={canEdit} />}
          {tab === 'meetings' && <MeetingsTab group={group} canEdit={canEdit} />}
          {tab === 'documents' && <DocumentsTab group={group} canEdit={canEdit} />}
          {tab === 'history' && (
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {group.history.length === 0 && <li className="text-sm text-slate-400">No history yet.</li>}
              {group.history.map((h) => (
                <li key={h.id}>
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" />
                  <p className="text-sm font-medium text-slate-800">{h.label}</p>
                  <p className="text-xs text-slate-500">{h.detail}</p>
                  <p className="text-xs text-slate-400">{formatDateTime(h.date)}{h.by ? ` · ${h.by}` : ''}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>

      <StatusModal
        open={statusOpen}
        current={group.status}
        onClose={() => setStatusOpen(false)}
        onSave={async (status) => {
          await updateGroup(group.id, { status })
          setStatusOpen(false)
        }}
      />
    </div>
  )
}

function Info({ k, v }: { k: string; v?: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{k}</dt>
      <dd className="text-right font-medium text-slate-800">{v || '—'}</dd>
    </div>
  )
}

function ProductTerms({ productId, instalments }: { productId: string; instalments: number }) {
  const p = useStore((s) => s.products.find((x) => x.id === productId))
  if (!p) return <span>{instalments} instalments</span>
  return (
    <span className="text-xs text-slate-600">
      {p.interestRate}% · {instalments} × {p.repaymentFrequency}
    </span>
  )
}

function StatusModal({ open, current, onClose, onSave }: { open: boolean; current: GroupStatus; onClose: () => void; onSave: (s: GroupStatus) => Promise<void> }) {
  const [value, setValue] = useState<GroupStatus>(current)
  const [busy, setBusy] = useState(false)
  return (
    <Modal open={open} onClose={onClose} title="Group status">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(['pending', 'active', 'suspended', 'closed'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setValue(st)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-medium capitalize ${value === st ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600'}`}
            >
              {st}
            </button>
          ))}
        </div>
        <Button
          className="w-full"
          disabled={busy || value === current}
          onClick={async () => {
            setBusy(true)
            try {
              await onSave(value)
            } finally {
              setBusy(false)
            }
          }}
        >
          Save status
        </Button>
      </div>
    </Modal>
  )
}

function MembersTab({ group, canEdit }: { group: BorrowerGroup; canEdit: boolean }) {
  const borrowers = useStore((s) => s.borrowers)
  const loans = useStore((s) => s.loans)
  const currency = useStore((s) => s.lender.currency)
  const addGroupMember = useStore((s) => s.addGroupMember)
  const updateGroupMember = useStore((s) => s.updateGroupMember)
  const [adding, setAdding] = useState(false)
  const [addId, setAddId] = useState('')
  const [addRole, setAddRole] = useState<GroupMemberRole>('member')
  const [busy, setBusy] = useState(false)

  const current = new Set(group.memberships.filter((m) => m.status !== 'left').map((m) => m.borrowerId))
  const candidates = borrowers.filter((b) => !current.has(b.id) && b.branchId === group.branchId && b.status !== 'blacklisted')

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)}>Add member</Button>
        </div>
      )}
      <Table
        rowKey={(m) => m.id}
        rows={group.memberships}
        emptyMessage="No members yet."
        columns={[
          { header: 'Membership no.', cell: (m) => <span className="font-mono text-xs text-slate-500">{m.membershipNumber}</span>, sort: (m) => m.membershipNumber },
          {
            header: 'Member',
            cell: (m) => (
              <Link to={`/borrowers/${m.borrowerId}`} className="font-medium text-slate-800 hover:text-brand-600 hover:underline">
                {m.borrowerName}
              </Link>
            ),
            sort: (m) => m.borrowerName,
          },
          { header: 'Phone', cell: (m) => m.borrowerPhone },
          {
            header: 'Role',
            cell: (m) =>
              canEdit && m.status !== 'left' ? (
                <select
                  className="rounded-lg border border-slate-200 bg-transparent px-2 py-1 text-xs"
                  value={m.role}
                  onChange={(e) => updateGroupMember(group.id, m.id, { role: e.target.value as GroupMemberRole })}
                >
                  {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : (
                <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
              ),
          },
          { header: 'Joined', cell: (m) => formatDate(m.joinedOn), sort: (m) => m.joinedOn },
          {
            header: 'Loan',
            cell: (m) => {
              const out = loans.filter((l) => l.borrowerId === m.borrowerId && l.status === 'active').reduce((s, l) => s + l.outstandingBalance, 0)
              return out > 0 ? formatMoney(out, currency) : '—'
            },
          },
          {
            header: 'Status',
            cell: (m) =>
              canEdit && m.status !== 'left' ? (
                <select
                  className="rounded-lg border border-slate-200 bg-transparent px-2 py-1 text-xs capitalize"
                  value={m.status}
                  onChange={(e) => updateGroupMember(group.id, m.id, { status: e.target.value as GroupMemberStatus })}
                >
                  {(['active', 'inactive', 'suspended', 'left'] as const).map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              ) : (
                <Badge tone={MEMBER_TONE[m.status]} className="capitalize">
                  {m.status}{m.leftOn ? ` · ${formatDate(m.leftOn)}` : ''}
                </Badge>
              ),
          },
        ]}
      />

      <Modal open={adding} onClose={() => setAdding(false)} title="Add member">
        <div className="space-y-4">
          <Field label="Borrower" hint="Borrowers at the group's branch who aren't already members">
            <select className={inputClass} value={addId} onChange={(e) => setAddId(e.target.value)}>
              <option value="">Select a borrower…</option>
              {candidates.map((b) => <option key={b.id} value={b.id}>{b.fullName} · {b.customerNumber}</option>)}
            </select>
          </Field>
          <Field label="Role">
            <select className={inputClass} value={addRole} onChange={(e) => setAddRole(e.target.value as GroupMemberRole)}>
              {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Button
            className="w-full"
            disabled={busy || !addId}
            onClick={async () => {
              setBusy(true)
              try {
                await addGroupMember(group.id, addId, addRole)
                setAddId('')
                setAdding(false)
              } finally {
                setBusy(false)
              }
            }}
          >
            Add to group
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function MeetingsTab({ group, canEdit }: { group: BorrowerGroup; canEdit: boolean }) {
  const currency = useStore((s) => s.lender.currency)
  const recordGroupMeeting = useStore((s) => s.recordGroupMeeting)
  const active = group.memberships.filter((m) => m.status === 'active')
  const blank = () => ({
    date: new Date().toISOString().slice(0, 10),
    location: group.meetingLocation,
    notes: '',
    attendance: Object.fromEntries(active.map((m) => [m.id, { present: true, contribution: 0 }])) as Record<string, { present: boolean; contribution: number }>,
  })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const nameOf = (mid: string) => group.memberships.find((m) => m.id === mid)?.borrowerName ?? '—'
  const total = Object.values(form.attendance).reduce((s, a) => s + (a.present ? a.contribution : 0), 0)

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button
            size="sm"
            icon={<CalendarPlus size={14} />}
            onClick={() => {
              setForm(blank())
              setOpen(true)
            }}
          >
            Record meeting
          </Button>
        </div>
      )}
      {group.meetings.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No meetings recorded yet.</p>}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {group.meetings.map((mt) => {
          const present = mt.attendance.filter((a) => a.present).length
          return (
            <li key={mt.id}>
              <button onClick={() => setExpanded(expanded === mt.id ? null : mt.id)} className="flex w-full flex-wrap items-center gap-4 px-4 py-3 text-left hover:bg-slate-50">
                <span className="w-28 text-sm font-medium text-slate-800">{formatDate(mt.date)}</span>
                <span className="text-xs text-slate-500">{present}/{mt.attendance.length} present</span>
                <span className="flex-1 truncate text-xs text-slate-500">{mt.notes}</span>
                <span className="text-sm font-semibold text-brand-700">{formatMoney(mt.collectionAmount, currency)}</span>
              </button>
              {expanded === mt.id && (
                <div className="bg-slate-50 px-4 py-3 text-xs">
                  <p className="mb-2 text-slate-500">{mt.location || 'No location'} · recorded by {mt.recordedBy || '—'}</p>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {mt.attendance.map((a) => (
                      <div key={a.id} className="flex justify-between rounded-lg bg-white px-3 py-1.5">
                        <span className={a.present ? 'text-slate-700' : 'text-slate-400 line-through'}>{nameOf(a.membershipId)}</span>
                        <span>{a.present ? formatMoney(a.contribution, currency) : 'Absent'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <Modal open={open} onClose={() => setOpen(false)} title="Record meeting" wide>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date">
              <input type="date" className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Location">
              <input className={inputClass} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </Field>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Attendance & collections</p>
            <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {active.map((m) => {
                const a = form.attendance[m.id] ?? { present: false, contribution: 0 }
                const setA = (patch: Partial<typeof a>) => setForm((f) => ({ ...f, attendance: { ...f.attendance, [m.id]: { ...a, ...patch } } }))
                return (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" checked={a.present} onChange={(e) => setA({ present: e.target.checked })} />
                    <span className="flex-1">{m.borrowerName}</span>
                    <input
                      type="number"
                      min={0}
                      disabled={!a.present}
                      className="w-32 rounded-lg border border-slate-200 bg-transparent px-2 py-1 text-right text-sm disabled:opacity-40"
                      value={a.contribution}
                      onChange={(e) => setA({ contribution: Number(e.target.value) })}
                    />
                  </div>
                )
              })}
              {active.length === 0 && <p className="p-3 text-sm text-slate-400">No active members.</p>}
            </div>
            <p className="mt-2 text-right text-sm text-slate-600">Collected: <b>{formatMoney(total, currency)}</b></p>
          </div>
          <Field label="Notes">
            <textarea rows={3} className={inputClass} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <Button
            className="w-full"
            disabled={busy || active.length === 0}
            onClick={async () => {
              setBusy(true)
              try {
                await recordGroupMeeting(group.id, {
                  date: form.date,
                  location: form.location,
                  notes: form.notes,
                  attendance: Object.entries(form.attendance).map(([membershipId, a]) => ({
                    membershipId,
                    present: a.present,
                    contribution: a.present ? a.contribution : 0,
                  })),
                })
                setOpen(false)
              } finally {
                setBusy(false)
              }
            }}
          >
            Save meeting
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function DocumentsTab({ group, canEdit }: { group: BorrowerGroup; canEdit: boolean }) {
  const addGroupDocument = useStore((s) => s.addGroupDocument)
  const [type, setType] = useState('Group constitution')
  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-xs" value={type} onChange={(e) => setType(e.target.value)}>
            {['Group constitution', 'Registration certificate', 'Meeting minutes', 'Members list', 'Other'].map((t) => <option key={t}>{t}</option>)}
          </select>
          <label className="cursor-pointer rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
            Attach document
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) addGroupDocument(group.id, f.name, type)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      )}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {group.documents.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">No documents attached.</li>}
        {group.documents.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <FileText size={15} className="text-brand-600" />
            <span className="flex-1 font-medium text-slate-800">{d.name}</span>
            <Badge>{d.type}</Badge>
            <span className="text-xs text-slate-400">{formatDate(d.uploadedAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
