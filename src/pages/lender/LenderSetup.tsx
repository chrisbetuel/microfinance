import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Tabs } from '../../components/ui/Tabs'
import { Field, inputClass } from '../../components/ui/Field'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Table } from '../../components/ui/Table'
import { Modal } from '../../components/ui/Modal'
import { STAFF_ROLE_LABELS, type StaffRole } from '../../types'
import { formatDate, formatMoney } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'

const tabs = [
  { id: 'profile', label: 'Lender Profile' },
  { id: 'branches', label: 'Branches' },
  { id: 'staff', label: 'Staff & Roles' },
  { id: 'calendar', label: 'Working Calendar' },
  { id: 'subscription', label: 'Subscription' },
]

export default function LenderSetup() {
  const [tab, setTab] = useState('profile')

  return (
    <div>
      <PageHeader title="Lender Setup & Separation" subtitle="Your branded, private workspace — branches, staff, roles and settings" />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="mt-6">
        {tab === 'profile' && <ProfileTab />}
        {tab === 'branches' && <BranchesTab />}
        {tab === 'staff' && <StaffTab />}
        {tab === 'calendar' && <CalendarTab />}
        {tab === 'subscription' && <SubscriptionTab />}
      </div>
    </div>
  )
}

function ProfileTab() {
  const lender = useStore((s) => s.lender)
  const updateLender = useStore((s) => s.updateLender)
  const canEdit = useCanEdit()
  const [form, setForm] = useState(lender)

  return (
    <Card className="max-w-2xl">
      <CardHeader title="Registered details" subtitle="Shown on statements, agreements and SMS sign-off" />
      {!canEdit && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Your account has view-only access to lender settings.
        </div>
      )}
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault()
          await updateLender(form)
        }}
      >
        <fieldset disabled={!canEdit} className="contents">
          <Field label="Registered name">
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Licence number">
            <input className={inputClass} value={form.licenceNumber} onChange={(e) => setForm({ ...form, licenceNumber: e.target.value })} />
          </Field>
          <Field label="Licence expiry">
            <input type="date" className={inputClass} value={form.licenceExpiry} onChange={(e) => setForm({ ...form, licenceExpiry: e.target.value })} />
          </Field>
          <Field label="Currency">
            <input className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          </Field>
          <Field label="Address" hint="Shown on offer letters and statements">
            <input className={inputClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Email">
            <input className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Default language">
            <select className={inputClass} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as 'sw' | 'en' })}>
              <option value="sw">Kiswahili</option>
              <option value="en">English</option>
            </select>
          </Field>
          <Field label="Brand colour">
            <input type="color" className="h-10 w-full rounded-lg border border-slate-300" value={form.brandColor} onChange={(e) => setForm({ ...form, brandColor: e.target.value })} />
          </Field>
          <Field label="Logo initials">
            <input maxLength={3} className={inputClass} value={form.logoInitials} onChange={(e) => setForm({ ...form, logoInitials: e.target.value.toUpperCase() })} />
          </Field>
          {canEdit && (
            <div className="sm:col-span-2">
              <Button type="submit">Save changes</Button>
            </div>
          )}
        </fieldset>
      </form>
    </Card>
  )
}

