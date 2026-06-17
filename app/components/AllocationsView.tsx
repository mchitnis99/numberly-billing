'use client'

import { useState } from 'react'
import { Project, totalNetReceived, fmt, ALLOC_COLORS } from '../lib/data'

const MONTH_ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function monthToNum(m: string): number {
  const parts = m.trim().split(' ')
  const mon = MONTH_ORDER.indexOf(parts[0])
  const yr = parseInt(parts[1]) || 0
  return yr * 100 + mon
}

type MemberKey = 'J' | 'M' | 'N' | 'A' | 'G'

const MEMBERS: { key: MemberKey; name: string }[] = [
  { key: 'J', name: 'John' },
  { key: 'M', name: 'Monica' },
  { key: 'N', name: 'Numberly' },
  { key: 'A', name: 'Altion' },
  { key: 'G', name: 'Gaby' },
]

export function AllocationsView({ projects }: { projects: Project[] }) {
  const [activeMember, setActiveMember] = useState<MemberKey>('M')

  const totals = MEMBERS.map(({ key, name }) => ({
    key, name,
    total: projects.reduce((s, p) => s + totalNetReceived(p) * (p.alloc[key] || 0) / 100, 0),
  }))

  const months = [...new Set(projects.map(p => p.month).filter(Boolean))]
    .sort((a, b) => monthToNum(a) - monthToNum(b))

  const rows = months.map(month => {
    const ps = projects.filter(p => p.month === month)
    const grossCollected = ps.reduce((s, p) => s + totalNetReceived(p), 0)
    const memberShare = ps.reduce((s, p) => s + totalNetReceived(p) * (p.alloc[activeMember] || 0) / 100, 0)
    return { month, count: ps.length, grossCollected, memberShare }
  }).filter(r => r.count > 0)

  const activeTotal = totals.find(t => t.key === activeMember)?.total || 0
  const activeName = MEMBERS.find(m => m.key === activeMember)?.name || ''

  return (
    <div style={{ padding: '1.5rem 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: '2rem' }}>
        {totals.map(({ key, name, total }) => (
          <div key={key} onClick={() => setActiveMember(key)} style={{
            background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem',
            border: `0.5px solid ${activeMember === key ? ALLOC_COLORS[key] : 'var(--border)'}`,
            cursor: 'pointer',
          }}>
            <div style={{ fontSize: 10, color: ALLOC_COLORS[key], textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 3 }}>{name}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: activeMember === key ? ALLOC_COLORS[key] : 'var(--text)' }}>{fmt(total)}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.75rem' }}>
        {activeName} — Monthly Breakdown
      </div>
      <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'auto' }}>
          <thead>
            <tr>
              <th>Month</th>
              <th>Projects</th>
              <th style={{ textAlign: 'right' }}>Gross Collected</th>
              <th style={{ textAlign: 'right' }}>{activeName}&apos;s Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.month}>
                <td style={{ fontWeight: 500 }}>{r.month}</td>
                <td style={{ color: 'var(--text2)' }}>{r.count}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.grossCollected)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: ALLOC_COLORS[activeMember], fontWeight: 500 }}>{fmt(r.memberShare)}</td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr style={{ borderTop: '1px solid var(--border2)' }}>
                <td style={{ fontWeight: 600 }}>Total</td>
                <td style={{ color: 'var(--text2)', fontWeight: 600 }}>{rows.reduce((s, r) => s + r.count, 0)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(rows.reduce((s, r) => s + r.grossCollected, 0))}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: ALLOC_COLORS[activeMember], fontWeight: 600 }}>{fmt(activeTotal)}</td>
              </tr>
            )}
            {rows.length === 0 && (
              <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text3)' }}>No allocation data yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
