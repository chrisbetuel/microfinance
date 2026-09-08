import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Banknote, AlertTriangle, Users, ShieldAlert } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { StatTile } from '../../components/ui/StatTile'
import { Badge } from '../../components/ui/Badge'
import { BorrowerLink } from '../../components/ui/BorrowerLink'
import { ArrearsChart } from '../../components/dashboard/ArrearsChart'
import { DashboardHero } from '../../components/dashboard/DashboardHero'
import { formatDateTime, formatMoney } from '../../lib/format'
import { portfolioAtRisk, portfolioOutstanding } from '../../lib/selectors'

export default function AuditorDashboard() {
  const loans = useStore((s) => s.loans)
  const borrowers = useStore((s) => s.borrowers)
  const repayments = useStore((s) => s.repayments)
  const auditLog = useStore((s) => s.auditLog)
  const lender = useStore((s) => s.lender)

  const outstanding = portfolioOutstanding(loans)
  const { par, atRiskAmount } = portfolioAtRisk(loans)
  const activeBorrowers = new Set(loans.filter((l) => l.status === 'active').map((l) => l.borrowerId)).size
  const writeOffs = loans.filter((l) => l.status === 'written_off')

  const reversals = useMemo(() => [...repayments].filter((r) => r.reversed).sort((a, b) => b.date.localeCompare(a.date)), [repayments])
  const recentActivity = auditLog.slice(0, 10)

  function borrowerIdFor(loanId: string) {
    return loans.find((l) => l.id === loanId)?.borrowerId ?? ''
  }

  return (
    <div>
      <DashboardHero
        eyebrow="Auditor"
        title="Auditor overview"
        subtitle={`Sees everything, changes nothing · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Portfolio outstanding" value={formatMoney(outstanding, lender.currency)} icon={<Banknote size={16} />} tone="brand" />
        <StatTile
          label="Portfolio at risk"
          value={`${par.toFixed(1)}%`}
          hint={formatMoney(atRiskAmount, lender.currency)}
          icon={<AlertTriangle size={16} />}
          tone={par > 10 ? 'red' : par > 5 ? 'amber' : 'brand'}
        />
        <StatTile label="Active borrowers" value={activeBorrowers.toString()} icon={<Users size={16} />} tone="brand" />
        <StatTile label="Written off loans" value={writeOffs.length.toString()} icon={<ShieldAlert size={16} />} tone={writeOffs.length > 0 ? 'amber' : 'brand'} />
      </div>

      <div className="mt-6">
        <ArrearsChart loans={loans} currency={lender.currency} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card padded={false}>
          <div className="flex items-start justify-between p-5 pb-0">
            <CardHeader title="Recent activity" />
            <Link to="/security" className="text-xs font-medium text-brand-600 hover:underline">
              Full audit trail
            </Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {recentActivity.map((entry) => (
              <li key={entry.id} className="px-5 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-800">{entry.userName}</span>
                  <Badge dot tone="slate">{entry.action}</Badge>
                </div>
                <p className="text-xs text-slate-400">
                  {entry.entity} · {formatDateTime(entry.timestamp)}
                </p>
                {entry.details && <p className="mt-0.5 text-xs text-slate-500">{entry.details}</p>}
              </li>
            ))}
          </ul>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="Payment reversals" subtitle="Only a supervisor can reverse a posted payment" />
          </div>
          {reversals.length === 0 ? (
            <p className="p-5 pt-0 text-sm text-slate-400">No reversals recorded.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {reversals.map((r) => (
                <li key={r.id} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <BorrowerLink id={borrowerIdFor(r.loanId)} borrowers={borrowers} />
                    <span className="text-slate-600">{formatMoney(r.amount, lender.currency)}</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {r.receiptNumber} · reversed by {r.recordedBy}
                  </p>
                  {r.reversalReason && <p className="mt-0.5 text-xs text-red-700">{r.reversalReason}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
