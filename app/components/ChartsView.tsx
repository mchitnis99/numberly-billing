'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Project, totalNetReceived, fmt } from '../lib/data'

type MemberKey = 'J' | 'M' | 'G'
const MEMBERS: MemberKey[] = ['J', 'M', 'G']

const MONTH_ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function parseYearAndMon(m: string): { mon: number; fullYr: number } {
  const cleaned = m.replace(/,/g, '').trim()
  const dashMatch = cleaned.match(/^([A-Za-z]+)-(\d{2,4})$/)
  if (dashMatch) {
    const mon = MONTH_ORDER.indexOf(dashMatch[1])
    const yr = parseInt(dashMatch[2])
    return { mon, fullYr: yr < 100 ? (yr > 50 ? 1900 + yr : 2000 + yr) : yr }
  }
  const spaceMatch = cleaned.match(/^([A-Za-z]+)\s+(\d{2,4})$/)
  if (spaceMatch) {
    const mon = MONTH_ORDER.indexOf(spaceMatch[1])
    const yr = parseInt(spaceMatch[2])
    return { mon, fullYr: yr < 100 ? (yr > 50 ? 1900 + yr : 2000 + yr) : yr }
  }
  return { mon: -1, fullYr: 0 }
}

function monthToNum(m: string): number {
  const { mon, fullYr } = parseYearAndMon(m)
  return fullYr * 100 + mon
}

function normalizeMonth(m: string): string {
  const { mon, fullYr } = parseYearAndMon(m)
  if (mon < 0 || fullYr === 0) return m.replace(/,/g, '').trim()
  return MONTH_ORDER[mon] + ' ' + fullYr
}

function extractYear(m: string): string {
  const { fullYr } = parseYearAndMon(m)
  return fullYr > 0 ? String(fullYr) : ''
}

const DELIVERY_COLORS: Record<string, string> = {
  'FM':         '#1D9E75',
  'FM Update':  '#378ADD',
  'Advisory':   '#D85A30',
  'Pitch Deck': '#534AB7',
  'BP':         '#D4537E',
  'Other':      '#888780',
}
const FALLBACK_COLORS = ['#1D9E75', '#378ADD', '#D85A30', '#534AB7', '#D4537E', '#888780', '#BA7517']

const tickFmt = (v: number) => v >= 1000 ? '$' + (v / 1000).toFixed(0) + 'k' : '$' + v

const sectionLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'var(--text2)',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '1rem',
}

const tooltipStyle: React.CSSProperties = {
  fontSize: 12, borderRadius: 8,
  border: '0.5px solid var(--border)', background: 'var(--surface)',
}

const darkTooltip: React.CSSProperties = {
  backgroundColor: '#1a2744', border: '1px solid #2a3a5c', borderRadius: 6, color: '#f0f0ec', fontSize: 12,
}

