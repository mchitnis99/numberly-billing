'use client'

import { Project, totalNetReceived, fmt, ALLOC_COLORS } from '../lib/data'

const MONTH_ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function monthToNum(m: string): number {
  const cleaned = m.replace(/,/g, '').trim()
  const dashMatch = cleaned.match(/^([A-Za-z]+)-(\d{2,4})$/)
  if (dashMatch) {
    const mon = MONTH_ORDER.indexOf(dashMatch[1])
    const yr = parseInt(dashMatch[2])
    const fullYr = yr < 100 ? (yr > 50 ? 1900 + yr : 2000 + yr) : yr
    return fullYr * 100 + mon
  }
  const spaceMatch = cleaned.match(/^([A-Za-z]+)\s+(\d{2,4})$/)
  if (spaceMatch) {
    const mon = MONTH_ORDER.indexOf(spaceMatch[1])
    const yr = parseInt(spaceMatch[2])
    const fullYr = yr < 100 ? (yr > 50 ? 1900 + yr : 2000 + yr) : yr
    return fullYr * 100 + mon
  }
  return 0
}

type MemberKey = 'J' | 'M' | 'N' | 'A' | 'G'

const MEMBERS: { key: MemberKey; name: string }[] = [
  { key: 'J', name: 'John' },
  { key: 'M', name: 'Monica' },
  { key: 'N', name: 'Numberly' },
  { key: 'A', name: 'Altion' },
  { key: 'G', name: 'Gaby' },
]

function normalizeMonth(m: string) {
  return m.replace(/,/g, '').trim()
}

function getMemberRows(projects: Project[], key: MemberKey) {
  const months = [...new Set(projects.map(p => normalizeMonth(p.month)).filter(Boolean))]
    .sort((a, b) => monthToNum(a) - monthToNum(b))

  const rows = months.map(month => {
    const ps = projects.filter(p => normalizeMonth(p.month) === month && (p.alloc[key] || 0) > 0)
    const sales = ps.reduce((s, p) => s + totalNetReceived(p), 0)
    const revShare = ps.reduce((s, p) => s + totalNetReceived(p) * (p.alloc[key] || 0) / 100, 0)
    const bookedAlloc = ps.reduce((s, p) => s + p.amount * (p.alloc[key] || 0) / 100, 0)
    const pctCollected = bookedAlloc > 0 ? revShare / bookedAlloc * 100 : 0
    return { month, sales, revShare, bookedAlloc, pctCollected }
  }).filter(r => r.bookedAlloc > 0 || r.sales > 0)

  const totalSales = rows.reduce((s, r) => s + r.sales, 0)
  const totalRevShare = rows.reduce((s, r) => s + r.revShare, 0)
  const totalBookedAlloc = rows.reduce((s, r) => s + r.bookedAlloc, 0)
  const totalPct = totalBookedAlloc > 0 ? totalRevShare / totalBookedAlloc * 100 : 0

  return { rows, totalSales, totalRevShare, totalBookedAlloc, totalPct }
}

export function AllocationsView({ projects }: { projects: Project[] }) {
  const summaries = MEMBERS.map(({ key, name }) => ({
    key, name, total: getMemberRows(projects, key).totalRevShare,
  }))

  return (
    <div style={{ padding: '1.5rem 0', display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {summaries.map(({ key, name, total }) => (
          <div key={key} style={{
            background: 'var(--surface2)', borderRadius: 'var(--radius)',
            padding: '0.75rem 1rem', border: '0.5px solid var(--border)',
          }}>
            <div style={{ fontSize: 10, color: ALLOC_COLORS[key], textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 3 }}>{name}</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{fmt(total)}</div>
          </div>
        ))}
      </div>

      {/* Per-member breakdown tables */}
      {MEMBERS.map(({ key, name }) => {
        const { rows, totalSales, totalRevShare, totalPct } = getMemberRows(projects, key)
        return (
          <div key={key}>
            <div style={{ fontSize: 11, fontWeight: 700, color: ALLOC_COLORS[key], textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.6rem' }}>
              {name}
            </div>
            <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'auto' }}>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th style={{ textAlign: 'right' }}>Sales</th>
                    <th style={{ textAlign: 'right' }}>Rev Share</th>
                    <th style={{ textAlign: 'right' }}>% Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.month}>
                      <td style={{ fontWeight: 500 }}>{r.month}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.sales)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: ALLOC_COLORS[key], fontWeight: 500 }}>{fmt(r.revShare)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text2)' }}>{r.pctCollected.toFixed(0)}%</td>
                    </tr>
                  ))}
                  {rows.length > 0 && (
                    <tr style={{ borderTop: '1px solid var(--border2)' }}>
                      <td style={{ fontWeight: 600 }}>Total</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(totalSales)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: ALLOC_COLORS[key] }}>{fmt(totalRevShare)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--text2)' }}>{totalPct.toFixed(0)}%</td>
                    </tr>
                  )}
                  {rows.length === 0 && (
                    <tr><td colSpan={4} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text3)' }}>No data yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
