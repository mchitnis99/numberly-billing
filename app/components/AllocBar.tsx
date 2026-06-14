import { Allocation, ALLOC_COLORS } from '../lib/data'

export function AllocBar({ alloc }: { alloc: Allocation }) {
  const entries = Object.entries(alloc).filter(([, v]) => v > 0) as [string, number][]
  if (!entries.length) return null
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, height: 6, borderRadius: 3, overflow: 'hidden' }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ width: `${v}%`, background: ALLOC_COLORS[k], height: '100%' }} title={`${k}: ${v}%`} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        {entries.map(([k, v]) => (
          <span key={k} style={{ fontSize: 11, color: ALLOC_COLORS[k], fontWeight: 500 }}>{k} {v}%</span>
        ))}
      </div>
    </div>
  )
}
