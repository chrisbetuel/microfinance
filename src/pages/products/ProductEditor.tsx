import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { Plus, Trash2, ArrowUp, ArrowDown, FlaskConical } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Field, inputClass } from '../../components/ui/Field'
import { Button } from '../../components/ui/Button'
import { STAFF_ROLE_LABELS, type LoanProduct, type SecurityType, type StaffRole } from '../../types'
import { generateSchedule } from '../../lib/loanMath'
import { formatDate, formatMoney } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'
import { canManageProducts } from '../../lib/permissions'

const emptyProduct = (): LoanProduct => ({
  id: uuid(),
  name: '',
  code: '',
  active: true,
  interestMethod: 'reducing',
  interestRate: 3,
  interestPeriod: 'monthly',
  repaymentFrequency: 'monthly',
  minAmount: 100000,
  maxAmount: 2000000,
  minTermInstalments: 3,
  maxTermInstalments: 12,
  stepUpEnabled: false,
  fees: [],
  gracePeriodDays: 0,
  gracePeriodAppliesTo: 'none',
  penaltyKind: 'percent',
  penaltyValue: 1,
  penaltyCap: 50000,
  allocationOrder: ['penalty', 'fee', 'interest', 'principal'],
  securityRequired: ['none'],
  approvalLevels: [{ id: uuid(), minAmount: 0, maxAmount: null, requiredRole: 'branch_manager' }],
})

const securityOptions: { value: SecurityType; label: string }[] = [
  { value: 'guarantors', label: 'Guarantors' },
  { value: 'collateral', label: 'Collateral' },
  { value: 'group_guarantee', label: 'Group guarantee' },
  { value: 'savings', label: 'Savings held' },
  { value: 'none', label: 'None' },
]

