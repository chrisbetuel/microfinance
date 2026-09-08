import { useMemo, useState } from 'react'
import { Users, Plus, AlertTriangle, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatTile } from '../../components/ui/StatTile'
import { Table } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import { formatMoney } from '../../lib/format'
import { daysLate } from '../../lib/selectors'
import { useCanEdit } from '../../lib/useCanEdit'
import type { BorrowerGroup, GroupMemberRole } from '../../types'

const roleTone: Record<GroupMemberRole, 'blue' | 'green' | 'amber' | 'slate'> = {
  chair: 'blue',
  secretary: 'green',
  treasurer: 'amber',
  member: 'slate',
}
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export default function Groups() {
  const groups = useStore((s) => s.groups)
  const branches = useStore((s) => s.branches)
  const staff = useStore((s) => s.staff)
  const loans = useStore((s) => s.loans)
  const currency = useStore((s) => s.lender.currency)
  const createGroup = useStore((s) => s.createGroup)
  const canEdit = useCanEdit()

  const [openId, setOpenId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', branchId: '', officerId: '', meetingDay: 'Monday' })

  const officers = staff.filter((s) => ['loan_officer', 'branch_manager'].includes(s.role))

  const rows = useMemo(
    () =>
      groups.map((g) => {
        const memberIds = g.memberships.filter((m) => m.active).map((m) => m.borrowerId)
        const memberLoans = loans.filter((l) => memberIds.includes(l.borrowerId) && l.status === 'active')
        const outstanding = memberLoans.reduce((s, l) => s + l.outstandingBalance, 0)
        const inArrears = memberLoans.filter((l) => daysLate(l) > 0)
        return {
          group: g,
          members: memberIds.length,
          outstanding,
          arrearsMembers: new Set(inArrears.map((l) => l.borrowerId)).size,
          arrearsAmount: inArrears.reduce((s, l) => s + (l.arrearsAmount || 0), 0),
        }
      }),
    [groups, loans],
  )

  const openGroup = openId ? groups.find((g) => g.id === openId) : undefined
  const openRow = openId ? rows.find((r) => r.group.id === openId) : undefined

  const totalMembers = rows.reduce((s, r) => s + r.members, 0)
  const groupsAtRisk = rows.filter((r) => r.arrearsMembers > 0).length

  async function submitForm() {
    setBusy(true)
    try {
      const id = await createGroup(form)
      setFormOpen(false)
      setForm({ name: '', branchId: '', officerId: '', meetingDay: 'Monday' })
      setOpenId(id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Groups"
        subtitle="Solidarity groups — members guarantee each other's loans"
        action={
          canEdit && (
            <Button icon={<Plus size={15} />} onClick={() => setFormOpen(true)}>
              Form group
            </Button>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Groups" value={groups.length.toString()} icon={<Users size={16} />} tone="brand" />
        <StatTile label="Total members" value={totalMembers.toString()} tone="brand" />
        <StatTile
          label="Group outstanding"
          value={formatMoney(rows.reduce((s, r) => s + r.outstanding, 0), currency)}
          tone="brand"
        />
        <StatTile
          label="Groups with arrears"
          value={groupsAtRisk.toString()}
          icon={<AlertTriangle size={16} />}
          tone={groupsAtRisk > 0 ? 'red' : 'green'}
        />
      </div>

      <Table
        rowKey={(r) => r.group.id}
        rows={rows}
        onRowClick={(r) => setOpenId(r.group.id)}
        emptyMessage="No groups yet."
        filterPlaceholder="Filter by group name"
        filterAccessor={(r) => r.group.name}
        columns={[
          { header: 'Group', cell: (r) => <span className="font-medium text-slate-800">{r.group.name}</span>, sort: (r) => r.group.name },
          { header: 'Branch', cell: (r) => branches.find((b) => b.id === r.group.branchId)?.name ?? '—' },
          { header: 'Officer', cell: (r) => staff.find((s) => s.id === r.group.officerId)?.name ?? '—' },
          { header: 'Members', cell: (r) => r.members, sort: (r) => r.members },
          { header: 'Meeting', cell: (r) => r.group.meetingDay || '—' },
          { header: 'Outstanding', cell: (r) => formatMoney(r.outstanding, currency), sort: (r) => r.outstanding },
          {
            header: 'Joint liability',
            cell: (r) =>
              r.arrearsMembers > 0 ? (
                <Badge tone="red" dot>
                  {r.arrearsMembers} in arrears · {formatMoney(r.arrearsAmount, currency)}
                </Badge>
              ) : (
                <Badge tone="green" dot>
                  Current
                </Badge>
              ),
          },
        ]}
      />

      <Modal open={!!openGroup} onClose={() => setOpenId(null)} title={openGroup?.name ?? 'Group'} wide>
        {openGroup && openRow && (
          <GroupPanel group={openGroup} outstanding={openRow.outstanding} arrearsAmount={openRow.arrearsAmount} currency={currency} canEdit={canEdit} />
        )}
      </Modal>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Form a group">
        <div className="space-y-4">
          <Field label="Group name">
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Branch">
              <select className={inputClass} value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                <option value="">Select…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Field officer">
              <select className={inputClass} value={form.officerId} onChange={(e) => setForm({ ...form, officerId: e.target.value })}>
                <option value="">Select…</option>
                {officers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Meeting day">
            <select className={inputClass} value={form.meetingDay} onChange={(e) => setForm({ ...form, meetingDay: e.target.value })}>
              {weekdays.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
          <Button className="w-full" disabled={busy || !form.name || !form.branchId || !form.officerId} onClick={submitForm}>
            {busy ? 'Creating…' : 'Form group'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function GroupPanel({
  group,
  outstanding,
  arrearsAmount,
  currency,
  canEdit,
}: {
  group: BorrowerGroup
  outstanding: number
  arrearsAmount: number
  currency: string
  canEdit: boolean
}) {
  const borrowers = useStore((s) => s.borrowers)
  const loans = useStore((s) => s.loans)
  const addGroupMember = useStore((s) => s.addGroupMember)
  const removeGroupMember = useStore((s) => s.removeGroupMember)

  const [addBorrowerId, setAddBorrowerId] = useState('')
  const [addRole, setAddRole] = useState<GroupMemberRole>('member')
  const [busy, setBusy] = useState(false)

  const memberBorrowerIds = new Set(group.memberships.map((m) => m.borrowerId))
  const candidates = borrowers.filter((b) => !memberBorrowerIds.has(b.id) && b.branchId === group.branchId && !b.blacklisted)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200/70">
          <p className="text-[11px] font-medium uppercase text-slate-400">Members</p>
          <p className="text-lg font-bold text-slate-900">{group.memberships.length}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200/70">
          <p className="text-[11px] font-medium uppercase text-slate-400">Group outstanding</p>
          <p className="text-lg font-bold text-slate-900">{formatMoney(outstanding, currency)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200/70">
          <p className="text-[11px] font-medium uppercase text-slate-400">In arrears</p>
          <p className={`text-lg font-bold ${arrearsAmount > 0 ? 'text-accent-600' : 'text-emerald-600'}`}>
            {formatMoney(arrearsAmount, currency)}
          </p>
        </div>
      </div>

      {arrearsAmount > 0 && (
        <p className="rounded-lg bg-accent-50 px-3 py-2 text-xs text-accent-800">
          A member is behind. Under joint liability the whole group is responsible for clearing this balance.
        </p>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-800">Members</p>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {group.memberships.map((m) => {
            const memberLoans = loans.filter((l) => l.borrowerId === m.borrowerId && l.status === 'active')
            const memberOut = memberLoans.reduce((s, l) => s + l.outstandingBalance, 0)
            const late = memberLoans.some((l) => daysLate(l) > 0)
            return (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Badge tone={roleTone[m.role]}>{m.role}</Badge>
                <Link to={`/borrowers/${m.borrowerId}`} className="flex-1 text-sm font-medium text-slate-800 hover:text-brand-600 hover:underline">
                  {m.borrowerName}
                </Link>
                {memberOut > 0 && (
                  <span className={`text-xs ${late ? 'font-semibold text-accent-600' : 'text-slate-500'}`}>
                    {formatMoney(memberOut, currency)} {late ? '· overdue' : ''}
                  </span>
                )}
                {canEdit && (
                  <button
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await removeGroupMember(group.id, m.id)
                      } finally {
                        setBusy(false)
                      }
                    }}
                    className="text-slate-300 hover:text-accent-600"
                    title="Remove from group"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            )
          })}
          {group.memberships.length === 0 && <li className="px-4 py-4 text-sm text-slate-400">No members yet.</li>}
        </ul>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 p-3">
          <Field label="Add member">
            <select className={inputClass} value={addBorrowerId} onChange={(e) => setAddBorrowerId(e.target.value)}>
              <option value="">Select a borrower…</option>
              {candidates.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Role">
            <select className={inputClass} value={addRole} onChange={(e) => setAddRole(e.target.value as GroupMemberRole)}>
              <option value="member">Member</option>
              <option value="chair">Chair</option>
              <option value="secretary">Secretary</option>
              <option value="treasurer">Treasurer</option>
            </select>
          </Field>
          <Button
            size="sm"
            disabled={busy || !addBorrowerId}
            onClick={async () => {
              setBusy(true)
              try {
                await addGroupMember(group.id, addBorrowerId, addRole)
                setAddBorrowerId('')
              } finally {
                setBusy(false)
              }
            }}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  )
}
