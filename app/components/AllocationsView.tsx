'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Project, totalNetReceived, fmt, ALLOC_COLORS } from '../lib/data'
import { Payout, DevEarning, fetchPayouts, fetchDevEarnings, upsertPayout, upsertDevEarning, bulkUpsertPayouts, bulkUpsertDevEarnings } from '../lib/payouts'

const MONTH_ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function parseYearAndMon(m: string): { mon: number; fullYr: number } {
  const cleaned = m.replace(/,/g, '').trim()
  const dash = cleaned.match(/^([A-Za-z]+)-(\d{2,4})$/)
  if (dash) {
    const yr = parseInt(dash[2])
    return { mon: MONTH_ORDER.indexOf(dash[1]), fullYr: yr < 100 ? (yr > 50 ? 1900 + yr : 2000 + yr) : yr }
  }
  const space = cleaned.match(/^([A-Za-z]+)\s+(\d{2,4})$/)
  if (space) {
    const yr = parseInt(space[2])
    return { mon: MONTH_ORDER.indexOf(space[1]), fullYr: yr < 100 ? (yr > 50 ? 1900 + yr : 2000 + yr) : yr }
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

// Character-by-character CSV parser — handles quoted multiline fields
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let cur = '', inQuotes = false, fields: string[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1]
    if (ch === '"') {
      if (inQuotes && next === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      fields.push(cur.trim()); cur = ''
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++
      fields.push(cur.trim()); cur = ''
      if (fields.some(f => f !== '')) rows.push(fields)
      fields = []
    } else { cur += ch }
  }
  if (fields.length || cur) { fields.push(cur.trim()); if (fields.some(f => f !== '')) rows.push(fields) }
  return rows
}

function parseAmount(s: string): number {
  if (!s || s.trim() === '-' || s.trim() === '') return 0
  const isNeg = s.startsWith('(') && s.endsWith(')')
  const cleaned = s.replace(/[()$\s]/g, '').replace(/,/g, '')
  const val = parseFloat(cleaned) || 0
  return isNeg ? -val : val
}

const MEMBER_MAP: Record<string, MemberKey> = {
  john: 'J', monica: 'M', altion: 'A', gaby: 'G', numberly: 'N',
}

const JAN_2025 = 2025 * 100 + 0  // monthToNum('Jan 2025')

function parseAllocationsCSV(text: string): { payouts: Omit<Payout, 'id'>[]; devEarnings: Omit<DevEarning, 'id'>[] } {
  const rows = parseCSV(text)
  if (rows.length < 2) return { payouts: [], devEarnings: [] }

  // Row at index 1 contains months starting at column 3
  const headerRow = rows[1]
  const monthCols: (string | null)[] = headerRow.map((cell, i) => {
    if (i < 3) return null
    const val = cell.trim()
    if (!val) return null
    const lower = val.toLowerCase()
    if (lower.includes('total') || lower.includes('last 12')) return null
    const normalized = normalizeMonth(val)
    if (monthToNum(normalized) < JAN_2025) return null
    return normalized
  })

  const rawPayouts: { member: string; month: string; amount: number }[] = []
  const rawDevEarnings: { member: string; month: string; amount: number }[] = []
  let currentMember: MemberKey | null = null

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i]
    const colB = (row[1] || '').trim()
    const memberKey = MEMBER_MAP[colB.toLowerCase()]
    if (memberKey) { currentMember = memberKey; continue }
    if (!currentMember) continue

    const label = colB.toLowerCase()
    let rowType: 'dev' | 'payout' | null = null
    if (label.includes('development earnings') || label.includes('other earnings')) rowType = 'dev'
    else if (label.includes('cash paid out')) rowType = 'payout'
    if (!rowType) continue

    monthCols.forEach((month, colIdx) => {
      if (!month) return
      const amount = parseAmount(row[colIdx] || '')
      if (amount === 0) return
      if (rowType === 'dev') rawDevEarnings.push({ member: currentMember!, month, amount })
      else rawPayouts.push({ member: currentMember!, month, amount })
    })
  }

  // Aggregate: sum multiple rows (e.g. Dev Earnings + Other Earnings) for same member+month
  function aggregate<T extends { member: string; month: string; amount: number }>(items: T[]): Omit<Payout, 'id'>[] {
    const map: Record<string, { member: string; month: string; amount: number; note: string }> = {}
    items.forEach(({ member, month, amount }) => {
      const k = `${member}|${month}`
      if (!map[k]) map[k] = { member, month, amount, note: '' }
      else map[k].amount += amount
    })
    return Object.values(map)
  }

  return { payouts: aggregate(rawPayouts), devEarnings: aggregate(rawDevEarnings) }
}

