import { Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { BorrowerLink } from '../../components/ui/BorrowerLink'
import { formatDate, formatMoney } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'
import type { ApplicationStatus } from '../../types'

const statusTone: Record<ApplicationStatus, BadgeTone> = {
  draft: 'slate',
  submitted: 'blue',
  pending_approval: 'amber',
  approved: 'green',
  declined: 'red',
  disbursed: 'violet',
}

export default function ApplicationsList() {
  const applications = useStore((s) => s.applications)
  const borrowers = useStore((s) => s.borrowers)
  const products = useStore((s) => s.products)
  const canEdit = useCanEdit()
  const navigate = useNavigate()

  return (
    <div>
      <PageHeader
        title="Applications & Approvals"
        subtitle="Every decision recorded, no step skippable"
        action={
          canEdit && (
            <Button icon={<Plus size={15} />} onClick={() => navigate('/applications/new')}>
              New application
            </Button>
          )
        }
      />

      <Table
        rowKey={(a) => a.id}
        rows={[...applications].sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
        onRowClick={(a) => navigate(`/applications/${a.id}`)}
        pageSize={15}
        filterPlaceholder="Filter by reference or borrower"
        filterAccessor={(a) =>
          `${a.reference} ${borrowers.find((b) => b.id === a.borrowerId)?.fullName ?? ''} ${a.status}`
        }
        columns={[
          {
            header: 'Reference',
            cell: (a) => <span className="font-medium text-slate-800">{a.reference}</span>,
            sort: (a) => a.reference,
          },
          { header: 'Borrower', cell: (a) => <BorrowerLink id={a.borrowerId} borrowers={borrowers} /> },
          { header: 'Product', cell: (a) => products.find((p) => p.id === a.productId)?.name ?? '—' },
          { header: 'Amount', cell: (a) => formatMoney(a.amount), sort: (a) => a.amount },
          { header: 'Score', cell: (a) => (a.score !== null ? a.score : '—'), sort: (a) => a.score ?? -1 },
          { header: 'Submitted', cell: (a) => formatDate(a.createdAt), sort: (a) => a.createdAt },
          { header: 'Status', cell: (a) => <Badge tone={statusTone[a.status]}>{a.status.replace('_', ' ')}</Badge> },
        ]}
      />
    </div>
  )
}
