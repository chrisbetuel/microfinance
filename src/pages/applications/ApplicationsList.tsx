import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { BorrowerLink } from '../../components/ui/BorrowerLink'
import { formatDate, formatMoney } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'
import type { ApplicationStatus } from '../../types'
import { APP_STATUS_LABEL, ASSESSMENT_LABEL, ASSESSMENT_TONE } from './ApplicationParts'

const statusTone: Record<ApplicationStatus, BadgeTone> = {
  draft: 'slate',
  submitted: 'blue',
  under_assessment: 'blue',
  pending_approval: 'amber',
  approved: 'green',
  declined: 'red',
  disbursed: 'violet',
}

const FILTERS: (ApplicationStatus | 'all')[] = ['all', 'draft', 'submitted', 'under_assessment', 'pending_approval', 'approved', 'declined', 'disbursed']

export default function ApplicationsList() {
  const applications = useStore((s) => s.applications)
  const borrowers = useStore((s) => s.borrowers)
  const products = useStore((s) => s.products)
  const groups = useStore((s) => s.groups)
  const currency = useStore((s) => s.lender.currency)
  const canEdit = useCanEdit()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ApplicationStatus | 'all'>(() => {
    try {
      return (localStorage.getItem('lms-app-filter') as ApplicationStatus | 'all') || 'all'
    } catch {
      return 'all'
    }
  })
  const choose = (f: ApplicationStatus | 'all') => {
    setFilter(f)
    try {
      localStorage.setItem('lms-app-filter', f)
    } catch {
      /* storage unavailable */
    }
  }

  const count = (f: ApplicationStatus | 'all') => (f === 'all' ? applications.length : applications.filter((a) => a.status === f).length)
  const rows = [...applications]
    .filter((a) => filter === 'all' || a.status === filter)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div>
      <PageHeader
        title="Applications & Approvals"
        subtitle="Draft → submitted → assessment → approval → disbursement, with every step recorded"
        action={
          canEdit && (
            <Button icon={<Plus size={15} />} onClick={() => navigate('/applications/new')}>
              New application
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => choose(f)}
            className={clsx(
              'rounded-full px-3 py-1.5 text-xs font-semibold',
              filter === f ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50',
            )}
          >
            {f === 'all' ? 'All' : APP_STATUS_LABEL[f]} <span className="opacity-70">{count(f)}</span>
          </button>
        ))}
      </div>

      <Table
        rowKey={(a) => a.id}
        rows={rows}
        onRowClick={(a) => navigate(`/applications/${a.id}`)}
        pageSize={15}
        filterPlaceholder="Filter by reference or borrower"
        filterAccessor={(a) => `${a.reference} ${borrowers.find((b) => b.id === a.borrowerId)?.fullName ?? ''}`}
        columns={[
          {
            header: 'Reference',
            cell: (a) => <span className="font-medium text-slate-800">{a.reference}</span>,
            sort: (a) => a.reference,
          },
          {
            header: 'Applicant',
            cell: (a) => (
              <span>
                <BorrowerLink id={a.borrowerId} borrowers={borrowers} />
                {a.groupId && <span className="ml-1 text-xs text-slate-400">· {groups.find((g) => g.id === a.groupId)?.name ?? 'group'}</span>}
              </span>
            ),
          },
          { header: 'Product', cell: (a) => products.find((p) => p.id === a.productId)?.name ?? '—' },
          { header: 'Requested', cell: (a) => formatMoney(a.requestedAmount || a.amount, currency), sort: (a) => a.requestedAmount || a.amount },
          {
            header: 'Assessment',
            cell: (a) => (a.assessmentResult ? <Badge tone={ASSESSMENT_TONE[a.assessmentResult]}>{ASSESSMENT_LABEL[a.assessmentResult]}</Badge> : '—'),
          },
          { header: 'Score', cell: (a) => (a.score !== null ? a.score : '—'), sort: (a) => a.score ?? -1 },
          { header: 'Applied', cell: (a) => formatDate(a.applicationDate || a.createdAt), sort: (a) => a.createdAt },
          { header: 'Stage', cell: (a) => <Badge tone={statusTone[a.status]}>{APP_STATUS_LABEL[a.status]}</Badge>, sort: (a) => a.status },
        ]}
      />
    </div>
  )
}