type MemberKey = 'J' | 'M' | 'N' | 'A' | 'G'
const MEMBERS: { key: MemberKey; name: string }[] = [
  { key: 'J', name: 'John' },
  { key: 'M', name: 'Monica' },
  { key: 'N', name: 'Numberly' },
  { key: 'A', name: 'Altion' },
  { key: 'G', name: 'Gaby' },
]

type EditState = { member: MemberKey; month: string; field: 'payout' | 'dev' } | null

export function AllocationsView({ projects }: { projects: Project[] }) {
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [devEarnings, setDevEarnings] = useState<DevEarning[]>([])
  const [collapsed, setCollapsed] = useState<Set<MemberKey>>(new Set())
  const [editState, setEditState] = useState<EditState>(null)
  const [editValue, setEditValue] = useState('')
  const [importMsg, setImportMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchPayouts().then(setPayouts).catch(console.error)
    fetchDevEarnings().then(setDevEarnings).catch(console.error)
  }, [])

  // All months from earliest project to current month, chronological
  const allMonths = useMemo((): string[] => {
    const nums = projects.map(p => monthToNum(normalizeMonth(p.month))).filter(n => n > 0)
    if (nums.length === 0) return []
    const minNum = Math.min(...nums)
    const now = new Date()
    const maxNum = now.getFullYear() * 100 + now.getMonth()
    const result: string[] = []
    let yr = Math.floor(minNum / 100)
    let mon = minNum % 100
    while (yr * 100 + mon <= maxNum) {
      result.push(MONTH_ORDER[mon] + ' ' + yr)
      mon++
      if (mon >= 12) { mon = 0; yr++ }
    }
    return result
  }, [projects])

  // Build running ledger rows for all members
  const memberData = useMemo(() => MEMBERS.map(({ key, name }) => {
    let running = 0
    const rows = allMonths.map(month => {
      const ps = projects.filter(p => normalizeMonth(p.month) === month)
      const revShare = ps.reduce((s, p) => s + totalNetReceived(p) * (p.alloc[key] || 0) / 100, 0)
      const bookedAlloc = ps.reduce((s, p) => s + p.amount * (p.alloc[key] || 0) / 100, 0)
      const devEarning = devEarnings.find(d => d.member === key && d.month === month)?.amount || 0
      const payout = payouts.find(p => p.member === key && p.month === month)?.amount || 0
      const payAvailable = running + revShare + devEarning
      const balance = payAvailable - payout
      const pctCollected = bookedAlloc > 0 ? revShare / bookedAlloc * 100 : 0
      running = balance
      return { month, revShare, bookedAlloc, devEarning, payout, payAvailable, balance, pctCollected }
    })
    const totalRevShare = rows.reduce((s, r) => s + r.revShare, 0)
    const totalPaidOut = rows.reduce((s, r) => s + r.payout, 0)
    const currentBalance = rows.length > 0 ? rows[rows.length - 1].balance : 0
    return { key, name, rows, totalRevShare, totalPaidOut, currentBalance }
  }), [projects, payouts, devEarnings, allMonths])

  async function commitEdit(member: MemberKey, month: string, field: 'payout' | 'dev') {
    const amount = parseFloat(editValue.replace(/[$,]/g, '')) || 0
    setEditState(null)
    try {
      if (field === 'payout') {
        const existing = payouts.find(p => p.member === member && p.month === month)
        const updated = await upsertPayout({ id: existing?.id, member, month, amount, note: '' })
        setPayouts(prev => existing ? prev.map(p => p.id === existing.id ? updated : p) : [...prev, updated])
      } else {
        const existing = devEarnings.find(d => d.member === member && d.month === month)
        const updated = await upsertDevEarning({ id: existing?.id, member, month, amount, note: '' })
        setDevEarnings(prev => existing ? prev.map(d => d.id === existing.id ? updated : d) : [...prev, updated])
      }
    } catch (err) {
      console.error('Failed to save', err)
    }
  }

  function startEdit(member: MemberKey, month: string, field: 'payout' | 'dev', current: number) {
    setEditState({ member, month, field })
    setEditValue(current > 0 ? String(current) : '')
  }

  async function handleAllocCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (fileRef.current) fileRef.current.value = ''
    const text = await file.text()
    const { payouts: newPayouts, devEarnings: newEarnings } = parseAllocationsCSV(text)
    if (newPayouts.length === 0 && newEarnings.length === 0) {
      setImportMsg('No data found — check CSV format.')
      return
    }
    try {
      await Promise.all([
        bulkUpsertPayouts(newPayouts),
        bulkUpsertDevEarnings(newEarnings),
      ])
      const [updatedPayouts, updatedEarnings] = await Promise.all([fetchPayouts(), fetchDevEarnings()])
      setPayouts(updatedPayouts)
      setDevEarnings(updatedEarnings)
      setImportMsg(`Imported ${newPayouts.length} payout${newPayouts.length !== 1 ? 's' : ''}, ${newEarnings.length} dev earning${newEarnings.length !== 1 ? 's' : ''}.`)
    } catch (err) {
      setImportMsg(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function toggleCollapse(key: MemberKey) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) { next.delete(key) } else { next.add(key) }
      return next
    })
  }

  return (
    <div style={{ padding: '1.5rem 0', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Import toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input ref={fileRef} type="file" accept=".csv" onChange={handleAllocCSV} style={{ display: 'none' }} />
        <button className="btn" onClick={() => { setImportMsg(''); fileRef.current?.click() }}>⬆ Import Allocations CSV</button>
        {importMsg && <span style={{ fontSize: 12, color: importMsg.startsWith('Import failed') ? 'var(--red)' : 'var(--green)' }}>{importMsg}</span>}
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {memberData.map(({ key, name, currentBalance, totalRevShare, totalPaidOut }) => (
          <div key={key} style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem', border: '0.5px solid var(--border)' }}>
            <div style={{ fontSize: 10, color: ALLOC_COLORS[key], textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4 }}>{name}</div>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 1 }}>{fmt(currentBalance)}</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>balance</div>
            <div style={{ fontSize: 10, color: 'var(--text2)' }}>{fmt(totalRevShare)} earned · {fmt(totalPaidOut)} paid</div>
          </div>
        ))}
      </div>

      {/* Per-member ledger */}
      {memberData.map(({ key, name, rows, totalRevShare, totalPaidOut, currentBalance }) => {
        const isCollapsed = collapsed.has(key)
        const totalDevEarning = rows.reduce((s, r) => s + r.devEarning, 0)
        return (
          <div key={key} style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>

            {/* Collapsible header */}
            <div onClick={() => toggleCollapse(key)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', cursor: 'pointer', userSelect: 'none',
              background: 'var(--surface2)',
              borderBottom: isCollapsed ? 'none' : '0.5px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: ALLOC_COLORS[key], textTransform: 'uppercase', letterSpacing: '0.06em' }}>{name}</span>
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>
                  {fmt(totalRevShare)} earned &nbsp;·&nbsp; {fmt(totalPaidOut)} paid
                  &nbsp;·&nbsp; <span style={{ color: currentBalance > 0 ? 'var(--amber)' : 'var(--text3)', fontWeight: 500 }}>{fmt(currentBalance)} balance</span>
                </span>
              </div>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>{isCollapsed ? '▼' : '▲'}</span>
            </div>

            {!isCollapsed && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th style={{ textAlign: 'right' }}>Rev Share</th>
                      <th style={{ textAlign: 'right' }}>Dev Earnings</th>
                      <th style={{ textAlign: 'right' }}>Pay Available</th>
                      <th style={{ textAlign: 'right' }}>Cash Paid Out</th>
                      <th style={{ textAlign: 'right' }}>Balance</th>
                      <th style={{ textAlign: 'right' }}>% Collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const isEditDev = editState?.member === key && editState?.month === r.month && editState?.field === 'dev'
                      const isEditPayout = editState?.member === key && editState?.month === r.month && editState?.field === 'payout'
                      return (
                        <tr key={r.month}>
                          <td style={{ fontWeight: 500 }}>{r.month}</td>

                          {/* Rev Share */}
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.revShare > 0 ? ALLOC_COLORS[key] : 'var(--text3)' }}>
                            {r.revShare > 0 ? fmt(r.revShare) : '—'}
                          </td>

                          {/* Dev Earnings — editable */}
                          <td style={{ textAlign: 'right' }}>
                            {isEditDev ? (
                              <input autoFocus type="number" value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={() => commitEdit(key, r.month, 'dev')}
                                onKeyDown={e => { if (e.key === 'Enter') commitEdit(key, r.month, 'dev'); if (e.key === 'Escape') setEditState(null) }}
                                className="pe-input"
                                style={{ width: 80, textAlign: 'right', fontSize: 11 }} />
                            ) : (
                              <span onClick={() => startEdit(key, r.month, 'dev', r.devEarning)}
                                title="Click to edit"
                                style={{ cursor: 'pointer', fontVariantNumeric: 'tabular-nums', borderBottom: '1px dashed var(--border2)', color: r.devEarning > 0 ? 'var(--text)' : 'var(--text3)' }}>
                                {r.devEarning > 0 ? fmt(r.devEarning) : '+ add'}
                              </span>
                            )}
                          </td>

                          {/* Pay Available */}
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.payAvailable > 0 ? 'var(--text)' : 'var(--text3)' }}>
                            {r.payAvailable > 0 ? fmt(r.payAvailable) : '—'}
                          </td>

                          {/* Cash Paid Out — editable */}
                          <td style={{ textAlign: 'right' }}>
                            {isEditPayout ? (
                              <input autoFocus type="number" value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={() => commitEdit(key, r.month, 'payout')}
                                onKeyDown={e => { if (e.key === 'Enter') commitEdit(key, r.month, 'payout'); if (e.key === 'Escape') setEditState(null) }}
                                className="pe-input"
                                style={{ width: 80, textAlign: 'right', fontSize: 11 }} />
                            ) : (
                              <span onClick={() => startEdit(key, r.month, 'payout', r.payout)}
                                title="Click to edit"
                                style={{ cursor: 'pointer', fontVariantNumeric: 'tabular-nums', borderBottom: '1px dashed var(--border2)', color: r.payout > 0 ? 'var(--red)' : 'var(--text3)' }}>
                                {r.payout > 0 ? fmt(r.payout) : '+ add'}
                              </span>
                            )}
                          </td>

                          {/* Balance */}
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: r.balance > 0 ? 'var(--amber)' : r.balance < 0 ? 'var(--red)' : 'var(--text3)' }}>
                            {r.balance !== 0 ? fmt(Math.abs(r.balance)) : '—'}
                          </td>

                          {/* % Collected */}
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text2)' }}>
                            {r.pctCollected > 0 ? r.pctCollected.toFixed(0) + '%' : '—'}
                          </td>
                        </tr>
                      )
                    })}

                    {/* Total row */}
                    {rows.length > 0 && (
                      <tr style={{ borderTop: '1px solid var(--border2)', fontWeight: 600 }}>
                        <td>Total</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: ALLOC_COLORS[key] }}>{fmt(totalRevShare)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{totalDevEarning > 0 ? fmt(totalDevEarning) : '—'}</td>
                        <td></td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{totalPaidOut > 0 ? fmt(totalPaidOut) : '—'}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: currentBalance > 0 ? 'var(--amber)' : 'var(--text3)' }}>{fmt(currentBalance)}</td>
                        <td></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
