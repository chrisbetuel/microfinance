import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card, CardHeader } from '../ui/Card'
import { formatMoney } from '../../lib/format'
import { arrearsAgingBuckets } from '../../lib/selectors'
import type { Loan } from '../../types'

const bandLabels: Record<string, string> = {
  current: 'Current',
  '1-7': '1–7 days',
  '8-30': '8–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  over90: 'Over 90 days',
}

const bandColors: Record<string, string> = {
  current: '#94A3B8',
  '1-7': '#FBBF24',
  '8-30': '#F59E0B',
  '31-60': '#FB923C',
  '61-90': '#F87171',
  over90: '#DC2626',
}

export function ArrearsChart({ loans, currency, subtitle }: { loans: Loan[]; currency: string; subtitle?: string }) {
  const buckets = arrearsAgingBuckets(loans)
  const chartData = Object.entries(buckets).map(([band, v]) => ({ band: bandLabels[band], amount: v.amount, key: band }))

  return (
    <Card>
      <CardHeader title="Arrears aging" subtitle={subtitle ?? 'Outstanding balance of active loans by days overdue'} />
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ left: -10 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="band" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={70} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => formatMoney(Number(v), currency)} contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }} cursor={{ fill: '#EE0033', fillOpacity: 0.06 }} />
            <Bar dataKey="amount" radius={[6, 6, 2, 2]}>
              {chartData.map((entry) => (
                <Cell key={entry.key} fill={bandColors[entry.key]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