function BranchesTab() {
  const branches = useStore((s) => s.branches)
  const addBranch = useStore((s) => s.addBranch)
  const canEdit = useCanEdit()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', code: '', location: '', openedOn: new Date().toISOString().slice(0, 10) })

  return (
    <div>
      {canEdit && (
        <div className="mb-4 flex justify-end">
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)}>
            Add branch
          </Button>
        </div>
      )}
      <Table
        rowKey={(b) => b.id}
        rows={branches}
        columns={[
          { header: 'Branch', cell: (b) => <span className="font-medium text-slate-800">{b.name}</span> },
          { header: 'Code', cell: (b) => b.code },
          { header: 'Location', cell: (b) => b.location },
          { header: 'Opened', cell: (b) => formatDate(b.openedOn) },
        ]}
      />
      <Modal open={open} onClose={() => setOpen(false)} title="Add branch">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            await addBranch(form)
            setOpen(false)
            setForm({ name: '', code: '', location: '', openedOn: new Date().toISOString().slice(0, 10) })
          }}
        >
          <Field label="Branch name">
            <input required className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Branch code">
            <input required className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Location">
            <input required className={inputClass} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </Field>
          <Field label="Opening date">
            <input type="date" required className={inputClass} value={form.openedOn} onChange={(e) => setForm({ ...form, openedOn: e.target.value })} />
          </Field>
          <Button type="submit" className="w-full">
            Create branch
          </Button>
        </form>
      </Modal>
    </div>
  )
}

function StaffTab() {
  const staff = useStore((s) => s.staff)
  const branches = useStore((s) => s.branches)
  const addStaff = useStore((s) => s.addStaff)
  const updateStaff = useStore((s) => s.updateStaff)
  const toggleStaffActive = useStore((s) => s.toggleStaffActive)
  const canEdit = useCanEdit()
  const [open, setOpen] = useState(false)
  const emptyForm = { name: '', role: 'loan_officer' as StaffRole, branchId: branches[0]?.id ?? '', approvalLimit: 0, email: '', phone: '', password: '', active: true }
  const [form, setForm] = useState(emptyForm)

  const [editId, setEditId] = useState<string | null>(null)
  const editing = staff.find((s) => s.id === editId)
  const [editForm, setEditForm] = useState({ name: '', role: 'loan_officer' as StaffRole, branchId: '', approvalLimit: 0 })
  const [savingEdit, setSavingEdit] = useState(false)

  function openEdit(m: typeof staff[number]) {
    setEditForm({ name: m.name, role: m.role, branchId: m.branchId ?? '', approvalLimit: m.approvalLimit })
    setEditId(m.id)
  }

  return (
    <div>
      {canEdit && (
        <div className="mb-4 flex justify-end">
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)}>
            Add staff member
          </Button>
        </div>
      )}
      <Table
        rowKey={(s) => s.id}
        rows={staff}
        columns={[
          { header: 'Name', cell: (s) => <span className="font-medium text-slate-800">{s.name}</span> },
          { header: 'Role', cell: (s) => STAFF_ROLE_LABELS[s.role] },
          { header: 'Branch', cell: (s) => branches.find((b) => b.id === s.branchId)?.name ?? 'All branches' },
          { header: 'Approval limit', cell: (s) => (s.approvalLimit > 0 ? formatMoney(s.approvalLimit) : '—') },
          { header: 'Status', cell: (s) => <Badge tone={s.active ? 'green' : 'slate'}>{s.active ? 'Active' : 'Suspended'}</Badge> },
          {
            header: '',
            cell: (s) =>
              canEdit && (
                <div className="flex justify-end gap-3">
                  <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => openEdit(s)}>
                    Edit
                  </button>
                  <button className="text-xs font-medium text-slate-500 hover:text-red-600" onClick={() => void toggleStaffActive(s.id)}>
                    {s.active ? 'Suspend' : 'Reactivate'}
                  </button>
                </div>
              ),
          },
        ]}
      />

      <Modal open={!!editing} onClose={() => setEditId(null)} title={`Edit — ${editing?.name ?? ''}`}>
        {editing && (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              setSavingEdit(true)
              try {
                await updateStaff(editing.id, {
                  name: editForm.name,
                  role: editForm.role,
                  branchId: editForm.branchId || null,
                  approvalLimit: editForm.approvalLimit,
                })
                setEditId(null)
              } finally {
                setSavingEdit(false)
              }
            }}
          >
            <Field label="Full name">
              <input required className={inputClass} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </Field>
            <Field label="Role">
              <select className={inputClass} value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value as StaffRole })}>
                {Object.entries(STAFF_ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Branch">
              <select className={inputClass} value={editForm.branchId} onChange={(e) => setEditForm({ ...editForm, branchId: e.target.value })}>
                <option value="">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Approval limit" hint="0 if this role does not approve loans">
              <input type="number" className={inputClass} value={editForm.approvalLimit} onChange={(e) => setEditForm({ ...editForm, approvalLimit: Number(e.target.value) })} />
            </Field>
            <Button type="submit" className="w-full" disabled={savingEdit}>
              {savingEdit ? 'Saving…' : 'Save changes'}
            </Button>
          </form>
        )}
      </Modal>
      <Modal open={open} onClose={() => setOpen(false)} title="Add staff member">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            await addStaff(form)
            setOpen(false)
            setForm(emptyForm)
          }}
        >
          <Field label="Full name">
            <input required className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Role">
            <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
              {Object.entries(STAFF_ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Branch">
            <select className={inputClass} value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Approval limit" hint="Leave 0 if this role does not approve loans">
            <input type="number" className={inputClass} value={form.approvalLimit} onChange={(e) => setForm({ ...form, approvalLimit: Number(e.target.value) })} />
          </Field>
          <Field label="Email">
            <input type="email" required className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input required className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Temporary password" hint="The staff member signs in with this and can change it later">
            <input type="text" required minLength={8} className={inputClass} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Button type="submit" className="w-full">
            Create account
          </Button>
        </form>
      </Modal>
    </div>
  )
}

