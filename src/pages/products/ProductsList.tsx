import { Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { formatMoney } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'
import { canManageProducts } from '../../lib/permissions'

export default function ProductsList() {
  const products = useStore((s) => s.products)
  const toggleProductActive = useStore((s) => s.toggleProductActive)
  const staff = useStore((s) => s.staff)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const canEdit = useCanEdit()
  const role = staff.find((s) => s.id === currentStaffId)?.role
  const canManage = canEdit && !!role && canManageProducts(role)
  const navigate = useNavigate()

  return (
    <div>
      <PageHeader
        title="Loan Products — the rules engine"
        subtitle="Build your own products by setting rules, without a developer writing anything"
        action={
          canManage && (
            <Button icon={<Plus size={15} />} onClick={() => navigate('/products/new')}>
              New product
            </Button>
          )
        }
      />

      <Table
        rowKey={(p) => p.id}
        rows={products}
        onRowClick={(p) => navigate(`/products/${p.id}`)}
        columns={[
          { header: 'Product', cell: (p) => <span className="font-medium text-slate-800">{p.name}</span> },
          { header: 'Code', cell: (p) => p.code },
          { header: 'Interest', cell: (p) => `${p.interestRate}% ${p.interestMethod} / ${p.interestPeriod}` },
          { header: 'Repayment', cell: (p) => <span className="capitalize">{p.repaymentFrequency}</span> },
          { header: 'Amount range', cell: (p) => `${formatMoney(p.minAmount)} – ${formatMoney(p.maxAmount)}` },
          { header: 'Term', cell: (p) => `${p.minTermInstalments}–${p.maxTermInstalments} instalments` },
          {
            header: 'Status',
            cell: (p) =>
              canManage ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void toggleProductActive(p.id)
                  }}
                >
                  <Badge tone={p.active ? 'green' : 'slate'}>{p.active ? 'Active' : 'Inactive'}</Badge>
                </button>
              ) : (
                <Badge tone={p.active ? 'green' : 'slate'}>{p.active ? 'Active' : 'Inactive'}</Badge>
              ),
          },
        ]}
      />
    </div>
  )
}
