'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Project, totalNetReceived, fmt } from '../lib/data'

function parseMonthDate(s: string): number {
  return new Date(Date.parse(s + ' 1')).getTime() || 0
}

const DELIVERY_COLORS: Record<string, string> = {
  'FM': '#1D9E75',
  'FM Update': '#534AB7',
  'Advisory': '#D85A30',
  'Intro': '#D4537E',
  'Webinar': '#378ADD',
}
const FALLBACK_COLORS = ['#1D9E75', '#534AB7', '#D85A30', '#D4537E', '#378ADD', '#BA7517', '#888780']

const tickFmt = (v: number) => v >= 1000 ? '$' + (v / 1000).toFixed(0) + 'k' : '$' + v

const sectionLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'var(--text2)',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '1rem',
}

const tooltipStyle: React.CSSProperties = {
  fontSize: 12, borderRadius: 8,
  border: '0.5px solid var(--border)', background: 'var(--surface)',
}

export function ChartsView({ projects }: { projects: Project[] }) {
  // Monthly billings — all months with data, sorted chronologically
  const monthMap: Record<string, number> = {}
  projects.forEach(p => {
    if (p.month) monthMap[p.month] = (monthMap[p.month] || 0) + p.amount
  })
  const monthlyData = Object.entries(monthMap)
    .map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => parseMonthDate(a.month) - parseMonthDate(b.month))

  // Annual billings — booked vs collected per year
  const annualMap: Record<string, { Booked: number; Collected: number }> = {}
  projects.forEach(p => {
    const yr = p.month?.trim().split(' ').pop()
    if (!yr) return
    if (!annualMap[yr]) annualMap[yr] = { Booked: 0, Collected: 0 }
    annualMap[yr].Booked += p.amount
    annualMap[yr].Collected += totalNetReceived(p)
  })
  const annualData = ['2025', '2026'].map(yr => ({
    year: yr, ...(annualMap[yr] || { Booked: 0, Collected: 0 }),
  }))

  // 2026 billings by delivery type — stacked bar per month
  const projects2026 = projects.filter(p => p.month?.trim().includes('2026'))
  const deliveries = [...new Set(projects2026.map(p => p.delivery?.trim()))].filter(Boolean).sort()
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const deliveryData = MONTHS.map(m => {
    const month = m + ' 2026'
    const row: Record<string, string | number> = { month: m }
    deliveries.forEach(d => {
      row[d] = projects.filter(p => p.month?.trim() === month && p.delivery?.trim() === d).reduce((s, p) => s + p.amount, 0)
    })
    return row
  })

  return (
    <div style={{ padding: '1.5rem 0', display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>

      <div>
        <div style={sectionLabel}>Monthly Billings</div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={monthlyData} margin={{ top: 4, right: 16, bottom: 52, left: 56 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="month" angle={-45} textAnchor="end" tick={{ fontSize: 10, fill: 'var(--text2)' }} interval={0} />
            <YAxis tickFormatter={tickFmt} tick={{ fontSize: 10, fill: 'var(--text2)' }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => [fmt(v as number), 'Booked']} cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: '#1a2744', border: '1px solid #2a3a5c', borderRadius: 6, color: '#f0f0ec', fontSize: 12 }} />
            <Bar dataKey="amount" fill="#1D9E75" name="Booked" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div style={sectionLabel}>Annual Collected — 2025 vs 2026</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={annualData} margin={{ top: 4, right: 16, bottom: 8, left: 56 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--text2)' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={tickFmt} tick={{ fontSize: 10, fill: 'var(--text2)' }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => [fmt(v as number), 'Collected']} contentStyle={tooltipStyle} />
            <Bar dataKey="Collected" fill="#1D9E75" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div style={sectionLabel}>2026 Billings by Delivery Type</div>
        {deliveries.length === 0
          ? <p style={{ fontSize: 12, color: 'var(--text3)' }}>No 2026 data yet.</p>
          : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={deliveryData} margin={{ top: 4, right: 16, bottom: 8, left: 56 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text2)' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={tickFmt} tick={{ fontSize: 10, fill: 'var(--text2)' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => fmt(v as number)} contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {deliveries.map((d, i) => (
                  <Bar
                    key={d}
                    dataKey={d}
                    stackId="a"
                    fill={DELIVERY_COLORS[d] || FALLBACK_COLORS[i % FALLBACK_COLORS.length]}
                    radius={i === deliveries.length - 1 ? [3, 3, 0, 0] : undefined}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
      </div>

    </div>
  )
}
