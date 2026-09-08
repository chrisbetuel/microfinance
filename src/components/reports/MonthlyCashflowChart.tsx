import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardHeader } from '../ui/Card'
import { formatMoney } from '../../lib/format'
import { monthlyCashflow } from '../../lib/reports'
import type { Loan, Repayment } from '../../types'

export function MonthlyCashflowChart({
  loans,
  repayments,
  currency,
  title = 'Cash flow',
  subtitle = 'Disbursed vs collected over the last 12 months',
}: {
  loans: Loan[]
  repayments: Repayment[]
  currency: string
  title?: string
  subtitle?: string
}) {
  const data = monthlyCashflow(loans, repayments)

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: -6 }}>
            <defs>
              <linearGradient id="gradCollected" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gradDisbursed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fill: '#64748b' }}
              axisLine={false}
              tickLine={false}
              width={78}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={(v, name) => [formatMoney(Number(v), currency), name === 'collected' ? 'Collected' : 'Disbursed']}
              labelFormatter={(label) => label as string}
              contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}
            />
            <Area type="monotone" dataKey="collected" name="collected" stroke="#10b981" strokeWidth={2} fill="url(#gradCollected)" />
            <Area type="monotone" dataKey="disbursed" name="disbursed" stroke="#6366f1" strokeWidth={2} fill="url(#gradDisbursed)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex items-center gap-5 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Collected
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-500" /> Disbursed
        </span>
      </div>
    </Card>
  )
}