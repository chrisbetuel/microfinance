import { Link } from 'react-router-dom'
import { Card, CardHeader } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { BorrowerLink } from '../ui/BorrowerLink'
import { formatDate, formatMoney } from '../../lib/format'
import type { Application, Borrower } from '../../types'

export function ApplicationQueueCard({
  title,
  subtitle,
  applications,
  borrowers,
  currency,
  emptyLabel = 'Nothing waiting — the queue is clear.',
  viewAllHref = '/applications',
}: {
  title: string
  subtitle?: string
  applications: Application[]
  borrowers: Borrower[]
  currency: string
  emptyLabel?: string
  viewAllHref?: string
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle}
        action={
          <Link to={viewAllHref} className="text-xs font-medium text-indigo-600 hover:underline">
            View all
          </Link>
        }
      />
      {applications.length === 0 ? (
        <p className="text-sm text-slate-400">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {applications.map((app) => (
            <li key={app.id} className="flex items-center justify-between py-2.5 text-sm">
              <div>
                <Link to={`/applications/${app.id}`} className="font-medium text-slate-800 hover:text-indigo-600">
                  {app.reference}
                </Link>
                <p className="text-xs text-slate-400">
                  <BorrowerLink id={app.borrowerId} borrowers={borrowers} /> · {formatDate(app.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-600">{formatMoney(app.amount, currency)}</span>
                <Badge tone={app.status === 'submitted' ? 'blue' : 'amber'}>{app.status.replace('_', ' ')}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
