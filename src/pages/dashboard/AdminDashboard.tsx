import { Banknote, TrendingUp, AlertTriangle, Users, Wallet, ArrowUpRight } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { StatTile } from '../../components/ui/StatTile'
import { ArrearsChart } from '../../components/dashboard/ArrearsChart'
import { ApplicationQueueCard } from '../../components/dashboard/ApplicationQueueCard'
import { DashboardHero } from '../../components/dashboard/DashboardHero'
import { formatMoney } from '../../lib/format'
import { collectedThisMonth, disbursedThisMonth, portfolioAtRisk, portfolioOutstanding } from '../../lib/selectors'

export default function AdminDashboard() {
  const loans = useStore((s) => s.loans)
  const repayments = useStore((s) => s.repayments)
  const applications = useStore((s) => s.applications)
  const borrowers = useStore((s) => s.borrowers)
  const products = useStore((s) => s.products)
  const branches = useStore((s) => s.branches)
  const lender = useStore((s) => s.lender)

  const outstanding = portfolioOutstanding(loans)
  const disbursed = disbursedThisMonth(loans)
  const collected = collectedThisMonth(repayments)
  const { par, atRiskAmount } = portfolioAtRisk(loans)
  const activeBorrowers = new Set(loans.filter((l) => l.status === 'active').map((l) => l.borrowerId)).size

  const byProduct = products.map((p) => ({
    product: p,
    count: loans.filter((l) => l.productId === p.id && l.status === 'active').length,
    outstanding: loans.filter((l) => l.productId === p.id && l.status === 'active').reduce((s, l) => s + l.outstandingBalance, 0),
  }))

  const pendingApplications = applications.filter((a) => a.status === 'pending_approval' || a.status === 'submitted')

  return (
    <div>
      <DashboardHero
        brandColor={lender.brandColor}
        eyebrow="Lender administrator"
        title={`Good day — ${lender.name}`}
        subtitle={`${branches.length} branches · ${borrowers.length} borrowers · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Portfolio outstanding" value={formatMoney(outstanding, lender.currency)} icon={<Banknote size={16} />} tone="brand" />
        <StatTile label="Disbursed this month" value={formatMoney(disbursed, lender.currency)} icon={<ArrowUpRight size={16} />} tone="green" />
        <StatTile label="Collected this month" value={formatMoney(collected, lender.currency)} icon={<Wallet size={16} />} tone="green" />
        <StatTile
          label="Portfolio at risk"
          value={`${par.toFixed(1)}%`}
          hint={formatMoney(atRiskAmount, lender.currency)}
          icon={<AlertTriangle size={16} />}
          tone={par > 10 ? 'red' : par > 5 ? 'amber' : 'brand'}
        />
        <StatTile label="Active borrowers" value={activeBorrowers.toString()} icon={<Users size={16} />} tone="brand" />
        <StatTile
          label="Collection rate"
          value={collected > 0 && disbursed >= 0 ? `${Math.min(100, Math.round((collected / Math.max(collected + atRiskAmount * 0.1, 1)) * 100))}%` : '—'}
          icon={<TrendingUp size={16} />}
          tone="brand"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ArrearsChart loans={loans} currency={lender.currency} />
        </div>

        <Card>
          <CardHeader title="Loan book by product" />
          <ul className="space-y-3">
            {byProduct.map(({ product, count, outstanding: out }) => (
              <li key={product.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-800">{product.name}</p>
                  <p className="text-xs text-slate-400">{count} active loans</p>
                </div>
                <p className="font-medium text-slate-700">{formatMoney(out, lender.currency)}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6">
        <ApplicationQueueCard
          title="Applications awaiting action"
          subtitle={`${pendingApplications.length} application(s) need review or approval, across all branches`}
          applications={pendingApplications}
          borrowers={borrowers}
          currency={lender.currency}
        />
      </div>
    </div>
  )
}
