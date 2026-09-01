import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Banknote, CheckCircle2, XCircle } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { StatTile } from '../../components/ui/StatTile'
import { Badge } from '../../components/ui/Badge'
import { BorrowerLink } from '../../components/ui/BorrowerLink'
import { ApplicationQueueCard } from '../../components/dashboard/ApplicationQueueCard'
import { DashboardHero } from '../../components/dashboard/DashboardHero'
import { formatDate, formatMoney } from '../../lib/format'
import { portfolioAtRisk, portfolioOutstanding } from '../../lib/selectors'
import type { Staff } from '../../types'

export default function CreditCommitteeDashboard({ staff: approver }: { staff: Staff }) {
  const applications = useStore((s) => s.applications)
  const borrowers = useStore((s) => s.borrowers)
  const products = useStore((s) => s.products)
  const loans = useStore((s) => s.loans)
  const lender = useStore((s) => s.lender)

  const myQueue = useMemo(
    () =>
      applications
        .filter((a) => (a.status === 'pending_approval' || a.status === 'submitted') && a.requiredApproverRole === 'credit_committee')
        .sort((a, b) => b.amount - a.amount),
    [applications],
  )

  const myDecisions = useMemo(
    () =>
      applications
        .filter((a) => a.approvals.some((d) => d.approverId === approver.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 8),
    [applications, approver.id],
  )

  const { par, atRiskAmount } = portfolioAtRisk(loans)
  const outstanding = portfolioOutstanding(loans)
  const totalPending = myQueue.reduce((s, a) => s + a.amount, 0)

  return (
    <div>
      <DashboardHero
        brandColor={lender.brandColor}
        eyebrow="Credit committee / approver"
        title={`Good day, ${approver.name}`}
        subtitle={`${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Awaiting your decision" value={myQueue.length.toString()} hint={formatMoney(totalPending, lender.currency)} icon={<AlertTriangle size={16} />} tone={myQueue.length > 0 ? 'amber' : 'brand'} />
        <StatTile label="Portfolio outstanding" value={formatMoney(outstanding, lender.currency)} icon={<Banknote size={16} />} tone="brand" />
        <StatTile
          label="Portfolio at risk"
          value={`${par.toFixed(1)}%`}
          hint={formatMoney(atRiskAmount, lender.currency)}
          icon={<AlertTriangle size={16} />}
          tone={par > 10 ? 'red' : par > 5 ? 'amber' : 'brand'}
        />
      </div>

      <div className="mt-6">
        <ApplicationQueueCard
          title="Approval queue"
          subtitle="Applications above branch level, largest amount first"
          applications={myQueue}
          borrowers={borrowers}
          currency={lender.currency}
          emptyLabel="Nothing above the branch limit is waiting on you right now."
        />
      </div>

      <div className="mt-6">
        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="Your recent decisions" />
          </div>
          {myDecisions.length === 0 ? (
            <p className="p-5 pt-0 text-sm text-slate-400">You haven't decided on any applications yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {myDecisions.map((app) => {
                const product = products.find((p) => p.id === app.productId)
                const decision = app.approvals.find((d) => d.approverId === approver.id)
                return (
                  <li key={app.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <div>
                      <Link to={`/applications/${app.id}`} className="font-medium text-slate-800 hover:text-brand-600">
                        {app.reference}
                      </Link>
                      <p className="text-xs text-slate-400">
                        <BorrowerLink id={app.borrowerId} borrowers={borrowers} /> · {product?.name} · {formatDate(app.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-600">{formatMoney(app.amount, lender.currency)}</span>
                      {decision?.decision === 'approved' ? (
                        <Badge tone="green">
                          <CheckCircle2 size={12} strokeWidth={2.5} /> approved
                        </Badge>
                      ) : (
                        <Badge tone="red">
                          <XCircle size={12} strokeWidth={2.5} /> declined
                        </Badge>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