export default function ProductEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const existing = useStore((s) => s.products.find((p) => p.id === id))
  const saveProduct = useStore((s) => s.saveProduct)
  const staff = useStore((s) => s.staff)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const canEdit = useCanEdit()
  const role = staff.find((s) => s.id === currentStaffId)?.role
  const canManage = canEdit && !!role && canManageProducts(role)
  const [product, setProduct] = useState<LoanProduct>(existing ?? emptyProduct())
  const [testAmount, setTestAmount] = useState(product.minAmount || 500000)
  const [testTerm, setTestTerm] = useState(product.minTermInstalments || 6)

  const schedule = useMemo(() => {
    try {
      return generateSchedule(product, testAmount, testTerm, new Date())
    } catch {
      return []
    }
  }, [product, testAmount, testTerm])

  const scheduleTotals = schedule.reduce(
    (acc, i) => ({ principal: acc.principal + i.principalDue, interest: acc.interest + i.interestDue, fees: acc.fees + i.feesDue }),
    { principal: 0, interest: 0, fees: 0 },
  )

  function updateFee(feeId: string, patch: Partial<LoanProduct['fees'][number]>) {
    setProduct((p) => ({ ...p, fees: p.fees.map((f) => (f.id === feeId ? { ...f, ...patch } : f)) }))
  }

  function updateApprovalLevel(levelId: string, patch: Partial<LoanProduct['approvalLevels'][number]>) {
    setProduct((p) => ({ ...p, approvalLevels: p.approvalLevels.map((l) => (l.id === levelId ? { ...l, ...patch } : l)) }))
  }

  function moveAllocation(index: number, dir: -1 | 1) {
    setProduct((p) => {
      const order = [...p.allocationOrder]
      const target = index + dir
      if (target < 0 || target >= order.length) return p
      ;[order[index], order[target]] = [order[target], order[index]]
      return { ...p, allocationOrder: order }
    })
  }

  return (
    <div>
      <PageHeader
        title={existing ? `Edit ${existing.name}` : 'New loan product'}
        subtitle={canManage ? 'Configure interest, fees, penalties, security and approval routing' : 'View only — you do not have rights to change loan products'}
        action={
          canManage && (
            <Button
              onClick={async () => {
                await saveProduct(product)
                navigate('/products')
              }}
            >
              Save product
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Basics" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Product name">
                <input className={inputClass} value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} />
              </Field>
              <Field label="Product code">
                <input className={inputClass} value={product.code} onChange={(e) => setProduct({ ...product, code: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Minimum amount">
                <input type="number" className={inputClass} value={product.minAmount} onChange={(e) => setProduct({ ...product, minAmount: Number(e.target.value) })} />
              </Field>
              <Field label="Maximum amount">
                <input type="number" className={inputClass} value={product.maxAmount} onChange={(e) => setProduct({ ...product, maxAmount: Number(e.target.value) })} />
              </Field>
              <Field label="Minimum term (instalments)">
                <input type="number" className={inputClass} value={product.minTermInstalments} onChange={(e) => setProduct({ ...product, minTermInstalments: Number(e.target.value) })} />
              </Field>
              <Field label="Maximum term (instalments)">
                <input type="number" className={inputClass} value={product.maxTermInstalments} onChange={(e) => setProduct({ ...product, maxTermInstalments: Number(e.target.value) })} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                <input type="checkbox" checked={product.stepUpEnabled} onChange={(e) => setProduct({ ...product, stepUpEnabled: e.target.checked })} />
                Step-up: raise the borrower's ceiling automatically after a clean repayment history
              </label>
            </div>
          </Card>

          <Card>
            <CardHeader title="Interest & repayment" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Interest method">
                <select className={inputClass} value={product.interestMethod} onChange={(e) => setProduct({ ...product, interestMethod: e.target.value as LoanProduct['interestMethod'] })}>
                  <option value="reducing">Reducing balance</option>
                  <option value="flat">Flat rate</option>
                </select>
              </Field>
              <Field label="Interest rate (% per period)">
                <input type="number" step="0.1" className={inputClass} value={product.interestRate} onChange={(e) => setProduct({ ...product, interestRate: Number(e.target.value) })} />
              </Field>
              <Field label="Interest quoted per">
                <select className={inputClass} value={product.interestPeriod} onChange={(e) => setProduct({ ...product, interestPeriod: e.target.value as LoanProduct['interestPeriod'] })}>
                  <option value="daily">Day</option>
                  <option value="weekly">Week</option>
                  <option value="monthly">Month</option>
                </select>
              </Field>
              <Field label="Repayment frequency">
                <select className={inputClass} value={product.repaymentFrequency} onChange={(e) => setProduct({ ...product, repaymentFrequency: e.target.value as LoanProduct['repaymentFrequency'] })}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="fortnightly">Fortnightly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </Field>
              <Field label="Grace period (days)">
                <input type="number" className={inputClass} value={product.gracePeriodDays} onChange={(e) => setProduct({ ...product, gracePeriodDays: Number(e.target.value) })} />
              </Field>
              <Field label="Grace applies to">
                <select className={inputClass} value={product.gracePeriodAppliesTo} onChange={(e) => setProduct({ ...product, gracePeriodAppliesTo: e.target.value as LoanProduct['gracePeriodAppliesTo'] })}>
                  <option value="none">Not applicable</option>
                  <option value="principal">Principal only</option>
                  <option value="interest">Interest only</option>
                  <option value="both">Principal and interest</option>
                </select>
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Fees"
              subtitle="Each switchable and either fixed or a percentage"
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Plus size={14} />}
                  onClick={() => setProduct((p) => ({ ...p, fees: [...p.fees, { id: uuid(), name: 'New fee', kind: 'fixed', value: 0, timing: 'deducted' }] }))}
                >
                  Add fee
                </Button>
              }
            />
            <div className="space-y-3">
              {product.fees.map((fee) => (
                <div key={fee.id} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-slate-100 p-3 sm:grid-cols-5">
                  <Field label="Name">
                    <input className={inputClass} value={fee.name} onChange={(e) => updateFee(fee.id, { name: e.target.value })} />
                  </Field>
                  <Field label="Type">
                    <select className={inputClass} value={fee.kind} onChange={(e) => updateFee(fee.id, { kind: e.target.value as 'fixed' | 'percent' })}>
                      <option value="fixed">Fixed</option>
                      <option value="percent">Percent</option>
                    </select>
                  </Field>
                  <Field label="Value">
                    <input type="number" className={inputClass} value={fee.value} onChange={(e) => updateFee(fee.id, { value: Number(e.target.value) })} />
                  </Field>
                  <Field label="Timing">
                    <select className={inputClass} value={fee.timing} onChange={(e) => updateFee(fee.id, { timing: e.target.value as 'deducted' | 'added' })}>
                      <option value="deducted">Deducted at disbursement</option>
                      <option value="added">Added to balance</option>
                    </select>
                  </Field>
                  <button
                    type="button"
                    className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 py-2 text-xs text-red-600 hover:bg-red-50"
                    onClick={() => setProduct((p) => ({ ...p, fees: p.fees.filter((f) => f.id !== fee.id) }))}
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                </div>
              ))}
              {product.fees.length === 0 && <p className="text-sm text-slate-400">No fees configured.</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Penalties" subtitle="A fixed daily amount or a percentage of the overdue instalment, with a cap" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Penalty type">
                <select className={inputClass} value={product.penaltyKind} onChange={(e) => setProduct({ ...product, penaltyKind: e.target.value as 'fixed' | 'percent' })}>
                  <option value="fixed">Fixed amount per day</option>
                  <option value="percent">Percent of overdue instalment, per day</option>
                </select>
              </Field>
              <Field label="Value">
                <input type="number" className={inputClass} value={product.penaltyValue} onChange={(e) => setProduct({ ...product, penaltyValue: Number(e.target.value) })} />
              </Field>
              <Field label="Cap">
                <input type="number" className={inputClass} value={product.penaltyCap} onChange={(e) => setProduct({ ...product, penaltyCap: Number(e.target.value) })} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Payment allocation order" subtitle="Normally penalties, then fees, then interest, then principal" />
            <ol className="space-y-1.5">
              {product.allocationOrder.map((step, idx) => (
                <li key={step} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <span className="font-medium capitalize text-slate-700">
                    {idx + 1}. {step}
                  </span>
                  <span className="flex gap-1">
                    <button type="button" onClick={() => moveAllocation(idx, -1)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" onClick={() => moveAllocation(idx, 1)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                      <ArrowDown size={14} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardHeader title="Security required" />
            <div className="flex flex-wrap gap-2">
              {securityOptions.map((opt) => {
                const checked = product.securityRequired.includes(opt.value)
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() =>
                      setProduct((p) => ({
                        ...p,
                        securityRequired: checked ? p.securityRequired.filter((s) => s !== opt.value) : [...p.securityRequired.filter((s) => s !== 'none'), opt.value],
                      }))
                    }
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ${checked ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Approval levels required by amount"
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Plus size={14} />}
                  onClick={() => setProduct((p) => ({ ...p, approvalLevels: [...p.approvalLevels, { id: uuid(), minAmount: 0, maxAmount: null, requiredRole: 'branch_manager' }] }))}
                >
                  Add level
                </Button>
              }
            />
            <div className="space-y-3">
              {product.approvalLevels.map((level) => (
                <div key={level.id} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-slate-100 p-3 sm:grid-cols-4">
                  <Field label="From amount">
                    <input type="number" className={inputClass} value={level.minAmount} onChange={(e) => updateApprovalLevel(level.id, { minAmount: Number(e.target.value) })} />
                  </Field>
                  <Field label="Up to (blank = no limit)">
                    <input
                      type="number"
                      className={inputClass}
                      value={level.maxAmount ?? ''}
                      onChange={(e) => updateApprovalLevel(level.id, { maxAmount: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="Required approver">
                    <select className={inputClass} value={level.requiredRole} onChange={(e) => updateApprovalLevel(level.id, { requiredRole: e.target.value as StaffRole })}>
                      {Object.entries(STAFF_ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button
                    type="button"
                    className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 py-2 text-xs text-red-600 hover:bg-red-50"
                    onClick={() => setProduct((p) => ({ ...p, approvalLevels: p.approvalLevels.filter((l) => l.id !== level.id) }))}
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="xl:col-span-1">
          <Card className="sticky top-6">
            <CardHeader title="Test tool" subtitle="See the full schedule before this product touches a real borrower" />
            <div className="mb-4 grid grid-cols-2 gap-3">
              <Field label="Amount">
                <input type="number" className={inputClass} value={testAmount} onChange={(e) => setTestAmount(Number(e.target.value))} />
              </Field>
              <Field label="Term (instalments)">
                <input type="number" className={inputClass} value={testTerm} onChange={(e) => setTestTerm(Number(e.target.value))} />
              </Field>
            </div>
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
              <FlaskConical size={14} />
              Principal {formatMoney(scheduleTotals.principal)} · Interest {formatMoney(scheduleTotals.interest)} · Fees{' '}
              {formatMoney(scheduleTotals.fees)}
            </div>
            <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-100">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left">#</th>
                    <th className="px-2 py-1.5 text-left">Due</th>
                    <th className="px-2 py-1.5 text-right">Total</th>
                    <th className="px-2 py-1.5 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {schedule.map((row) => (
                    <tr key={row.period}>
                      <td className="px-2 py-1.5">{row.period}</td>
                      <td className="px-2 py-1.5">{formatDate(row.dueDate)}</td>
                      <td className="px-2 py-1.5 text-right">{formatMoney(row.totalDue)}</td>
                      <td className="px-2 py-1.5 text-right text-slate-400">{formatMoney(row.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
