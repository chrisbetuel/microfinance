import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Field, inputClass } from '../../components/ui/Field'
import { Button } from '../../components/ui/Button'
import { formatMoney } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'

export default function ApplicationNew() {
  const navigate = useNavigate()
  const borrowers = useStore((s) => s.borrowers)
  const allProducts = useStore((s) => s.products)
  const products = useMemo(() => allProducts.filter((p) => p.active), [allProducts])
  const createApplication = useStore((s) => s.createApplication)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const canEdit = useCanEdit()

  const [borrowerId, setBorrowerId] = useState(borrowers[0]?.id ?? '')
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [amount, setAmount] = useState(products[0]?.minAmount ?? 0)
  const [term, setTerm] = useState(products[0]?.minTermInstalments ?? 1)
  const [purpose, setPurpose] = useState('')
  const [declaredExpenses, setDeclaredExpenses] = useState(0)
  const [consent, setConsent] = useState(false)

  const borrower = borrowers.find((b) => b.id === borrowerId)
  const product = products.find((p) => p.id === productId)

  const withinAmount = product ? amount >= product.minAmount && amount <= product.maxAmount : true
  const withinTerm = product ? term >= product.minTermInstalments && term <= product.maxTermInstalments : true
  const disposable = (borrower?.monthlyIncome ?? 0) - declaredExpenses
  const affordabilityWarn = disposable <= 0

  const canSubmit = useMemo(
    () => canEdit && !!borrower && !borrower.blacklisted && !!product && withinAmount && withinTerm && purpose.trim().length > 0,
    [canEdit, borrower, product, withinAmount, withinTerm, purpose],
  )

  return (
    <div className="max-w-2xl">
      <PageHeader title="New application" subtitle="Capture, check and route for approval" />

      <Card>
        {!canEdit && (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Your account has view-only access and cannot submit applications.
          </div>
        )}
        {borrower?.blacklisted && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            This borrower is blacklisted: {borrower.blacklistReason}. The application cannot proceed.
          </div>
        )}

        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!borrower || !product || !canSubmit) return
            const id = await createApplication({
              borrowerId,
              productId,
              branchId: borrower.branchId,
              amount,
              termInstalments: term,
              purpose,
              declaredIncome: borrower.monthlyIncome,
              declaredExpenses,
              creditBureauConsent: consent,
              createdBy: currentStaffId,
            })
            navigate(`/applications/${id}`)
          }}
        >
          <Field label="Borrower">
            <select className={inputClass} value={borrowerId} onChange={(e) => setBorrowerId(e.target.value)}>
              {borrowers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.fullName} {b.blacklisted ? '(blacklisted)' : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Loan product">
            <select
              className={inputClass}
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value)
                const p = products.find((pr) => pr.id === e.target.value)
                if (p) {
                  setAmount(p.minAmount)
                  setTerm(p.minTermInstalments)
                }
              }}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Amount" error={!withinAmount && product ? `Must be ${formatMoney(product.minAmount)}–${formatMoney(product.maxAmount)}` : undefined}>
              <input type="number" className={inputClass} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </Field>
            <Field label="Term (instalments)" error={!withinTerm && product ? `Must be ${product.minTermInstalments}–${product.maxTermInstalments}` : undefined}>
              <input type="number" className={inputClass} value={term} onChange={(e) => setTerm(Number(e.target.value))} />
            </Field>
          </div>

          <Field label="Purpose">
            <textarea required rows={2} className={inputClass} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Declared income (monthly)">
              <input type="number" disabled className={`${inputClass} bg-slate-50`} value={borrower?.monthlyIncome ?? 0} />
            </Field>
            <Field label="Declared expenses / other commitments (monthly)">
              <input type="number" className={inputClass} value={declaredExpenses} onChange={(e) => setDeclaredExpenses(Number(e.target.value))} />
            </Field>
          </div>

          {affordabilityWarn && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Declared expenses meet or exceed declared income — the affordability check will likely fail.
            </div>
          )}

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            Borrower has given written consent for a credit bureau check on this application.
          </label>

          <Button type="submit" disabled={!canSubmit} className="w-full">
            Submit for approval
          </Button>
        </form>
      </Card>
    </div>
  )
}
