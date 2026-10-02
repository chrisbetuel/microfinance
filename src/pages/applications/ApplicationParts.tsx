import clsx from 'clsx'
import { Check, X } from 'lucide-react'
import type { BadgeTone } from '../../components/ui/Badge'
import { useStore } from '../../store/useStore'
import { formatDate, formatMoney } from '../../lib/format'
import { daysLate } from '../../lib/selectors'
import { generateSchedule } from '../../lib/loanMath'
import type { Application, ApplicationStatus, AssessmentResult, BorrowerGroup, DisbursementChannel, Loan, LoanProduct } from '../../types'
import { groupSummary } from '../groups/groupStats'

export const APP_STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_assessment: 'Under assessment',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  declined: 'Declined',
  disbursed: 'Disbursed',
}

export const ASSESSMENT_LABEL: Record<AssessmentResult, string> = {
  recommended: 'Recommended',
  further_review: 'Requires further review',
  not_recommended: 'Not recommended',
}
export const ASSESSMENT_TONE: Record<AssessmentResult, BadgeTone> = {
  recommended: 'green',
  further_review: 'amber',
  not_recommended: 'red',
}

export const DISBURSEMENT_LABEL: Record<DisbursementChannel, string> = {
  mobile_money: 'Mobile money',
  bank_transfer: 'Bank transfer',
  supplier: 'Pay supplier directly',
  cash: 'Cash at branch',
}

/** Monthly figures the application's financial assessment works from (mirrors services/applications.repayment_capacity). */
export const CAPACITY_SHARE = 0.6
export function capacityOf(f: {
  declaredIncome: number
  otherIncome: number
  businessIncome: number
  businessExpenses: number
  declaredExpenses: number
  existingRepayments: number
}) {
  const businessNet = f.businessIncome - f.businessExpenses
  const totalIncome = f.declaredIncome + f.otherIncome + businessNet
  const disposable = totalIncome - f.declaredExpenses - f.existingRepayments
  return { totalIncome, businessNet, disposable, maxInstalment: Math.max(disposable, 0) * CAPACITY_SHARE }
}

export function firstInstalment(product: LoanProduct | undefined, amount: number, term: number): number {
  if (!product || amount <= 0 || term <= 0) return 0
  try {
    return generateSchedule(product, amount, term)[0]?.totalDue ?? 0
  } catch {
    return amount / term
  }
}

/** Monthly-equivalent instalment, so it compares with monthly capacity whatever the product's frequency. */
export function monthlyEquivalent(instalment: number, frequency: LoanProduct['repaymentFrequency']): number {
  const perMonth = { daily: 26, weekly: 52 / 12, fortnightly: 26 / 12, monthly: 1 }[frequency] ?? 1
  return instalment * perMonth
}

export interface RequiredDocument {
  type: string
  required: boolean
  why: string
}

export function requiredDocuments(opts: {
  product?: LoanProduct
  businessIncome: number
  hasGroup: boolean
  hasGuarantors: boolean
  hasCollateral: boolean
}): RequiredDocument[] {
  const security = opts.product?.securityRequired ?? []
  return [
    { type: 'Identification', required: true, why: 'NIDA / voter / passport for the applicant' },
    { type: 'Income evidence', required: true, why: 'Payslip, sales records or receipts' },
    { type: 'Business documents', required: opts.businessIncome > 0, why: 'Licence / TIN for business income' },
    { type: 'Bank / mobile-money statement', required: false, why: 'Last 3 months, where available' },
    { type: 'Collateral documents', required: security.includes('collateral') || opts.hasCollateral, why: 'Title, card or valuation' },
    { type: 'Guarantor documents', required: security.includes('guarantors') || opts.hasGuarantors, why: 'Guarantor ID and signed consent' },
    { type: 'Group agreement', required: opts.hasGroup, why: 'Signed joint-liability agreement' },
  ].filter((d) => d.type !== 'Group agreement' || opts.hasGroup)
}

export function borrowingSummary(borrowerId: string, loans: Loan[], applications: Application[], excludeApplicationId?: string) {
  const own = loans.filter((l) => l.borrowerId === borrowerId && l.applicationId !== excludeApplicationId)
  const active = own.filter((l) => l.status === 'active')
  const late = own.reduce((n, l) => n + l.schedule.filter((i) => i.wasLate).length, 0)
  const dueSoFar = own.flatMap((l) => l.schedule.filter((i) => new Date(i.dueDate) <= new Date()))
  return {
    loans: own,
    previousLoans: own.length,
    totalBorrowed: own.reduce((s, l) => s + l.principal, 0),
    completed: own.filter((l) => l.status === 'closed').length,
    active: active.length,
    outstanding: active.reduce((s, l) => s + l.outstandingBalance, 0),
    lateInstalments: late,
    overdueAmount: active.reduce((s, l) => s + (daysLate(l) > 0 ? l.arrearsAmount || 0 : 0), 0),
    maxDaysLate: active.reduce((m, l) => Math.max(m, daysLate(l)), 0),
    defaults: own.filter((l) => l.status === 'written_off').length,
    onTimeRate: dueSoFar.length ? ((dueSoFar.length - dueSoFar.filter((i) => i.wasLate).length) / dueSoFar.length) * 100 : null,
    declinedBefore: applications.filter((a) => a.borrowerId === borrowerId && a.status === 'declined' && a.id !== excludeApplicationId).length,
  }
}