function CalendarTab() {
  const holidays = useStore((s) => s.holidays)
  const addHoliday = useStore((s) => s.addHoliday)
  const removeHoliday = useStore((s) => s.removeHoliday)
  const canEdit = useCanEdit()
  const [form, setForm] = useState({ date: '', name: '' })

  return (
    <Card className="max-w-xl">
      <CardHeader title="Public holidays & non-working days" subtitle="Due dates never fall on a day nobody can pay" />
      {canEdit && (
        <form
          className="mb-4 flex items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!form.date || !form.name) return
            await addHoliday(form)
            setForm({ date: '', name: '' })
          }}
        >
          <Field label="Date">
            <input type="date" required className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="Name">
            <input required className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Button type="submit" size="sm">
            Add
          </Button>
        </form>
      )}
      <ul className="divide-y divide-slate-100">
        {holidays
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((h) => (
            <li key={h.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-slate-700">
                {formatDate(h.date)} — {h.name}
              </span>
              {canEdit && (
                <button onClick={() => void removeHoliday(h.id)} className="text-slate-400 hover:text-red-600">
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          ))}
      </ul>
    </Card>
  )
}

function SubscriptionTab() {
  const lender = useStore((s) => s.lender)
  const staff = useStore((s) => s.staff)
  const loans = useStore((s) => s.loans)
  const activeLoans = loans.filter((l) => l.status === 'active').length

  return (
    <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader title="Plan" />
        <p className="text-2xl font-semibold capitalize text-slate-900">{lender.planLevel}</p>
        <p className="mt-1 text-sm text-slate-500">Staff: {staff.length} / {lender.staffLimit}</p>
        <p className="text-sm text-slate-500">Active loans: {activeLoans} / {lender.activeLoanLimit}</p>
      </Card>
      <Card>
        <CardHeader title="SMS" />
        <p className="text-2xl font-semibold text-slate-900">{lender.smsBalance.toLocaleString()}</p>
        <p className="mt-1 text-sm text-slate-500">Credits remaining</p>
        <p className="mt-2 text-sm text-slate-500">
          Sender name: <span className="font-medium text-slate-700">{lender.smsSenderName}</span>{' '}
          <Badge tone={lender.smsSenderApproved ? 'green' : 'amber'} className="ml-1">
            {lender.smsSenderApproved ? 'Approved' : 'Pending network approval'}
          </Badge>
        </p>
      </Card>
    </div>
  )
}