export function ChartsView({ projects }: { projects: Project[] }) {
  // Monthly booked vs collected — all months with data, sorted chronologically
  const monthMap: Record<string, { Booked: number; Collected: number; byMember: Record<MemberKey, number> }> = {}
  projects.forEach(p => {
    const m = normalizeMonth(p.month)
    if (!m) return
    if (!monthMap[m]) monthMap[m] = { Booked: 0, Collected: 0, byMember: { J: 0, M: 0, G: 0 } }
    monthMap[m].Booked += p.amount
    monthMap[m].Collected += totalNetReceived(p)
    MEMBERS.forEach(k => { monthMap[m].byMember[k] += p.amount * (p.alloc[k] || 0) / 100 })
  })
  const monthlyData = Object.entries(monthMap)
    .map(([month, vals]) => ({ month, ...vals }))
    .sort((a, b) => monthToNum(a.month) - monthToNum(b.month))

  // Chart shouldn't render a Collected bar for pre-2026 months — data isn't final yet
  const monthlyChartData = monthlyData.map(row => ({
    ...row,
    Collected: monthToNum(row.month) >= 2026 * 100 ? row.Collected : null,
  }))

  const monthlyTotals = monthlyData.reduce((acc, row) => {
    acc.Booked += row.Booked
    acc.Collected += row.Collected
    MEMBERS.forEach(k => { acc.byMember[k] += row.byMember[k] })
    return acc
  }, { Booked: 0, Collected: 0, byMember: { J: 0, M: 0, G: 0 } as Record<MemberKey, number> })

  // Annual — booked and collected per year
  const annualMap: Record<string, { Booked: number; Collected: number }> = {}
  projects.forEach(p => {
    const yr = extractYear(p.month)
    if (!yr) return
    if (!annualMap[yr]) annualMap[yr] = { Booked: 0, Collected: 0 }
    annualMap[yr].Booked += p.amount
    annualMap[yr].Collected += totalNetReceived(p)
  })
  const annualData = ['2025', '2026'].map(yr => ({
    year: yr, ...(annualMap[yr] || { Booked: 0, Collected: 0 }),
  }))

  // 2026 bookings by delivery type — stacked bar per month
  const KNOWN_DELIVERIES = ['FM', 'FM Update', 'Advisory', 'Pitch Deck', 'BP']
  function normalizeDelivery(raw: string | undefined): string {
    const d = raw?.trim() ?? ''
    if (d === 'PD') return 'Pitch Deck'
    if (KNOWN_DELIVERIES.includes(d)) return d
    return 'Other'
  }

  const projects2026 = projects.filter(p => extractYear(p.month) === '2026')
  const deliveries = [...new Set(projects2026.map(p => normalizeDelivery(p.delivery)))].filter(Boolean).sort()
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const deliveryData = MONTHS.map(m => {
    const month = m + ' 2026'
    const row: Record<string, string | number> = { month: m }
    deliveries.forEach(d => {
      row[d] = projects.filter(p => normalizeMonth(p.month) === month && normalizeDelivery(p.delivery) === d).reduce((s, p) => s + p.amount, 0)
    })
    return row
  })

  return (
    <div style={{ padding: '1.5rem 0', display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>

      <div>
        <div style={sectionLabel}>Monthly Booked vs Collected</div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={monthlyChartData} margin={{ top: 4, right: 16, bottom: 52, left: 56 }} barGap={2} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="month" angle={-45} textAnchor="end" tick={{ fontSize: 10, fill: 'var(--text2)' }} interval={0} />
            <YAxis tickFormatter={tickFmt} tick={{ fontSize: 10, fill: 'var(--text2)' }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v, name) => [fmt(v as number), name]} cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={darkTooltip} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 48 }} />
            <Bar dataKey="Booked" fill="#534AB7" radius={[3, 3, 0, 0]} background={{ fill: 'transparent' }} />
            <Bar dataKey="Collected" fill="#1D9E75" radius={[3, 3, 0, 0]} background={{ fill: 'transparent' }} />
          </BarChart>
        </ResponsiveContainer>
        <div className="table-wrap" style={{ marginTop: '1rem' }}>
          <table style={{ minWidth: 'auto', tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th>Month</th>
                <th>Booked</th>
                <th>Collected</th>
                <th>Variance</th>
                <th>J%</th>
                <th>M%</th>
                <th>G%</th>
              </tr>
            </thead>
            <tbody>
              {monthlyData.length === 0
                ? <tr><td colSpan={7}>No data</td></tr>
                : monthlyData.map(row => {
                  const isFinal = monthToNum(row.month) >= 2026 * 100
                  const variance = row.Booked - row.Collected
                  return (
                    <tr key={row.month}>
                      <td>{row.month}</td>
                      <td className="amt">{fmt(row.Booked)}</td>
                      <td className="amt">{isFinal ? fmt(row.Collected) : '—'}</td>
                      <td className="amt" style={{ color: isFinal && variance < 0 ? 'var(--red)' : 'var(--text3)' }}>{isFinal ? fmt(variance) : '—'}</td>
                      {MEMBERS.map(k => (
                        <td key={k} className="amt">
                          {row.Booked > 0 ? Math.round(row.byMember[k] / row.Booked * 100) + '%' : '—'}
                        </td>
                      ))}
                    </tr>
                  )
                })}
            </tbody>
            {monthlyData.length > 0 && (
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 600 }}>Total</td>
                  <td className="amt" style={{ fontWeight: 600 }}>{fmt(monthlyTotals.Booked)}</td>
                  <td className="amt" style={{ fontWeight: 600 }}>{fmt(monthlyTotals.Collected)}</td>
                  <td className="amt" style={{ fontWeight: 600, color: (monthlyTotals.Booked - monthlyTotals.Collected) < 0 ? 'var(--red)' : 'var(--text3)' }}>
                    {fmt(monthlyTotals.Booked - monthlyTotals.Collected)}
                  </td>
                  {MEMBERS.map(k => (
                    <td key={k} className="amt" style={{ fontWeight: 600 }}>
                      {monthlyTotals.Booked > 0 ? Math.round(monthlyTotals.byMember[k] / monthlyTotals.Booked * 100) + '%' : '—'}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Annual Booked + Collected side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        <div>
          <div style={sectionLabel}>Annual Booked — 2025 vs 2026</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={annualData} margin={{ top: 4, right: 16, bottom: 8, left: 56 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--text2)' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={tickFmt} tick={{ fontSize: 10, fill: 'var(--text2)' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => [fmt(v as number), 'Booked']} cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={tooltipStyle} />
              <Bar dataKey="Booked" fill="#534AB7" radius={[3, 3, 0, 0]} background={{ fill: 'transparent' }} />
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
              <Tooltip formatter={(v) => [fmt(v as number), 'Collected']} cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={tooltipStyle} />
              <Bar dataKey="Collected" fill="#1D9E75" radius={[3, 3, 0, 0]} background={{ fill: 'transparent' }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <div style={sectionLabel}>2026 Bookings by Delivery Type</div>
        {deliveries.length === 0
          ? <p style={{ fontSize: 12, color: 'var(--text3)' }}>No 2026 data yet.</p>
          : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={deliveryData} margin={{ top: 4, right: 16, bottom: 8, left: 56 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text2)' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={tickFmt} tick={{ fontSize: 10, fill: 'var(--text2)' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => fmt(v as number)} cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {deliveries.map((d, i) => (
                  <Bar
                    key={d}
                    dataKey={d}
                    stackId="a"
                    fill={DELIVERY_COLORS[d] || FALLBACK_COLORS[i % FALLBACK_COLORS.length]}
                    radius={i === deliveries.length - 1 ? [3, 3, 0, 0] : undefined}
                    background={{ fill: 'transparent' }}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
      </div>

    </div>
  )
}