const PIPELINE: ApplicationStatus[] = ['draft', 'submitted', 'under_assessment', 'pending_approval', 'approved', 'disbursed']

export function StagePipeline({ status, wasDraft = true }: { status: ApplicationStatus; wasDraft?: boolean }) {
  const declined = status === 'declined'
  const base = wasDraft ? PIPELINE : PIPELINE.filter((s) => s !== 'draft')
  const stages = declined ? [...base.filter((s) => s !== 'approved' && s !== 'disbursed'), 'declined' as const] : base
  const current = stages.indexOf(status)
  return (
    <ol className="flex flex-wrap items-center gap-y-2">
      {stages.map((s, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={s} className="flex items-center">
            <span
              className={clsx(
                'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold',
                active && s === 'declined' && 'bg-red-600 text-white',
                active && s !== 'declined' && 'bg-brand-600 text-white',
                done && 'bg-brand-50 text-brand-700',
                !active && !done && 'bg-slate-100 text-slate-400',
              )}
            >
              <span className="flex h-4 w-4 items-center justify-center">
                {done ? <Check size={12} /> : active && s === 'declined' ? <X size={12} /> : i + 1}
              </span>
              {APP_STATUS_LABEL[s]}
            </span>
            {i < stages.length - 1 && <span className={clsx('mx-1 h-px w-5', done ? 'bg-brand-300' : 'bg-slate-200')} />}
          </li>
        )
      })}
    </ol>
  )
}

