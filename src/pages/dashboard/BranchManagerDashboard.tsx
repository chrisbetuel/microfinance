import { useMemo } from 'react'
import { Banknote, AlertTriangle, Users, Wallet } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { StatTile } from '../../components/ui/StatTile'
import { ArrearsChart } from '../../components/dashboard/ArrearsChart'
import { ApplicationQueueCard } from '../../components/dashboard/ApplicationQueueCard'
import { DashboardHero } from '../../components/dashboard/DashboardHero'
import { formatMoney } from '../../lib/format'
import { collectedThisMonth, disbursedThisMonth, isSameMonth, portfolioAtRisk, portfolioOutstanding } from '../../lib/selectors'
import type { Staff } from '../../types'

export default function BranchManagerDashboard({ staff: manager }: { staff: Staff }) {
  const branches = useStore((s) => s.branches)
  const allLoans = useStore((s) => s.loans)
  const allApplications = useStore((s) => s.applications)
  const allBorrowers = useStore((s) => s.borrowers)
  const allRepayments = useStore((s) => s.repayments)
  const allStaff = useStore((s) => s.staff)
  const lender = useStore((s) => s.lender)

  const branch = branches.find((b) => b.id === manager.branchId)

  const branchBorrowers = useMemo(() => allBorrowers.filter((b) => b.branchId === manager.branchId), [allBorrowers, manager.branchId])
  const loans = useMemo(() => allLoans.filter((l) => l.branchId === manager.branchId), [allLoans, manager.branchId])
  const repayments = useMemo(() => {
    const branchLoanIds = new Set(loans.map((l) => l.id))
    return allRepayments.filter((r) => branchLoanIds.has(r.loanId))
  }, [allRepayments, loans])
  const applications = useMemo(() => allApplications.filter((a) => a.branchId === manager.branchId), [allApplications, manager.branchId])
  const pendingApprovals = useMemo(
    () => applications.filter((a) => (a.status === 'pending_approval' || a.status === 'submitted') && a.requiredApproverRole === 'branch_manager'),
    [applications],
  )

  const outstanding = portfolioOutstanding(loans)
  const disbursed = disbursedThisMonth(loans)
  const collected = collectedThisMonth(repayments)
  const { par, atRiskAmount } = portfolioAtRisk(loans)
  const activeBorrowers = new Set(loans.filter((l) => l.status === 'active').map((l) => l.borrowerId)).size

  const officers = allStaff.filter((s) => s.branchId === manager.branchId && s.role === 'loan_officer')
  const officerRows = officers.map((officer) => {
    const theirBorrowers = branchBorrowers.filter((b) => b.officerId === officer.id)
    const theirBorrowerIds = new Set(theirBorrowers.map((b) => b.id))
    const theirLoans = loans.filter((l) => theirBorrowerIds.has(l.borrowerId))
    const theirActiveLoans = theirLoans.filter((l) => l.status === 'active')
    const theirCollected = allRepayments
      .filter((r) => !r.reversed && isSameMonth(r.date) && theirLoans.some((l) => l.id === r.loanId))
      .reduce((s, r) => s + r.amount, 0)
    const { par: officerPar } = portfolioAtRisk(theirLoans)
    return {
      officer,
      activeClients: theirActiveLoans.length,
      collected: theirCollected,
      par: officerPar,
    }
  })

  if (!branch) return <p className="text-sm text-slate-500">No branch assigned to this account.</p>

  return (
    <div>
      <DashboardHero
        brandColor={lender.brandColor}
        eyebrow="Branch manager"
        title={`${branch.name} branch`}
        subtitle={`${branchBorrowers.length} borrowers · ${officers.length} loan officers · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Branch portfolio outstanding" value={formatMoney(outstanding, lender.currency)} icon={<Banknote size={16} />} tone="brand" />
        <StatTile label="Collected this month" value={formatMoney(collected, lender.currency)} icon={<Wallet size={16} />} tone="green" />
        <StatTile
          label="Portfolio at risk"
          value={`${par.toFixed(1)}%`}
          hint={formatMoney(atRiskAmount, lender.currency)}
          icon={<AlertTriangle size={16} />}
          tone={par > 10 ? 'red' : par > 5 ? 'amber' : 'brand'}
        />
        <StatTile label="Active borrowers" value={activeBorrowers.toString()} icon={<Users size={16} />} tone="brand" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ArrearsChart loans={loans} currency={lender.currency} subtitle={`${branch.name} — outstanding balance by days overdue`} />
        </div>

        <Card>
          <CardHeader title="Officer performance" subtitle="This month" />
          {officerRows.length === 0 ? (
            <p className="text-sm text-slate-400">No loan officers assigned to this branch.</p>
          ) : (
            <ul className="space-y-1">
              {officerRows.map((row) => (
                <li key={row.officer.id} className="flex items-center gap-3 rounded-lg px-1.5 py-2 text-sm transition-colors hover:bg-slate-50">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                    {row.officer.name
                      .split(' ')
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join('')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-800">{row.officer.name}</span>
                      <span className="text-xs text-slate-400">{row.activeClients} active clients</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Collected {formatMoney(row.collected, lender.currency)}</span>
                      <span className={row.par > 10 ? 'font-medium text-red-600' : row.par > 5 ? 'font-medium text-amber-600' : 'text-slate-400'}>PAR {row.par.toFixed(1)}%</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <ApplicationQueueCard
          title="Awaiting your approval"
          subtitle={`${pendingApprovals.length} application(s) at branch manager level, disbursed this month: ${formatMoney(disbursed, lender.currency)}`}
          applications={pendingApprovals}
          borrowers={allBorrowers}
          currency={lender.currency}
          emptyLabel="Nothing waiting for your approval."
        />
      </div>
    </div>
  )
}
