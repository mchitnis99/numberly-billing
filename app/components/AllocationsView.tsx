'use client'

import { useState, useEffect, useMemo } from 'react'
import { Project, totalGrossReceived, fmt, ALLOC_COLORS } from '../lib/data'
import { Payout, DevEarning, fetchPayouts, fetchDevEarnings, upsertPayout, upsertDevEarning } from '../lib/payouts'

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

const JUL_2025 = 2025 * 100 + 6

type MemberKey = 'J' | 'M' | 'A' | 'G'
const MEMBERS: { key: MemberKey; name: string }[] = [
  { key: 'J', name: 'John' },
  { key: 'M', name: 'Monica' },
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

  useEffect(() => {
    fetchPayouts().then(setPayouts).catch(console.error)
    fetchDevEarnings().then(setDevEarnings).catch(console.error)
  }, [])

  // All months from Jul 2025 to current month, chronological
  const allMonths = useMemo((): string[] => {
    const now = new Date()
    const maxNum = now.getFullYear() * 100 + now.getMonth()
    const result: string[] = []
    let yr = 2025, mon = 6  // Jul 2025
    while (yr * 100 + mon <= maxNum) {
      result.push(MONTH_ORDER[mon] + ' ' + yr)
      mon++
      if (mon >= 12) { mon = 0; yr++ }
    }
    return result
  }, [])

  // Build running ledger rows for all members, starting from opening balance
  const memberData = useMemo(() => MEMBERS.map(({ key, name }) => {
    const openingBalance = payouts.find(p => p.member === key && p.month === 'Opening')?.amount || 0
    let running = openingBalance
    const rows = allMonths.map(month => {
      const ps = projects.filter(p => normalizeMonth(p.month) === month)
      const sales = ps.filter(p => p.soldBy?.toUpperCase() === key).reduce((s, p) => s + p.amount, 0)
      const revShare = ps.reduce((s, p) => s + p.amount * (p.alloc[key] || 0) / 100, 0)
      const cashEarned = ps.reduce((s, p) => s + totalGrossReceived(p) * (p.alloc[key] || 0) / 100, 0)
      const devEarning = devEarnings.find(d => d.member === key && d.month === month)?.amount || 0
      const payout = payouts.find(p => p.member === key && p.month === month)?.amount || 0
      const payAvailable = running + cashEarned + devEarning
      const balance = payAvailable - payout
      const pctCollected = revShare > 0 ? cashEarned / revShare * 100 : 0
      running = balance
      return { month, sales, revShare, cashEarned, devEarning, payout, payAvailable, balance, pctCollected }
    })
    const totalSales = rows.reduce((s, r) => s + r.sales, 0)
    const totalRevShare = rows.reduce((s, r) => s + r.revShare, 0)
    const totalCashEarned = rows.reduce((s, r) => s + r.cashEarned, 0)
    const totalPaidOut = rows.reduce((s, r) => s + r.payout, 0)
    const currentBalance = rows.length > 0 ? rows[rows.length - 1].balance : openingBalance
    return { key, name, rows, openingBalance, totalSales, totalRevShare, totalCashEarned, totalPaidOut, currentBalance }
  }), [projects, payouts, devEarnings, allMonths])

  async function commitEdit(member: MemberKey, month: string, field: 'payout' | 'dev') {
    const amount = parseFloat(editValue.replace(/[$,]/g, '')) || 0
    setEditState(null)
    try {
      if (field === 'payout') {
        const note = month === 'Opening' ? 'opening_balance' : ''
        const existing = payouts.find(p => p.member === member && p.month === month)
        const updated = await upsertPayout({ id: existing?.id, member, month, amount, note })
        setPayouts(prev => existing ? prev.map(p => p.id === existing.id ? updated : p) : [...prev, updated])
      } else {
        const existing = devEarnings.find(d => d.member === member && d.month === month)
        const updated = await upsertDevEarning({ id: existing?.id, member, month, amount, note: '' })
        setDevEarnings(prev => existing ? prev.map(d => d.id === existing.id ? updated : d) : [...prev, updated])
      }
    } catch (err) {
      console.error('Failed to save', JSON.stringify(err))
    }
  }

  function startEdit(member: MemberKey, month: string, field: 'payout' | 'dev', current: number) {
    setEditState({ member, month, field })
    setEditValue(current > 0 ? String(current) : '')
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

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {memberData.map(({ key, name, currentBalance, totalSales, totalRevShare, totalCashEarned, totalPaidOut }) => (
          <div key={key} style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem', border: '0.5px solid var(--border)' }}>
            <div style={{ fontSize: 10, color: ALLOC_COLORS[key], textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4 }}>{name}</div>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 1 }}>{fmt(currentBalance)}</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>balance</div>
            <div style={{ fontSize: 10, color: 'var(--text2)' }}>{fmt(totalSales)} sold · {fmt(totalRevShare)} booked · {fmt(totalCashEarned)} collected</div>
            <div style={{ fontSize: 10, color: 'var(--text2)' }}>{fmt(totalPaidOut)} paid out</div>
          </div>
        ))}
      </div>

      {/* Per-member ledger */}
      {memberData.map(({ key, name, rows, openingBalance, totalSales, totalRevShare, totalCashEarned, totalPaidOut, currentBalance }) => {
        const isCollapsed = collapsed.has(key)
        const totalDevEarning = rows.reduce((s, r) => s + r.devEarning, 0)
        const isEditOpening = editState?.member === key && editState?.month === 'Opening' && editState?.field === 'payout'
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
                  {fmt(totalSales)} sold &nbsp;·&nbsp; {fmt(totalRevShare)} booked &nbsp;·&nbsp; {fmt(totalCashEarned)} collected &nbsp;·&nbsp; {fmt(totalPaidOut)} paid
                  &nbsp;·&nbsp; <span style={{ color: currentBalance > 0 ? 'var(--amber)' : 'var(--text3)', fontWeight: 500 }}>{fmt(currentBalance)} balance</span>
                </span>
              </div>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>{isCollapsed ? '▼' : '▲'}</span>
            </div>

            {!isCollapsed && (
              <>
                {/* Opening Balance row */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 14px', borderBottom: '0.5px solid var(--border)',
                  background: 'var(--surface)',
                }}>
                  <span style={{ fontSize: 11, color: 'var(--text2)' }}>Opening Balance (as of Jun 30 2025):</span>
                  {isEditOpening ? (
                    <input
                      autoFocus
                      type="number"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(key, 'Opening', 'payout')}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitEdit(key, 'Opening', 'payout')
                        if (e.key === 'Escape') setEditState(null)
                      }}
                      className="pe-input"
                      style={{ width: 100, textAlign: 'right', fontSize: 12 }}
                    />
                  ) : (
                    <span
                      onClick={e => { e.stopPropagation(); startEdit(key, 'Opening', 'payout', openingBalance) }}
                      title="Click to edit"
                      style={{
                        cursor: 'pointer',
                        fontVariantNumeric: 'tabular-nums',
                        borderBottom: '1px dashed var(--border2)',
                        fontWeight: 500,
                        color: openingBalance !== 0 ? 'var(--text)' : 'var(--text3)',
                      }}
                    >
                      {openingBalance !== 0 ? fmt(openingBalance) : '+ set opening balance'}
                    </span>
                  )}
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th style={{ textAlign: 'right' }}>Sales</th>
                        <th style={{ textAlign: 'right' }}>Rev Share</th>
                        <th style={{ textAlign: 'right' }}>% Collected</th>
                        <th style={{ textAlign: 'right' }}>Cash Earned</th>
                        <th style={{ textAlign: 'right' }}>Dev Earnings</th>
                        <th style={{ textAlign: 'right' }}>Pay Available</th>
                        <th style={{ textAlign: 'right' }}>Cash Paid Out</th>
                        <th style={{ textAlign: 'right' }}>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => {
                        const isEditDev = editState?.member === key && editState?.month === r.month && editState?.field === 'dev'
                        const isEditPayout = editState?.member === key && editState?.month === r.month && editState?.field === 'payout'
                        return (
                          <tr key={r.month}>
                            <td style={{ fontWeight: 500 }}>{r.month}</td>

                            {/* Sales */}
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.sales > 0 ? 'var(--text)' : 'var(--text3)' }}>
                              {r.sales > 0 ? fmt(r.sales) : '—'}
                            </td>

                            {/* Rev Share — booked */}
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.revShare > 0 ? 'var(--text2)' : 'var(--text3)' }}>
                              {r.revShare > 0 ? fmt(r.revShare) : '—'}
                            </td>

                            {/* % Collected */}
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text2)' }}>
                              {r.pctCollected > 0 ? r.pctCollected.toFixed(0) + '%' : '—'}
                            </td>

                            {/* Cash Earned — collected */}
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.cashEarned > 0 ? ALLOC_COLORS[key] : 'var(--text3)' }}>
                              {r.cashEarned > 0 ? fmt(r.cashEarned) : '—'}
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
                          </tr>
                        )
                      })}

                      {/* Total row */}
                      {rows.length > 0 && (
                        <tr style={{ borderTop: '1px solid var(--border2)', fontWeight: 600 }}>
                          <td>Total</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{totalSales > 0 ? fmt(totalSales) : '—'}</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text2)' }}>{fmt(totalRevShare)}</td>
                          <td></td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: ALLOC_COLORS[key] }}>{fmt(totalCashEarned)}</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{totalDevEarning > 0 ? fmt(totalDevEarning) : '—'}</td>
                          <td></td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{totalPaidOut > 0 ? fmt(totalPaidOut) : '—'}</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: currentBalance > 0 ? 'var(--amber)' : 'var(--text3)' }}>{fmt(currentBalance)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
