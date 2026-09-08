import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Card, CardHeader } from '../ui/Card'
import { formatMoney } from '../../lib/format'
import { collectionsByChannel } from '../../lib/reports'
import type { Repayment } from '../../types'

const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#38bdf8', '#f43f5e', '#8b5cf6', '#64748b']

export function CollectionsDonut({
  repayments,
  currency,
  title = 'Collections by channel',
  subtitle = 'Where collected payments came from',
}: {
  repayments: Repayment[]
  currency: string
  title?: string
  subtitle?: string
}) {
  const rows = collectionsByChannel(repayments)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const data = rows.map((r, i) => ({ name: r.channel, value: r.amount, fill: PALETTE[i % PALETTE.length] }))

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="flex flex-col items-center">
        <div className="relative h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2} strokeWidth={2}>
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v) => formatMoney(Number(v), currency)}
                contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total</span>
            <span className="tabular-nums text-base font-extrabold text-slate-900">{formatMoney(total, currency)}</span>
          </div>
        </div>
        <ul className="mt-2 w-full space-y-1.5">
          {data.map((row) => (
            <li key={row.name} className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-2 text-slate-600">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.fill }} />
                {row.name}
              </span>
              <span className="tabular-nums font-medium text-slate-800">{formatMoney(row.value, currency)}</span>
            </li>
          ))}
          {data.length === 0 && <li className="py-8 text-center text-sm text-slate-400">No collections recorded yet.</li>}
        </ul>
      </div>
    </Card>
  )
}