function Tile({ label, value, bad, hint }: { label: string; value: string; bad?: boolean; hint?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={clsx('font-semibold tabular-nums', bad ? 'text-accent-600' : 'text-slate-800')}>{value}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

export function CapacityPanel({
  figures,
  instalment,
  frequency,
  currency,
}: {
  figures: Parameters<typeof capacityOf>[0]
  instalment: number
  frequency: LoanProduct['repaymentFrequency']
  currency: string
}) {
  const c = capacityOf(figures)
  const monthly = monthlyEquivalent(instalment, frequency)
  const affordable = monthly > 0 && monthly <= c.maxInstalment
  const money = (n: number) => formatMoney(n, currency)
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-800">Repayment capacity</p>
        {monthly > 0 && (
          <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-semibold', affordable ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
            {affordable ? 'Within capacity' : 'Exceeds capacity'}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Total monthly income" value={money(c.totalIncome)} hint={c.businessNet ? `incl. business net ${money(c.businessNet)}` : undefined} />
        <Tile label="Free cash after expenses & loans" value={money(c.disposable)} bad={c.disposable <= 0} />
        <Tile label={`Max instalment (${CAPACITY_SHARE * 100}% of free cash)`} value={money(c.maxInstalment)} />
        <Tile
          label="Proposed instalment"
          value={money(instalment)}
          hint={frequency !== 'monthly' ? `≈ ${money(monthly)} a month` : undefined}
          bad={monthly > c.maxInstalment}
        />
      </div>
      <p className="mt-3 text-[11px] text-slate-400">Indicators only. The decision stays with authorised staff.</p>
    </div>
  )
}

export function BorrowingSummary({ borrowerId, excludeApplicationId }: { borrowerId: string; excludeApplicationId?: string }) {
  const loans = useStore((s) => s.loans)
  const applications = useStore((s) => s.applications)
  const currency = useStore((s) => s.lender.currency)
  const s = borrowingSummary(borrowerId, loans, applications, excludeApplicationId)
  const money = (n: number) => formatMoney(n, currency)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Previous loans" value={String(s.previousLoans)} hint={`${money(s.totalBorrowed)} borrowed`} />
        <Tile label="Completed" value={String(s.completed)} />
        <Tile label="Outstanding" value={money(s.outstanding)} hint={`${s.active} active loan(s)`} />
        <Tile label="Late payments" value={String(s.lateInstalments)} bad={s.lateInstalments >= 3} hint={s.onTimeRate == null ? undefined : `${s.onTimeRate.toFixed(0)}% on time`} />
        <Tile label="Overdue now" value={money(s.overdueAmount)} bad={s.overdueAmount > 0} hint={s.maxDaysLate ? `${s.maxDaysLate} days late` : undefined} />
        <Tile label="Defaults (written off)" value={String(s.defaults)} bad={s.defaults > 0} />
        <Tile label="Declined applications" value={String(s.declinedBefore)} />
      </div>
      {s.loans.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">First-time borrower: no loans on record with us.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2">Loan</th>
                <th className="px-3 py-2">Disbursed</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Outstanding</th>
                <th className="px-3 py-2">Repayment history</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {s.loans.map((l) => {
                const due = l.schedule.filter((i) => new Date(i.dueDate) <= new Date())
                return (
                  <tr key={l.id}>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">
                      {applications.find((a) => a.id === l.applicationId)?.reference ?? l.id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{l.disbursement ? formatDate(l.disbursement.date) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(l.principal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.status === 'active' ? money(l.outstandingBalance) : '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-0.5">
                        {due.length === 0 && <span className="text-xs text-slate-400">Nothing due yet</span>}
                        {due.map((i) => (
                          <span
                            key={i.period}
                            title={`#${i.period} ${formatDate(i.dueDate)}${i.wasLate ? ' · late' : ''}`}
                            className={clsx(
                              'h-3 w-3 rounded-sm',
                              i.status === 'paid' ? (i.wasLate ? 'bg-amber-400' : 'bg-emerald-500') : 'bg-red-500',
                            )}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs capitalize text-slate-600">
                      {l.status === 'closed' ? 'Completed' : l.status === 'written_off' ? 'Defaulted' : daysLate(l) > 0 ? `Overdue ${daysLate(l)}d` : l.status.replace('_', ' ')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
            <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" /> paid on time
            <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-sm bg-amber-400" /> paid late
            <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-sm bg-red-500" /> unpaid
          </p>
        </div>
      )}
    </div>
  )
}

export function GroupSnapshot({ group, memberIds }: { group: BorrowerGroup; memberIds?: string[] }) {
  const applications = useStore((s) => s.applications)
  const loans = useStore((s) => s.loans)
  const repayments = useStore((s) => s.repayments)
  const currency = useStore((s) => s.lender.currency)
  const s = groupSummary(group, applications, loans, repayments)
  const money = (n: number) => formatMoney(n, currency)
  const lastMeeting = group.meetings[0]
  const previousLoans = s.rows.filter((r) => r.status !== 'Pending')
  const members = group.memberships.filter((m) => m.status === 'active' && (!memberIds || memberIds.includes(m.borrowerId)))
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Group" value={group.name} hint={group.groupNumber} />
        <Tile label="Members" value={`${s.activeMembers} active`} hint={`${group.memberships.length} ever joined`} />
        <Tile label="Group savings" value={money(s.savings)} />
        <Tile label="Current group debt" value={money(s.outstanding)} bad={s.overdue > 0} hint={s.overdue ? `${money(s.overdue)} overdue` : undefined} />
        <Tile label="Previous group loans" value={String(previousLoans.length)} hint={`${previousLoans.filter((r) => r.status === 'Completed').length} completed`} />
        <Tile label="Repayment rate" value={s.repaymentRate == null ? '—' : `${s.repaymentRate.toFixed(0)}%`} bad={s.repaymentRate != null && s.repaymentRate < 90} />
        <Tile label="Meetings · attendance" value={`${group.meetings.length} · ${s.attendanceRate == null ? '—' : `${s.attendanceRate.toFixed(0)}%`}`} hint={lastMeeting ? `last ${formatDate(lastMeeting.date)}` : 'none recorded'} />
        <Tile label="Contributions" value={money(s.contributions)} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2">Member</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2 text-right">Owes now</th>
              <th className="px-3 py-2 text-right">Overdue</th>
              <th className="px-3 py-2 text-right">Contributed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {members.map((m) => {
              const own = loans.filter((l) => l.borrowerId === m.borrowerId && l.status === 'active')
              const owes = own.reduce((t, l) => t + l.outstandingBalance, 0)
              const overdue = own.reduce((t, l) => t + (daysLate(l) > 0 ? l.arrearsAmount || 0 : 0), 0)
              const contributed = group.meetings.flatMap((mt) => mt.attendance).filter((a) => a.membershipId === m.id).reduce((t, a) => t + a.contribution, 0)
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">{m.borrowerName}</td>
                  <td className="px-3 py-2 text-xs capitalize text-slate-500">{m.role}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{owes ? money(owes) : '—'}</td>
                  <td className={clsx('px-3 py-2 text-right tabular-nums', overdue && 'font-semibold text-accent-600')}>{overdue ? money(overdue) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(contributed)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
