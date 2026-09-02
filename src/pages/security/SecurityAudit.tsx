import { useState } from 'react'
import { ShieldCheck, KeyRound } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Tabs } from '../../components/ui/Tabs'
import { Table } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { BorrowerLink } from '../../components/ui/BorrowerLink'
import { STAFF_ROLE_LABELS, type StaffRole } from '../../types'
import { formatDateTime } from '../../lib/format'

const tabs = [
  { id: 'trail', label: 'Audit trail' },
  { id: 'messages', label: 'Notifications' },
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

  return (
    <div>
      <PageHeader title="Security, Access & Audit" subtitle="Controls who can do what, and records everything that happens" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="mt-6">
        {tab === 'trail' && (
          <Table
            rowKey={(e) => e.id}
            rows={auditLog}
            columns={[
              { header: 'Time', cell: (e) => formatDateTime(e.timestamp) },
              { header: 'User', cell: (e) => e.userName },
              { header: 'Action', cell: (e) => <Badge tone="slate">{e.action}</Badge> },
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
              columns={[
                { header: 'Time', cell: (n) => formatDateTime(n.createdAt) },
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
    </div>
  )
}
