import { useState } from 'react'
import { ShieldCheck, KeyRound, Download } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Tabs } from '../../components/ui/Tabs'
import { Table } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import { BorrowerLink } from '../../components/ui/BorrowerLink'
import { STAFF_ROLE_LABELS, type StaffRole } from '../../types'
import { formatDateTime } from '../../lib/format'

const tabs = [
  { id: 'trail', label: 'Audit trail' },
  { id: 'messages', label: 'Notifications' },
  { id: 'exports', label: 'Export data' },
  { id: 'permissions', label: 'Permissions by role' },
]

const kindLabels: Record<string, string> = {
  receipt: 'Payment receipt',
  disbursed: 'Disbursement',
  decision: 'Application decision',
  arrears_reminder: 'Arrears reminder',
}

const permissionMatrix: Record<StaffRole, string[]> = {
  platform_admin: ['Create lender accounts', 'Set subscription limits', 'Monitor system health'],
  lender_admin: ['Full access within own lender', 'Manage branches, staff, products', 'Approve above any limit'],
  branch_manager: ['Approve loans up to branch limit', 'Monitor officers and arrears', 'Suspend staff'],
  loan_officer: ['Register borrowers', 'Capture applications', 'Record field collections'],
  credit_committee: ['Approve loans above branch limit', 'Decline applications'],
  cashier: ['Record payments', 'Reconcile statements', 'Handle disbursement'],
  auditor: ['View everything', 'Change nothing'],
}

export default function SecurityAudit() {
  const [tab, setTab] = useState('trail')
  const auditLog = useStore((s) => s.auditLog)
  const notifications = useStore((s) => s.notifications)
  const borrowers = useStore((s) => s.borrowers)
  const lender = useStore((s) => s.lender)
  const changePassword = useStore((s) => s.changePassword)
  const [pwOpen, setPwOpen] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')

  return (
    <div>
      <PageHeader title="Security, Access & Audit" subtitle="Controls who can do what, and records everything that happens" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="flex items-center gap-3">
          <span className="rounded-lg bg-brand-100 p-2 text-brand-600">
            <KeyRound size={18} />
          </span>
          <div>
            <p className="text-sm font-medium text-slate-800">Two-step login</p>
            <p className="text-xs text-slate-500">Required for any role that can approve or disburse</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3">
          <span className="rounded-lg bg-brand-100 p-2 text-brand-600">
            <ShieldCheck size={18} />
          </span>
          <div>
            <p className="text-sm font-medium text-slate-800">Approval limits enforced by the system</p>
            <p className="text-xs text-slate-500">Not by trust — see loan product approval levels</p>
          </div>
        </Card>
        <button
          type="button"
          className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)] text-left"
          onClick={() => setPwOpen(true)}
        >
          <span className="rounded-lg bg-brand-100 p-2 text-brand-600">
            <KeyRound size={18} />
          </span>
          <div>
            <p className="text-sm font-medium text-slate-800">Change password</p>
            <p className="text-xs text-slate-500">Update your account password</p>
          </div>
        </button>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="mt-6">
        {tab === 'trail' && (
          <Table
            rowKey={(e) => e.id}
            rows={auditLog}
            pageSize={25}
            filterPlaceholder="Filter by user, action or entity"
            filterAccessor={(e) => `${e.userName} ${e.action} ${e.entity} ${e.details}`}
            columns={[
              { header: 'Time', cell: (e) => formatDateTime(e.timestamp), sort: (e) => e.timestamp },
              { header: 'User', cell: (e) => e.userName, sort: (e) => e.userName },
              { header: 'Action', cell: (e) => <Badge tone="slate">{e.action}</Badge>, sort: (e) => e.action },
              { header: 'Entity', cell: (e) => `${e.entity} · ${e.entityId.slice(0, 8)}` },
              { header: 'Details', cell: (e) => <span className="text-slate-500">{e.details}</span> },
            ]}
          />
        )}

        {tab === 'messages' && (
          <div>
            <p className="mb-3 text-xs text-slate-500">
              Outbound SMS to borrowers · {lender.smsBalance.toLocaleString()} credits remaining
            </p>
            <Table
              rowKey={(n) => n.id}
              rows={notifications}
              pageSize={25}
              filterPlaceholder="Filter by borrower, type or status"
              filterAccessor={(n) =>
                `${n.to} ${kindLabels[n.kind] ?? n.kind} ${n.status} ${n.body} ${borrowers.find((b) => b.id === n.borrowerId)?.fullName ?? ''}`
              }
              columns={[
                { header: 'Time', cell: (n) => formatDateTime(n.createdAt), sort: (n) => n.createdAt },
                { header: 'Type', cell: (n) => kindLabels[n.kind] ?? n.kind },
                {
                  header: 'Borrower',
                  cell: (n) => (n.borrowerId ? <BorrowerLink id={n.borrowerId} borrowers={borrowers} /> : n.to),
                },
                { header: 'Message', cell: (n) => <span className="text-slate-500">{n.body}</span> },
                {
                  header: 'Status',
                  cell: (n) => (
                    <Badge tone={n.status === 'sent' ? 'green' : n.status === 'failed' ? 'red' : 'amber'}>
                      {n.status === 'failed' && n.error ? n.error : n.status}
                    </Badge>
                  ),
                },
              ]}
            />
          </div>
        )}

        {tab === 'exports' && (
          <Card className="max-w-lg">
            <CardHeader title="Export data" subtitle="Download CSV files for analysis, reporting or backup" />
            <div className="space-y-3">
              {[
                { label: 'Borrowers', path: '/export/borrowers', desc: 'All borrower records with contact details' },
                { label: 'Loans', path: '/export/loans', desc: 'All loans with status, balances and arrears' },
                { label: 'Repayments', path: '/export/repayments', desc: 'All repayment records with allocation breakdown' },
              ].map(({ label, path, desc }) => (
                <a
                  key={path}
                  href={`${apiBase}${path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">{label}</p>
                    <p className="text-xs text-slate-400">{desc}</p>
                  </div>
                  <Download size={16} className="text-slate-400" />
                </a>
              ))}
            </div>
          </Card>
        )}

        {tab === 'permissions' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Object.entries(permissionMatrix).map(([role, perms]) => (
              <Card key={role}>
                <CardHeader title={STAFF_ROLE_LABELS[role as StaffRole]} />
                <ul className="list-disc space-y-1 pl-4 text-sm text-slate-600">
                  {perms.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal open={pwOpen} onClose={() => { setPwOpen(false); setPwMsg('') }} title="Change password">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setPwBusy(true)
            setPwMsg('')
            try {
              await changePassword(currentPw, newPw)
              setPwMsg('Password updated successfully.')
              setCurrentPw('')
              setNewPw('')
            } catch (err) {
              setPwMsg(err instanceof Error ? err.message : 'Failed to change password')
            } finally {
              setPwBusy(false)
            }
          }}
        >
          <Field label="Current password">
            <input type="password" required className={inputClass} value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
          </Field>
          <Field label="New password" hint="Minimum 6 characters">
            <input type="password" required minLength={6} className={inputClass} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </Field>
          {pwMsg && (
            <p className={`text-sm ${pwMsg.includes('success') ? 'text-emerald-700' : 'text-red-700'}`}>{pwMsg}</p>
          )}
          <Button type="submit" className="w-full" disabled={pwBusy}>
            {pwBusy ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </Modal>
    </div>
  )
}
