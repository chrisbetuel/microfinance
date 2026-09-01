import { useMemo, useState } from 'react'
import { Plus, Search, ShieldAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import type { BorrowerType } from '../../types'
import { formatMoney } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'

export default function BorrowersList() {
  const borrowers = useStore((s) => s.borrowers)
  const branches = useStore((s) => s.branches)
  const loans = useStore((s) => s.loans)
  const addBorrower = useStore((s) => s.addBorrower)
  const staff = useStore((s) => s.staff)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const canEdit = useCanEdit()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    type: 'individual' as BorrowerType,
    fullName: '',
    businessName: '',
    registrationNumber: '',
    taxId: '',
    sector: '',
    yearsTrading: 0,
    nationalId: '',
    phone: '',
    residence: '',
    occupation: '',
    monthlyIncome: 0,
    nextOfKin: '',
    branchId: branches[0]?.id ?? '',
    guarantors: [] as { name: string; nationalId: string; phone: string }[],
  })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return borrowers
    return borrowers.filter((b) => b.fullName.toLowerCase().includes(q) || b.nationalId.toLowerCase().includes(q) || b.phone.includes(q))
  }, [borrowers, query])

  const possibleDuplicate = useMemo(() => {
    if (!form.nationalId) return null
    return borrowers.find((b) => b.nationalId === form.nationalId)
  }, [borrowers, form.nationalId])

  return (
    <div>
      <PageHeader
        title="Borrower Records"
        subtitle="Individuals and businesses — one borrower, one file"
        action={
          canEdit && (
            <Button icon={<Plus size={15} />} onClick={() => setOpen(true)}>
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
            placeholder="Search by name, national ID or phone"
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
          { header: 'Type', cell: (b) => <span className="capitalize">{b.type}</span> },
          { header: 'National ID', cell: (b) => b.nationalId },
          { header: 'Branch', cell: (b) => branches.find((br) => br.id === b.branchId)?.name },
          {
            header: 'Active loans',
            cell: (b) => loans.filter((l) => l.borrowerId === b.id && l.status === 'active').length,
          },
          { header: 'Officer', cell: (b) => staff.find((s) => s.id === b.officerId)?.name ?? '—' },
          {
            header: 'Status',
            cell: (b) =>
              b.blacklisted ? (
                <Badge tone="red">
                  <ShieldAlert size={12} /> Blacklisted
                </Badge>
              ) : (
                <Badge tone="green">Good standing</Badge>
              ),
          },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Register borrower" wide>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            const id = await addBorrower({ ...form, officerId: currentStaffId })
            setOpen(false)
            navigate(`/borrowers/${id}`)
          }}
        >
          <div className="flex gap-2">
            {(['individual', 'business'] as BorrowerType[]).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setForm({ ...form, type: t })}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${form.type === t ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {t}
              </button>
            ))}
          </div>

          {possibleDuplicate && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              A borrower with this National ID already exists: <strong>{possibleDuplicate.fullName}</strong>. Check before creating a
              second file.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <input required className={inputClass} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </Field>
            <Field label="National ID">
              <input required className={inputClass} value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input required className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
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
            <Field label="Residence">
              <input required className={inputClass} value={form.residence} onChange={(e) => setForm({ ...form, residence: e.target.value })} />
            </Field>
            <Field label="Occupation">
              <input required className={inputClass} value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })} />
            </Field>
            <Field label="Monthly income" hint={formatMoney(form.monthlyIncome)}>
              <input type="number" required className={inputClass} value={form.monthlyIncome} onChange={(e) => setForm({ ...form, monthlyIncome: Number(e.target.value) })} />
            </Field>
            <Field label="Next of kin">
              <input required className={inputClass} value={form.nextOfKin} onChange={(e) => setForm({ ...form, nextOfKin: e.target.value })} />
            </Field>

            {form.type === 'business' && (
              <>
                <Field label="Business name">
                  <input className={inputClass} value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
                </Field>
                <Field label="Registration number">
                  <input className={inputClass} value={form.registrationNumber} onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })} />
                </Field>
                <Field label="Tax ID (TIN)">
                  <input className={inputClass} value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
                </Field>
                <Field label="Sector">
                  <input className={inputClass} value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} />
                </Field>
                <Field label="Years trading">
                  <input type="number" className={inputClass} value={form.yearsTrading} onChange={(e) => setForm({ ...form, yearsTrading: Number(e.target.value) })} />
                </Field>
              </>
            )}
          </div>

          <div className="rounded-lg border border-slate-100 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Guarantors</p>
              <button
                type="button"
                className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                onClick={() =>
                  setForm({ ...form, guarantors: [...form.guarantors, { name: '', nationalId: '', phone: '' }] })
                }
              >
                <Plus size={13} /> Add guarantor
              </button>
            </div>
            {form.guarantors.length === 0 && <p className="text-xs text-slate-400">None recorded.</p>}
            <div className="space-y-2">
              {form.guarantors.map((g, i) => (
                <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <input
                    className={inputClass}
                    placeholder="Name"
                    value={g.name}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        guarantors: form.guarantors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      })
                    }
                  />
                  <input
                    className={inputClass}
                    placeholder="National ID"
                    value={g.nationalId}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        guarantors: form.guarantors.map((x, j) => (j === i ? { ...x, nationalId: e.target.value } : x)),
                      })
                    }
                  />
                  <input
                    className={inputClass}
                    placeholder="Phone"
                    value={g.phone}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        guarantors: form.guarantors.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-2 text-xs text-red-600 hover:bg-red-50"
                    onClick={() => setForm({ ...form, guarantors: form.guarantors.filter((_, j) => j !== i) })}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          <Button type="submit" className="w-full">
            Create borrower file
          </Button>
        </form>
      </Modal>
    </div>
  )
}
