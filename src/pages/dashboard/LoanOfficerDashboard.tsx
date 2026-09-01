import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { UserPlus, FilePlus2, Wallet as WalletIcon, Users, Banknote, AlertTriangle } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { StatTile } from '../../components/ui/StatTile'
import { BorrowerLink } from '../../components/ui/BorrowerLink'
import { DashboardHero } from '../../components/dashboard/DashboardHero'
import { formatDate, formatMoney } from '../../lib/format'
import { collectedThisMonth, daysLate, portfolioOutstanding } from '../../lib/selectors'
import type { ApplicationStatus, Staff } from '../../types'

const statusTone: Record<ApplicationStatus, BadgeTone> = {
  draft: 'slate',
  submitted: 'blue',
  pending_approval: 'amber',
  approved: 'green',
  declined: 'red',
  disbursed: 'violet',
}

export default function LoanOfficerDashboard({ staff: officer }: { staff: Staff }) {
  const allBorrowers = useStore((s) => s.borrowers)
  const allLoans = useStore((s) => s.loans)
  const allApplications = useStore((s) => s.applications)
  const allRepayments = useStore((s) => s.repayments)
  const branches = useStore((s) => s.branches)
  const lender = useStore((s) => s.lender)

  const myBorrowers = useMemo(() => allBorrowers.filter((b) => b.officerId === officer.id), [allBorrowers, officer.id])
  const myBorrowerIds = useMemo(() => new Set(myBorrowers.map((b) => b.id)), [myBorrowers])
  const myLoans = useMemo(() => allLoans.filter((l) => myBorrowerIds.has(l.borrowerId)), [allLoans, myBorrowerIds])
  const myApplications = useMemo(
    () => [...allApplications].filter((a) => a.createdBy === officer.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [allApplications, officer.id],
  )
  const myRepayments = useMemo(() => {
    const myLoanIds = new Set(myLoans.map((l) => l.id))
    return allRepayments.filter((r) => myLoanIds.has(r.loanId))
  }, [allRepayments, myLoans])

  const branch = branches.find((b) => b.id === officer.branchId)
  const activeLoans = myLoans.filter((l) => l.status === 'active')
  const outstanding = portfolioOutstanding(myLoans)
  const collected = collectedThisMonth(myRepayments)

  const followUpList = useMemo(
    () =>
      activeLoans
        .map((loan) => ({ loan, late: daysLate(loan) }))
        .filter((x) => x.late > 0)
        .sort((a, b) => b.late - a.late),
    [activeLoans],
  )

  const pendingMyApplications = myApplications.filter((a) => a.status === 'pending_approval' || a.status === 'submitted')

  return (
    <div>
      <DashboardHero
        brandColor={lender.brandColor}
        eyebrow="Loan officer"
        title={`Good day, ${officer.name}`}
        subtitle={`${branch?.name ?? ''} · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
        action={
          <>
            <Link to="/borrowers">
              <Button variant="hero" size="sm" icon={<UserPlus size={14} />}>
                Register borrower
              </Button>
            </Link>
            <Link to="/applications/new">
              <Button variant="secondary" size="sm" icon={<FilePlus2 size={14} />}>
                New application
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="My borrowers" value={myBorrowers.length.toString()} icon={<Users size={16} />} tone="brand" />
        <StatTile label="My active loans" value={activeLoans.length.toString()} hint={formatMoney(outstanding, lender.currency)} icon={<Banknote size={16} />} tone="brand" />
        <StatTile label="Collected this month" value={formatMoney(collected, lender.currency)} icon={<WalletIcon size={16} />} tone="green" />
        <StatTile
          label="In arrears"
          value={followUpList.length.toString()}
          hint="loans need follow-up today"
          icon={<AlertTriangle size={16} />}
          tone={followUpList.length > 0 ? 'amber' : 'brand'}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="Today's follow-up list" subtitle="Ordered by days overdue, worst first" />
          </div>
          {followUpList.length === 0 ? (
            <p className="p-5 pt-0 text-sm text-slate-400">No overdue loans in your portfolio — nothing to chase today.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {followUpList.map(({ loan, late }) => (
                <li key={loan.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <BorrowerLink id={loan.borrowerId} borrowers={allBorrowers} />
                    <p className="text-xs text-slate-400">{formatMoney(loan.outstandingBalance, lender.currency)} outstanding</p>
                  </div>
                  <Badge dot tone={late > 30 ? 'red' : 'amber'}>{late} days overdue</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader
              title="My applications"
              subtitle={`${pendingMyApplications.length} awaiting a decision`}
              action={
                <Link to="/applications" className="text-xs font-medium text-brand-600 hover:underline">
                  View all
                </Link>
              }
            />
          </div>
          {myApplications.length === 0 ? (
            <p className="p-5 pt-0 text-sm text-slate-400">You haven't submitted any applications yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {myApplications.slice(0, 6).map((app) => (
                <li key={app.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <Link to={`/applications/${app.id}`} className="font-medium text-slate-800 hover:text-brand-600">
                      {app.reference}
                    </Link>
                    <p className="text-xs text-slate-400">
                      <BorrowerLink id={app.borrowerId} borrowers={allBorrowers} /> · {formatDate(app.createdAt)}
                    </p>
                  </div>
                  <Badge dot tone={statusTone[app.status]}>{app.status.replace('_', ' ')}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
