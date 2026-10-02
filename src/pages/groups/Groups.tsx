import { useMemo } from 'react'
import { Users, Plus, AlertTriangle, Wallet } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatTile } from '../../components/ui/StatTile'
import { Table } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import type { BadgeTone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { formatMoney } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'
import type { GroupStatus } from '../../types'
import { GROUP_TYPE_LABELS, groupSummary } from './groupStats'

export const GROUP_STATUS_TONE: Record<GroupStatus, BadgeTone> = {
  pending: 'amber',
  active: 'green',
  suspended: 'red',
  closed: 'slate',
}

export default function Groups() {
  const navigate = useNavigate()
  const groups = useStore((s) => s.groups)
  const branches = useStore((s) => s.branches)
  const staff = useStore((s) => s.staff)
  const applications = useStore((s) => s.applications)
  const loans = useStore((s) => s.loans)
  const repayments = useStore((s) => s.repayments)
  const currency = useStore((s) => s.lender.currency)
  const canEdit = useCanEdit()

  const rows = useMemo(
    () => groups.map((g) => ({ group: g, ...groupSummary(g, applications, loans, repayments) })),
    [groups, applications, loans, repayments],
  )

  const totalMembers = rows.reduce((s, r) => s + r.activeMembers, 0)
  const groupsAtRisk = rows.filter((r) => r.overdueMembers > 0).length

  return (
    <div>
      <PageHeader
        title="Groups"
        subtitle="Solidarity groups — members guarantee each other's loans"
        action={
          canEdit && (
            <Button icon={<Plus size={15} />} onClick={() => navigate('/groups/new')}>
              Register group
            </Button>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Groups" value={groups.length.toString()} hint={`${groups.filter((g) => g.status === 'active').length} active`} icon={<Users size={16} />} tone="brand" />
        <StatTile label="Active members" value={totalMembers.toString()} tone="brand" />
        <StatTile
          label="Group outstanding"
          value={formatMoney(rows.reduce((s, r) => s + r.outstanding, 0), currency)}
          hint={`Savings ${formatMoney(rows.reduce((s, r) => s + r.savings, 0), currency)}`}
          icon={<Wallet size={16} />}
          tone="brand"
        />
        <StatTile
          label="Groups with overdue members"
          value={groupsAtRisk.toString()}
          icon={<AlertTriangle size={16} />}
          tone={groupsAtRisk > 0 ? 'red' : 'green'}
        />
      </div>

      <Table
        rowKey={(r) => r.group.id}
        rows={rows}
        onRowClick={(r) => navigate(`/groups/${r.group.id}`)}
        emptyMessage="No groups yet."
        filterPlaceholder="Filter by group name or ID"
        filterAccessor={(r) => `${r.group.name} ${r.group.groupNumber}`}
        columns={[
          { header: 'Group ID', cell: (r) => <span className="font-mono text-xs text-slate-500">{r.group.groupNumber}</span>, sort: (r) => r.group.groupNumber },
          { header: 'Group', cell: (r) => <span className="font-medium text-slate-800">{r.group.name}</span>, sort: (r) => r.group.name },
          { header: 'Type', cell: (r) => GROUP_TYPE_LABELS[r.group.groupType] ?? r.group.groupType },
          { header: 'Branch', cell: (r) => branches.find((b) => b.id === r.group.branchId)?.name ?? '—' },
          { header: 'Officer', cell: (r) => staff.find((s) => s.id === r.group.officerId)?.name ?? '—' },
          { header: 'Members', cell: (r) => r.activeMembers, sort: (r) => r.activeMembers },
          { header: 'Outstanding', cell: (r) => formatMoney(r.outstanding, currency), sort: (r) => r.outstanding },
          {
            header: 'Repayment',
            cell: (r) =>
              r.overdueMembers > 0 ? (
                <Badge tone="red" dot>
                  {r.overdueMembers} overdue · {formatMoney(r.overdue, currency)}
                </Badge>
              ) : (
                <Badge tone="green" dot>
                  Current
                </Badge>
              ),
          },
          {
            header: 'Status',
            cell: (r) => (
              <Badge tone={GROUP_STATUS_TONE[r.group.status]} className="capitalize">
                {r.group.status}
              </Badge>
            ),
            sort: (r) => r.group.status,
          },
        ]}
      />
    </div>
  )
}
