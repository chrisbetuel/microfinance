import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { StatusBadge } from './StatusBadge'
import { inputClass } from '../../components/ui/Field'
import { useCanEdit } from '../../lib/useCanEdit'

export default function BorrowersList() {
  const borrowers = useStore((s) => s.borrowers)
  const branches = useStore((s) => s.branches)
  const loans = useStore((s) => s.loans)
  const staff = useStore((s) => s.staff)
  const canEdit = useCanEdit()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return borrowers
    return borrowers.filter((b) => b.fullName.toLowerCase().includes(q) || b.nationalId.toLowerCase().includes(q) || b.phone.includes(q) || b.customerNumber.toLowerCase().includes(q))
  }, [borrowers, query])

  return (
    <div>
      <PageHeader
        title="Borrower Records"
        subtitle="Individuals and businesses — one borrower, one file"
        action={
          canEdit && (
            <Button icon={<Plus size={15} />} onClick={() => navigate('/borrowers/new')}>
              Register borrower
            </Button>
          )
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className={`${inputClass} pl-9`}
            placeholder="Search by name, customer no., NIDA or phone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <Table
        rowKey={(b) => b.id}
        rows={filtered}
        onRowClick={(b) => navigate(`/borrowers/${b.id}`)}
        columns={[
          {
            header: 'Name',
            cell: (b) => (
              <div>
                <span className="font-medium text-slate-800">{b.fullName}</span>
                {b.businessName && <span className="ml-1.5 text-xs text-slate-400">({b.businessName})</span>}
              </div>
            ),
          },
          { header: 'Customer no.', cell: (b) => <span className="font-mono text-xs text-slate-500">{b.customerNumber || '—'}</span> },
          { header: 'Type', cell: (b) => <span className="capitalize">{b.type}</span> },
          { header: 'National ID', cell: (b) => b.nationalId },
          { header: 'Branch', cell: (b) => branches.find((br) => br.id === b.branchId)?.name },
          {
            header: 'Active loans',
            cell: (b) => loans.filter((l) => l.borrowerId === b.id && l.status === 'active').length,
          },
          { header: 'Officer', cell: (b) => staff.find((s) => s.id === b.officerId)?.name ?? '—' },
          { header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
        ]}
      />

    </div>
  )
}
