import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Landmark, Wallet, CheckCircle2, XCircle } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { StatTile } from '../../components/ui/StatTile'
import { Badge } from '../../components/ui/Badge'
import { BorrowerLink } from '../../components/ui/BorrowerLink'
import { ApplicationQueueCard } from '../../components/dashboard/ApplicationQueueCard'
import { DashboardHero } from '../../components/dashboard/DashboardHero'
import { formatDateTime, formatMoney } from '../../lib/format'
import { collectedThisMonth, isSameMonth } from '../../lib/selectors'
import type { Staff } from '../../types'

export default function CashierDashboard({ staff: cashier }: { staff: Staff }) {
  const applications = useStore((s) => s.applications)
  const borrowers = useStore((s) => s.borrowers)
  const loans = useStore((s) => s.loans)
  const repayments = useStore((s) => s.repayments)
  const lender = useStore((s) => s.lender)

  const readyToDisburse = useMemo(() => applications.filter((a) => a.status === 'approved'), [applications])
  const collected = collectedThisMonth(repayments)
  const collectedToday = useMemo(
    () => repayments.filter((r) => !r.reversed && new Date(r.date).toDateString() === new Date().toDateString()).reduce((s, r) => s + r.amount, 0),
    [repayments],
  )
  const disbursedThisMonthCount = useMemo(() => loans.filter((l) => l.disbursement && isSameMonth(l.disbursement.date)).length, [loans])

  const recentRepayments = useMemo(() => [...repayments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8), [repayments])

  function borrowerIdFor(loanId: string) {
    return loans.find((l) => l.id === loanId)?.borrowerId ?? ''
  }

  return (
    <div>
      <DashboardHero
        brandColor={lender.brandColor}
        eyebrow="Cashier / finance officer"
        title={`Good day, ${cashier.name}`}
        subtitle={`${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Ready to disburse" value={readyToDisburse.length.toString()} icon={<Landmark size={16} />} tone={readyToDisburse.length > 0 ? 'amber' : 'brand'} />
        <StatTile label="Disbursed this month" value={disbursedThisMonthCount.toString()} icon={<Landmark size={16} />} tone="brand" />
        <StatTile label="Collected today" value={formatMoney(collectedToday, lender.currency)} icon={<Wallet size={16} />} tone="green" />
        <StatTile label="Collected this month" value={formatMoney(collected, lender.currency)} icon={<Wallet size={16} />} tone="green" />
      </div>

      <div className="mt-6">
        <ApplicationQueueCard
          title="Approved — ready to disburse"
          subtitle="Every shilling traceable to an approval and a destination"
          applications={readyToDisburse}
          borrowers={borrowers}
          currency={lender.currency}
          emptyLabel="Nothing waiting on disbursement right now."
          viewAllHref="/disbursement"
        />
      </div>

      <div className="mt-6">
        <Card padded={false}>
          <div className="flex items-start justify-between p-5 pb-0">
            <CardHeader title="Recent repayments" />
            <Link to="/repayments" className="text-xs font-medium text-brand-600 hover:underline">
              Record a repayment
            </Link>
          </div>
          {recentRepayments.length === 0 ? (
            <p className="p-5 pt-0 text-sm text-slate-400">No repayments recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentRepayments.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <span className="font-medium text-slate-800">{r.receiptNumber}</span>
                    <p className="text-xs text-slate-400">
                      <BorrowerLink id={borrowerIdFor(r.loanId)} borrowers={borrowers} /> · {formatDateTime(r.date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-600">{formatMoney(r.amount, lender.currency)}</span>
                    {r.reversed ? (
                      <Badge tone="red">
                        <XCircle size={12} strokeWidth={2.5} /> reversed
                      </Badge>
                    ) : (
                      <Badge tone="green">
                        <CheckCircle2 size={12} strokeWidth={2.5} /> posted
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
