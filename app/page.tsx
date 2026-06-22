'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Project, Invoice, Allocation, paymentStatus, pipelineStatus, totalNetReceived, remainingBalance, invoiceNet, fmt, ALLOC_COLORS, parseCSVRow,
  fetchProjects, insertProject, insertProjects, upsertProject, deleteProject as deleteProjectRow,
} from './lib/data'
import { AllocBar } from './components/AllocBar'
import { ChartsView } from './components/ChartsView'
import { AllocationsView } from './components/AllocationsView'

type SortKey = 'month' | 'client' | 'amount' | 'balance' | 'status' | 'date' | 'readyForBilling'
type View = 'active' | 'outstanding' | 'ready' | 'invoiced' | 'paid' | 'bad-debt' | 'charts' | 'allocations'

const MONTH_ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_OPTIONS: string[] = []
for (let yr = 2025; yr <= 2027; yr++) {
  for (let mo = 0; mo < 12; mo++) {
    const d = new Date(yr, mo, 1)
    MONTH_OPTIONS.push(d.toLocaleString('en-US', { month: 'short' }) + ' ' + yr)
  }
}
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

const emptyInv = (): Invoice => ({ num: '', date: '', amt: 0, due: '', paid: '', net: 0, uwFee: 0, stripeFee: 0, isPaid: false, invoiceDetails: '', stripeInvoiceId: '', stripeInvoiceUrl: '' })
const emptyAlloc = (): Allocation => ({ J: 0, M: 0, N: 0, A: 0, G: 0, S: 0 })

function emptyProject(id: number): Project {
  return {
    id, newrep: 'New', month: '', channel: 'UW', delivery: 'FM', startup: '',
    modelDesc: '', soldBy: 'M', alloc: emptyAlloc(), description: '', upworkName: '', country: 'US',
    contact: '', email: '', date: '', amount: 0, billingThru: 'UW', invoicingValue: '',
    billingDetails: '',
    readyForBilling: false, badDebt: false, done: false, importedBalance: 0, importedData: false, notes: '', invoices: [emptyInv()],
    stripeInvoiceId: '', stripeInvoiceUrl: '', invoicedAt: '',
  }
}

type EditCell = { id: number; field: string } | null

function AuthGate({ onAuth }: { onAuth: () => void }) {
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState(false)

  function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    const expected = process.env.NEXT_PUBLIC_APP_PASSWORD
    if (pwInput === expected) {
      sessionStorage.setItem('nb_auth', 'true')
      onAuth()
    } else {
      setPwError(true)
      setPwInput('')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#1a2744', border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '2.5rem 2rem', width: 320, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1D9E75', letterSpacing: '-0.01em', marginBottom: 4 }}>Numberly Billing</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Enter password to continue</div>
        </div>
        <form onSubmit={submitPassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <input
            autoFocus
            type="password"
            value={pwInput}
            onChange={e => { setPwInput(e.target.value); setPwError(false) }}
            placeholder="Password"
            style={{
              background: 'rgba(255,255,255,0.06)', border: `1px solid ${pwError ? '#D85A30' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 6, padding: '8px 12px', color: '#f0f0ec', fontSize: 13, fontFamily: 'inherit', outline: 'none',
            }}
          />
          {pwError && <div style={{ fontSize: 11, color: '#D85A30' }}>Incorrect password</div>}
          <button type="submit" style={{
            background: '#1D9E75', border: 'none', borderRadius: 6, padding: '8px 0',
            color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>Enter</button>
        </form>
      </div>
    </div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    setAuthed(sessionStorage.getItem('nb_auth') === 'true')
  }, [])

  const [projects, setProjects] = useState<Project[]>([])
  const [view, setView] = useState<View>('active')
  const [sortKey, setSortKey] = useState<SortKey>('month')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [editCell, setEditCell] = useState<EditCell>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [showAddRow, setShowAddRow] = useState(false)
  const [stripeLoading, setStripeLoading] = useState<number | null>(null)
  const [stripeMsg, setStripeMsg] = useState<Record<number, { type: 'link' | 'error'; text: string; url?: string }>>({})
  const [statusFilter, setStatusFilter] = useState('')
  const [allocFilter, setAllocFilter] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    const VALID_MONTH = /^[A-Za-z]{3} \d{4}$/
    fetchProjects()
      .then(data => {
        if (cancelled) return
        // One-time self-healing: fix any months stored in a bad format (e.g. "1/1/25")
        const fixed = data.map(p => {
          if (VALID_MONTH.test(p.month)) return p
          const d = new Date(p.month)
          if (isNaN(d.getTime())) return p
          const month = d.toLocaleString('en-US', { month: 'short' }) + ' ' + d.getFullYear()
          const updated = { ...p, month }
          upsertProject(updated).catch(err => console.error('Month fix failed for', p.startup, err))
          return updated
        })
        setProjects(fixed)
      })
      .catch(err => console.error('Failed to load projects', err))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Updates a single project locally and persists just that row to Supabase
  const mutateProject = useCallback((id: number, updater: (p: Project) => Project) => {
    setProjects(prev => {
      const updated = prev.map(p => p.id === id ? updater(p) : p)
      const changed = updated.find(p => p.id === id)
      if (changed) upsertProject(changed).catch(err => console.error('Failed to save project', err))
      return updated
    })
  }, [])

  function updateField(id: number, field: string, value: string | number | boolean) {
    mutateProject(id, p => {
      if (field.startsWith('alloc.')) {
        const k = field.split('.')[1] as keyof Allocation
        return { ...p, alloc: { ...p.alloc, [k]: +(value as string) || 0 } }
      }
      if (field.startsWith('inv.')) {
        const [, iStr, key] = field.split('.')
        const i = parseInt(iStr)
        const invs = [...p.invoices]
        while (invs.length <= i) invs.push(emptyInv())
        const numericKeys = ['amt', 'net', 'uwFee', 'stripeFee']
        invs[i] = { ...invs[i], [key]: numericKeys.includes(key) ? +(value as string) || 0 : value }
        if (key === 'amt' || key === 'uwFee' || key === 'stripeFee') {
          invs[i].net = Math.max(0, invs[i].amt - invs[i].uwFee - invs[i].stripeFee)
        }
        // Auto-set isPaid when a payment date is entered or cleared
        if (key === 'paid') {
          invs[i].isPaid = !!(value as string)
        }
        return { ...p, invoices: invs }
      }
      if (field === 'amount') return { ...p, amount: +(value as string) || 0, importedData: false, importedBalance: 0 }
      return { ...p, [field]: value }
    })
  }

  async function addProject() {
    const now = new Date()
    const month = now.toLocaleString('en-US', { month: 'short' }) + ' ' + now.getFullYear()
    try {
      const created = await insertProject({ ...emptyProject(0), month })
      setProjects(prev => [...prev, created])
      openDetail(created.id)
      setShowAddRow(false)
    } catch (err) {
      console.error('Failed to add project', err)
    }
  }

  async function deleteProject(id: number) {
    setProjects(prev => prev.filter(p => p.id !== id))
    openDetail(null)
    try { await deleteProjectRow(id) } catch (err) { console.error('Failed to delete project', err) }
  }

  async function saveDetail(p: Project) {
    setSaveStatus('saving')
    try {
      await upsertProject(p)
      setSaveStatus('saved')
      setTimeout(() => { setSaveStatus('idle'); setDetailId(null) }, 800)
    } catch (err) {
      console.error('Failed to save project', err)
      setSaveStatus('error')
    }
  }

  function parseCSV(text: string): string[][] {
    const rows: string[][] = []
    let cur = ''
    let inQuotes = false
    let fields: string[] = []

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      const next = text[i + 1]
      if (ch === '"') {
        if (inQuotes && next === '"') { cur += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        fields.push(cur.trim())
        cur = ''
      } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (ch === '\r' && next === '\n') i++
        fields.push(cur.trim())
        cur = ''
        if (fields.some(f => f !== '')) rows.push(fields)
        fields = []
      } else {
        cur += ch
      }
    }
    if (fields.length || cur) { fields.push(cur.trim()); if (fields.some(f => f !== '')) rows.push(fields) }
    return rows
  }

  function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const text = ev.target?.result as string
      const rows = parseCSV(text)
      if (rows.length < 2) { setImportMsg('File appears empty.'); return }
      const headers = rows[0]
      let skipped = 0
      const drafts: Project[] = []
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]
        const partial = parseCSVRow(headers, row)
        if (!partial || !partial.startup) { skipped++; continue }
        drafts.push({ ...emptyProject(0), ...partial } as Project)
      }
      try {
        const created = drafts.length > 0 ? await insertProjects(drafts) : []
        setProjects(prev => [...prev, ...created])
        setImportMsg(`Imported ${created.length} rows${skipped > 0 ? `, skipped ${skipped}` : ''}.`)
      } catch (err) {
        setImportMsg(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    reader.readAsText(file)
  }

  // Filtering
  const filtered = useMemo(() => projects.filter(p => {
    const s = search.toLowerCase()
    const matchSearch = !s || p.startup.toLowerCase().includes(s) || p.contact.toLowerCase().includes(s) || p.month.toLowerCase().includes(s) || p.channel.toLowerCase().includes(s) || p.description.toLowerCase().includes(s)
    const status = paymentStatus(p)
    const ps = pipelineStatus(p)
    const matchView = view === 'active' ? ps !== 'Fully Paid' && !p.badDebt && !p.done :
      view === 'outstanding' ? (remainingBalance(p) > 0 && !p.badDebt) :
      view === 'ready' ? p.readyForBilling :
      view === 'invoiced' ? (!!(p.invoicedAt && p.invoicedAt.length > 0) && ps !== 'Fully Paid') :
      view === 'paid' ? ps === 'Fully Paid' :
      view === 'bad-debt' ? p.badDebt : true
    const matchStatus = !statusFilter || ps === statusFilter
    const matchAlloc = allocFilter.size === 0 || [...allocFilter].some(k => (p.alloc[k as keyof Allocation] ?? 0) > 0)
    return matchSearch && matchView && matchStatus && matchAlloc
  }), [projects, view, search, statusFilter, allocFilter])

  // Sorting
  const sorted = useMemo(() => {
    const result = [...filtered].sort((a, b) => {
      let av: string | number = 0, bv: string | number = 0
      if (sortKey === 'month') { av = monthToNum(a.month); bv = monthToNum(b.month) }
      else if (sortKey === 'client') { av = a.startup; bv = b.startup }
      else if (sortKey === 'amount') { av = a.amount; bv = b.amount }
      else if (sortKey === 'balance') { av = remainingBalance(a); bv = remainingBalance(b) }
      else if (sortKey === 'status') { av = paymentStatus(a); bv = paymentStatus(b) }
      else if (sortKey === 'date') { av = a.date; bv = b.date }
      else if (sortKey === 'readyForBilling') { av = a.readyForBilling ? 1 : 0; bv = b.readyForBilling ? 1 : 0 }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      // Tiebreaker: month desc, then date desc
      const mDiff = monthToNum(b.month) - monthToNum(a.month)
      if (mDiff !== 0) return mDiff
      if (b.date > a.date) return 1
      if (b.date < a.date) return -1
      return 0
    })
    return result
  }, [filtered, sortKey, sortDir])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('desc') }
  }

  function openDetail(id: number | null) {
    setDetailId(id)
    setSaveStatus('idle')
  }

  const detail = projects.find(p => p.id === detailId)

  // Metrics
  const totalBooked = projects.reduce((s, p) => s + p.amount, 0)
  const totalCollected = projects.reduce((s, p) => s + totalNetReceived(p), 0)
  const totalOutstanding = projects.reduce((s, p) => s + remainingBalance(p), 0)
  const readyCount = projects.filter(p => p.readyForBilling).length
  const invoicedCount = projects.filter(p => !!(p.invoicedAt && p.invoicedAt.length > 0) && paymentStatus(p) !== 'Fully paid').length

  function InlineEdit({ id, field, value, type = 'text', options }: {
    id: number; field: string; value: string | number | boolean; type?: string; options?: string[]
  }) {
    const isEditing = editCell?.id === id && editCell?.field === field
    const [local, setLocal] = useState(String(value))

    useEffect(() => { setLocal(String(value)) }, [value])

    function commit() {
      const val = type === 'number' ? parseFloat(local) || 0 : local
      updateField(id, field, val)
      setEditCell(null)
    }

    if (type === 'checkbox') {
      return (
        <input type="checkbox" checked={!!value}
          onChange={e => updateField(id, field, e.target.checked)}
          style={{ width: 14, height: 14, cursor: 'pointer' }} />
      )
    }

    if (!isEditing) {
      return (
        <span className="cell-value" onClick={() => { setEditCell({ id, field }); setLocal(String(value)) }}
          title="Click to edit">
          {type === 'number' && typeof value === 'number' && field !== 'alloc.J' && field !== 'alloc.M' && field !== 'alloc.N' && field !== 'alloc.A' && field !== 'alloc.G' && field !== 'alloc.S'
            ? (value > 0 ? fmt(value) : <span style={{ color: 'var(--text3)' }}>—</span>)
            : value || <span style={{ color: 'var(--text3)' }}>—</span>}
        </span>
      )
    }

    if (options) {
      return (
        <select autoFocus value={local} onChange={e => { setLocal(e.target.value); updateField(id, field, e.target.value); setEditCell(null) }}
          onBlur={() => setEditCell(null)} className="cell-input">
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }

    return (
      <input autoFocus type={type} value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditCell(null) }}
        className="cell-input" style={{ width: type === 'number' ? 80 : 120 }} />
    )
  }

  if (authed === null) return null
  if (!authed) return <AuthGate onAuth={() => setAuthed(true)} />

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); font-size: 13px; }
        .nav { background: #1a2744; border-bottom: none; position: sticky; top: 0; z-index: 20; }
        .nav-inner { max-width: 1400px; margin: 0 auto; padding: 0 1.25rem; display: flex; align-items: center; gap: 1.5rem; height: 48px; }
        .nav-brand { font-size: 14px; font-weight: 700; color: #1D9E75; letter-spacing: -0.01em; }
        .nav-views { display: flex; gap: 2px; }
        .nav-view { padding: 4px 12px; border-radius: var(--radius); font-size: 12px; border: none; background: transparent; color: rgba(255,255,255,0.55); cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .nav-view:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.9); }
        .nav-view.active { background: rgba(29,158,117,0.2); color: #fff; font-weight: 500; box-shadow: inset 0 -2px 0 #1D9E75; }
        .nav-actions { margin-left: auto; display: flex; gap: 8px; align-items: center; }
        .wrap { max-width: 1400px; margin: 0 auto; padding: 0 1.25rem 3rem; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px,1fr)); gap: 8px; margin: 1rem 0; }
        .metric { background: var(--surface2); border-radius: var(--radius); padding: 0.75rem 1rem; border: 0.5px solid var(--border); }
        .metric-label { font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px; }
        .metric-value { font-size: 18px; font-weight: 600; color: var(--text); }
        .metric-value.green { color: var(--green); }
        .metric-value.amber { color: var(--amber); }
        .metric-value.red { color: var(--red); }
        .metric-value.blue { color: #378ADD; }
        .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; }
        .toolbar input[type="text"] { padding: 5px 10px; border: 0.5px solid var(--border2); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 12px; font-family: inherit; width: 200px; }
        .btn { padding: 5px 11px; font-size: 12px; border: 0.5px solid var(--border2); border-radius: var(--radius); background: var(--surface); color: var(--text); cursor: pointer; font-family: inherit; transition: all 0.1s; white-space: nowrap; }
        .btn:hover { background: var(--surface2); }
        .btn-primary { background: #1D9E75; color: #fff; border-color: #1D9E75; font-weight: 500; }
        .btn-primary:hover { background: #178a64; border-color: #178a64; }
        .btn-danger { color: var(--red); }
        .btn-danger:hover { background: var(--red-bg); }
        .btn-ready { background: var(--amber-bg); color: var(--amber-text); border-color: transparent; }
        .table-wrap { border: 0.5px solid var(--border); border-radius: var(--radius-lg); overflow: auto; max-height: calc(100vh - 260px); }
        .table-wrap::-webkit-scrollbar { height: 12px; }
        .table-wrap::-webkit-scrollbar-track { background: var(--surface2); }
        .table-wrap::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 6px; }
        .table-wrap::-webkit-scrollbar-thumb:hover { background: var(--text3); }
        .scroll-hint { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text3); margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1250px; table-layout: fixed; }
        thead { position: sticky; top: 0; z-index: 5; }
        th { background: #f0eff8; font-weight: 600; color: #4a4870; padding: 7px 10px; text-align: left; border-bottom: 1px solid rgba(83,74,183,0.15); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; white-space: normal; word-break: break-word; line-height: 1.2; cursor: pointer; user-select: none; vertical-align: bottom; }
        @media (prefers-color-scheme: dark) { th { background: #1e1e2e; color: #a0a0c0; border-bottom-color: rgba(160,160,192,0.15); } }
        th:hover { color: #534AB7; }
        th.sorted { color: #534AB7; }
        td { padding: 6px 10px; border-bottom: 0.5px solid var(--border); color: var(--text); vertical-align: middle; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: var(--surface2); }
        tr.ready-row td { background: rgba(186,117,23,0.04); }
        tr.ready-row td:first-child { border-left: 3px solid var(--amber); }
        tr.paid-row td:first-child { border-left: 3px solid var(--green); }
        .cell-value { cursor: pointer; display: inline-block; min-width: 20px; padding: 1px 3px; border-radius: 3px; transition: background 0.1s; }
        .cell-value:hover { background: var(--border); }
        .cell-input { padding: 2px 6px; border: 1px solid var(--text); border-radius: 4px; background: var(--surface); color: var(--text); font-size: 12px; font-family: inherit; outline: none; }
        .amt { font-variant-numeric: tabular-nums; }
        .badge { display: inline-block; padding: 1px 7px; border-radius: 100px; font-size: 10px; font-weight: 500; white-space: nowrap; }
        .badge-paid { background: var(--green-bg); color: var(--green-text); }
        .badge-partial { background: var(--amber-bg); color: var(--amber-text); }
        .badge-unpaid { background: var(--red-bg); color: var(--red-text); }
        .badge-uw { background: var(--blue-bg); color: var(--blue-text); }
        .badge-direct { background: var(--purple-bg); color: var(--purple-text); }
        .badge-new { background: var(--green-bg); color: var(--green-text); }
        .badge-repeat { background: var(--amber-bg); color: var(--amber-text); }
        .badge-ready { background: var(--amber-bg); color: var(--amber-text); }
        .badge-baddebt { background: #2d1212; color: #e07070; font-weight: 600; }
        .badge-invoiced { background: var(--blue-bg); color: var(--blue-text); }
        .badge-notbilled { background: var(--surface2); color: var(--text3); }
        .badge-pipeline-invoiced { background: var(--blue-bg); color: var(--blue-text); }
        .badge-pipeline-ready { background: var(--amber-bg); color: var(--amber-text); }
        @media (prefers-color-scheme: light) { .badge-baddebt { background: #fce8e8; color: #8b1a1a; } }
        tr.baddebt-row td:first-child { border-left: 3px solid var(--red); }
        .sort-arrow { margin-left: 3px; opacity: 0.5; }
        .panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 30; display: flex; justify-content: flex-end; }
        .panel { background: var(--surface); width: min(560px, 100vw); height: 100vh; overflow-y: auto; border-left: 0.5px solid var(--border); padding: 1.5rem; }
        .panel-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.25rem; }
        .panel-name { font-size: 18px; font-weight: 500; }
        .panel-sub { font-size: 12px; color: var(--text2); margin-top: 2px; }
        .panel-metrics { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; margin-bottom: 1rem; }
        .section-label { font-size: 10px; font-weight: 500; color: var(--text2); text-transform: uppercase; letter-spacing: 0.07em; margin: 1rem 0 0.5rem; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; font-size: 12px; }
        .detail-item { display: flex; flex-direction: column; gap: 2px; }
        .detail-key { font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.05em; }
        .detail-val { color: var(--text); }
        .alloc-row { display: grid; grid-template-columns: repeat(6,1fr); gap: 6px; }
        .alloc-cell { display: flex; flex-direction: column; gap: 2px; align-items: center; }
        .alloc-key { font-size: 10px; font-weight: 600; }
        .alloc-num { font-size: 12px; }
        .inv-card { border: 0.5px solid var(--border); border-radius: var(--radius); padding: 10px; margin-bottom: 8px; }
        .inv-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; font-size: 12px; }
        .inv-cell { display: flex; flex-direction: column; gap: 2px; }
        .inv-key { font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.04em; }
        .panel-edit { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .pe-group { display: flex; flex-direction: column; gap: 3px; }
        .pe-group.full { grid-column: 1 / -1; }
        .pe-label { font-size: 10px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; }
        .pe-input { padding: 6px 8px; border: 0.5px solid var(--border2); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 12px; font-family: inherit; box-sizing: border-box; }
        .pe-input:focus { outline: none; border-color: #1D9E75; }
        .import-panel { background: var(--surface); border: 0.5px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1rem; }
        .import-steps { font-size: 12px; color: var(--text2); line-height: 1.8; margin-bottom: 1rem; }
        .empty { text-align: center; padding: 3rem; color: var(--text3); font-size: 12px; }
        .paid-yes { color: var(--green); font-weight: 500; }
        .paid-no { color: var(--red); }
        @media (max-width: 768px) { table { min-width: 900px; } .panel { width: 100vw; } }
      `}</style>

      <nav className="nav">
        <div className="nav-inner">
          <span className="nav-brand">Numberly Billing</span>
          <div className="nav-views">
            {([['charts','Charts'],['active','Active'],['ready','Ready to bill'],['outstanding','Outstanding'],['invoiced','Invoiced'],['paid','Paid'],['bad-debt','Bad Debt'],['allocations','Allocations']] as [View,string][]).map(([v,l]) => (
              <button key={v} className={`nav-view ${view===v?'active':''}`} onClick={() => setView(v)}>{l}{v==='ready'&&readyCount>0?` (${readyCount})`:''}{v==='invoiced'&&invoicedCount>0?` (${invoicedCount})`:''}</button>
            ))}
          </div>
          <div className="nav-actions">
            <button className="btn" onClick={() => setShowImport(s => !s)}>⬆ Import CSV</button>
            <button className="btn btn-primary" onClick={addProject}>+ Add project</button>
          </div>
        </div>
      </nav>

      <div className="wrap">
        <div className="metrics">
          <div className="metric"><div className="metric-label">Total booked</div><div className="metric-value">{fmt(totalBooked)}</div></div>
          <div className="metric"><div className="metric-label">Collected (net)</div><div className="metric-value green">{fmt(totalCollected)}</div></div>
          <div className="metric"><div className="metric-label">Outstanding</div><div className="metric-value amber">{fmt(totalOutstanding)}</div></div>
          <div className="metric"><div className="metric-label">Ready to bill</div><div className="metric-value amber">{readyCount}</div></div>
          <div className="metric"><div className="metric-label">Projects</div><div className="metric-value">{projects.length}</div></div>
        </div>

        {showImport && (
          <div className="import-panel">
            <div style={{ fontWeight: 500, marginBottom: 8 }}>Import from Google Sheets CSV</div>
            <div className="import-steps">
              1. In Google Sheets: File → Download → Comma Separated Values (.csv)<br/>
              2. Upload that file here — columns are matched automatically
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} style={{ fontSize: 12 }} />
              <button className="btn" onClick={() => { setShowImport(false); setImportMsg('') }}>Close</button>
            </div>
            {importMsg && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--green)' }}>{importMsg}</div>}
          </div>
        )}

        {view !== 'charts' && view !== 'allocations' && (
        <div className="toolbar">
          <input type="text" placeholder="Search client, contact, month, description..." value={search} onChange={e => setSearch(e.target.value)} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '5px 8px', border: '0.5px solid var(--border2)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: statusFilter ? 'var(--text)' : 'var(--text3)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>
            <option value=''>All statuses</option>
            <option>Not Yet Billed</option>
            <option>Ready for Billing</option>
            <option>Invoiced 1</option>
            <option>Invoiced 2</option>
            <option>Invoiced 3</option>
            <option>Partially Paid</option>
            <option>Fully Paid</option>
            <option>Bad Debt</option>
          </select>
          {([['J','#534AB7'],['M','#1D9E75'],['G','#378ADD']] as [string,string][]).map(([k,color]) => (
            <button key={k} onClick={() => setAllocFilter(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })}
              style={{ padding: '3px 10px', borderRadius: 'var(--radius)', border: `1px solid ${color}`, background: allocFilter.has(k) ? color : 'transparent', color: allocFilter.has(k) ? '#fff' : color, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}>
              {k}
            </button>
          ))}
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{sorted.length} project{sorted.length !== 1 ? 's' : ''}</span>
          {(search || statusFilter || allocFilter.size > 0) && <button className="btn" onClick={() => { setSearch(''); setStatusFilter(''); setAllocFilter(new Set()) }}>Clear</button>}
        </div>
        )}

        {view === 'charts' ? <ChartsView projects={projects} /> :
         view === 'allocations' ? <AllocationsView projects={projects} /> : (<>
        <div className="scroll-hint">↔ Scroll horizontally to see all columns</div>
        <div className="table-wrap">
          <table>
            <colgroup>
              <col style={{ width: 56 }} />
              <col style={{ width: 56 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 70 }} />
            </colgroup>
            <thead>
              <tr>
                <th onClick={() => toggleSort('readyForBilling')} className={sortKey==='readyForBilling'?'sorted':''} title="Ready to bill">Bill?<span className="sort-arrow">{sortKey==='readyForBilling'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></th>
                <th title="Mark as done">Done?</th>
                <th onClick={() => toggleSort('month')} className={sortKey==='month'?'sorted':''}>Month<span className="sort-arrow">{sortKey==='month'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></th>
                <th>Delivery</th>
                <th onClick={() => toggleSort('client')} className={sortKey==='client'?'sorted':''}>Client<span className="sort-arrow">{sortKey==='client'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></th>
                <th>Description</th>
                <th>Sold by</th>
                <th>Contact</th>
                <th onClick={() => toggleSort('amount')} className={sortKey==='amount'?'sorted':''}>Booked<span className="sort-arrow">{sortKey==='amount'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></th>
                <th>Billing thru</th>
                <th onClick={() => toggleSort('status')} className={sortKey==='status'?'sorted':''}>Status<span className="sort-arrow">{sortKey==='status'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></th>
                <th>Net recv.</th>
                <th onClick={() => toggleSort('balance')} className={sortKey==='balance'?'sorted':''}>Balance<span className="sort-arrow">{sortKey==='balance'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={14}><div className="empty">{loading ? 'Loading projects…' : 'No projects found'}</div></td></tr>
              )}
              {sorted.map(p => {
                const ps = pipelineStatus(p)
                const bal = remainingBalance(p)
                const net = totalNetReceived(p)
                const badgeClass = ps === 'Fully Paid' ? 'paid' : ps === 'Partially Paid' ? 'partial' : ps === 'Bad Debt' ? 'baddebt' : ps === 'Not Yet Billed' ? 'notbilled' : ps.startsWith('Invoiced') ? 'pipeline-invoiced' : ps === 'Ready for Billing' ? 'pipeline-ready' : 'notbilled'
                const rowClass = p.badDebt ? 'baddebt-row' : ps === 'Fully Paid' ? 'paid-row' : p.readyForBilling ? 'ready-row' : ''
                return (
                  <tr key={p.id} className={rowClass}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={p.readyForBilling}
                        onChange={e => updateField(p.id, 'readyForBilling', e.target.checked)}
                        style={{ cursor: 'pointer' }}
                        title="Mark as ready to bill" />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={p.done}
                        onChange={e => updateField(p.id, 'done', e.target.checked)}
                        style={{ cursor: 'pointer' }}
                        title="Mark as done" />
                    </td>
                    <td><InlineEdit id={p.id} field="month" value={p.month.replace(/,/g, '').trim()} options={MONTH_OPTIONS} /></td>
                    <td><InlineEdit id={p.id} field="delivery" value={p.delivery} options={['FM','FM Update','PD','BP','Advisory','Bookkeeping']} /></td>
                    <td style={{ fontWeight: 500 }}><InlineEdit id={p.id} field="startup" value={p.startup} /></td>
                    <td style={{ color: 'var(--text2)', fontStyle: p.description ? 'normal' : 'italic' }}><InlineEdit id={p.id} field="description" value={p.description} /></td>
                    <td><InlineEdit id={p.id} field="soldBy" value={p.soldBy} /></td>
                    <td><InlineEdit id={p.id} field="contact" value={p.contact} /></td>
                    <td className="amt"><InlineEdit id={p.id} field="amount" value={p.amount} type="number" /></td>
                    <td><InlineEdit id={p.id} field="billingThru" value={p.billingThru} options={['UW','Stripe','Bank Transfer','Open Link']} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className={`badge badge-${badgeClass}`}>{ps}</span>
                      </div>
                    </td>
                    <td className="amt" style={{ color: 'var(--green)' }}>{fmt(net)}</td>
                    <td className="amt" style={{ color: bal > 0 ? 'var(--amber)' : 'var(--text3)', fontWeight: bal > 0 ? 500 : 400 }}>{fmt(bal)}</td>
                    <td><button className="btn" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => openDetail(p.id)}>Detail</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {view === 'invoiced' && (
          <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>Projects move to Paid once payment is received.</p>
        )}
        </>)}
      </div>

      {/* DETAIL PANEL */}
      {detail && (
        <div className="panel-overlay" onClick={() => openDetail(null)}>
          <div className="panel" onClick={e => e.stopPropagation()}>
            <div className="panel-header">
              <div>
                <div className="panel-name">{detail.startup || 'New project'}</div>
                <div className="panel-sub">{[detail.contact, detail.country, detail.email].filter(Boolean).join(' · ')}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-primary" onClick={() => saveDetail(detail)}>
                  {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Retry save' : 'Save'}
                </button>
                <button className="btn" onClick={() => openDetail(null)}>✕</button>
              </div>
            </div>

            <div className="panel-metrics">
              <div className="metric"><div className="metric-label">Booked</div><div className="metric-value" style={{ fontSize: 15 }}>{fmt(detail.amount)}</div></div>
              <div className="metric"><div className="metric-label">Net received</div><div className="metric-value green" style={{ fontSize: 15 }}>{fmt(totalNetReceived(detail))}</div></div>
              <div className="metric"><div className="metric-label">Balance</div><div className={`metric-value ${remainingBalance(detail) > 0 ? 'amber' : ''}`} style={{ fontSize: 15 }}>{fmt(remainingBalance(detail))}</div></div>
              <div className="metric">
                <div className="metric-label">Status</div>
                <div className="metric-value" style={{ fontSize: 15 }}>
                  {(() => {
                    const status = paymentStatus(detail)
                    return <span className={`badge badge-${status === 'Fully paid' ? 'paid' : status === 'Partial' ? 'partial' : status === 'Bad Debt' ? 'baddebt' : 'unpaid'}`}>{status}</span>
                  })()}
                </div>
              </div>
            </div>

            <div className="section-label">Project details</div>
            <div className="panel-edit">
              {([
                ['Client', 'startup', 'text'],
                ['Month', 'month', 'select', MONTH_OPTIONS],
                ['New / Repeat', 'newrep', 'select', ['New','Repeat']],
                ['Channel', 'channel', 'select', ['UW','Repeat','Referral','Website']],
                ['Delivery type', 'delivery', 'select', ['FM','FM Update','PD','BP','Advisory','Bookkeeping']],
                ['Sold by', 'soldBy', 'text'],
                ['Contact', 'contact', 'text'],
                ['Email', 'email', 'text'],
                ['Country', 'country', 'text'],
                ['Contract date', 'date', 'text'],
                ['Booked amount', 'amount', 'number'],
                ['Billing thru', 'billingThru', 'select', ['UW','Stripe','Bank Transfer','Open Link']],
                ['Upwork name', 'upworkName', 'text'],
              ] as [string, string, string, string[]?][]).map(([label, field, type, opts]) => (
                <div className="pe-group" key={field}>
                  <div className="pe-label">{label}</div>
                  {opts ? (
                    <select className="pe-input" value={String((detail as Record<string,unknown>)[field] || '')}
                      onChange={e => updateField(detail.id, field, e.target.value)}>
                      {opts.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input className="pe-input" type={type} value={String((detail as Record<string,unknown>)[field] || '')}
                      onChange={e => updateField(detail.id, field, type === 'number' ? e.target.value : e.target.value)} />
                  )}
                </div>
              ))}
              <div className="pe-group full">
                <div className="pe-label">Internal Billing Notes</div>
                <textarea className="pe-input" rows={2} value={detail.billingDetails}
                  onChange={e => updateField(detail.id, 'billingDetails', e.target.value)}
                  placeholder="e.g. Bill $500 now, hold rest" />
              </div>
              <div className="pe-group full">
                <div className="pe-label">Project description</div>
                <textarea className="pe-input" rows={2} value={detail.description}
                  onChange={e => updateField(detail.id, 'description', e.target.value)} />
              </div>
              <div className="pe-group full" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={detail.readyForBilling}
                  onChange={e => updateField(detail.id, 'readyForBilling', e.target.checked)}
                  id={`rfb-${detail.id}`} />
                <label htmlFor={`rfb-${detail.id}`} style={{ fontSize: 12, color: 'var(--text)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                  Mark Ready to Bill
                </label>
              </div>
              {detail.invoicedAt && detail.invoicedAt.length > 0 && (
                <div className="pe-group full" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--blue-text)' }}>Invoiced {detail.invoicedAt}</span>
                  <button
                    className="btn"
                    style={{ fontSize: 11, padding: '2px 8px', color: 'var(--text3)' }}
                    onClick={() => updateField(detail.id, 'invoicedAt', '')}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            <div className="section-label">Revenue allocation</div>
            <div className="alloc-row">
              {(['J','M','N','A','G'] as (keyof Allocation)[]).map(k => (
                <div className="alloc-cell" key={k}>
                  <div className="alloc-key" style={{ color: ALLOC_COLORS[k] }}>{k}%</div>
                  <input className="pe-input" type="number" min="0" max="100"
                    value={detail.alloc[k] || ''}
                    onChange={e => updateField(detail.id, `alloc.${k}`, e.target.value)}
                    style={{ width: '100%', textAlign: 'center' }} />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}><AllocBar alloc={detail.alloc} /></div>

            <div className="section-label">Invoices</div>
            {[0, 1, 2].map(i => {
              const inv = detail.invoices[i]
              const net = inv ? invoiceNet(inv) : 0
              const showStripeBtn = detail.billingThru?.toLowerCase().includes('stripe') && (inv?.amt ?? 0) > 0
              return (
                <div className="inv-card" key={i}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 8 }}>
                    Invoice {i + 1} {inv?.num ? `— #${inv.num}` : ''}
                  </div>
                  <div className="inv-grid">
                    {([
                      ['Invoice #','num','text'],['Date','date','text'],['Amount','amt','number'],
                    ] as [string,string,string][]).map(([label, key, type]) => (
                      <div className="inv-cell" key={key}>
                        <div className="inv-key">{label}</div>
                        <input className="pe-input" type={type}
                          value={String(inv?.[key as keyof Invoice] || '')}
                          onChange={e => updateField(detail.id, `inv.${i}.${key}`, e.target.value)}
                          style={{ fontSize: 11 }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <div className="inv-key" style={{ marginBottom: 3 }}>Invoice details</div>
                    <textarea className="pe-input" rows={2}
                      value={inv?.invoiceDetails || ''}
                      onChange={e => updateField(detail.id, `inv.${i}.invoiceDetails`, e.target.value)}
                      placeholder="Line item description for this invoice"
                      style={{ fontSize: 11, width: '100%', resize: 'vertical' }} />
                  </div>
                  <div className="inv-grid" style={{ marginTop: 6 }}>
                    {([
                      ['Due date','due','text'],['Date paid','paid','text'],
                      ['UW fee','uwFee','number'],['Stripe fee','stripeFee','number'],
                    ] as [string,string,string][]).map(([label, key, type]) => (
                      <div className="inv-cell" key={key}>
                        <div className="inv-key">{label}</div>
                        <input className="pe-input" type={type}
                          value={String(inv?.[key as keyof Invoice] || '')}
                          onChange={e => updateField(detail.id, `inv.${i}.${key}`, e.target.value)}
                          style={{ fontSize: 11 }} />
                      </div>
                    ))}
                    <div className="inv-cell">
                      <div className="inv-key">Net received</div>
                      <div className="pe-input" style={{ fontSize: 11, color: 'var(--green)' }}>{fmt(net)}</div>
                    </div>
                  </div>
                  {inv && (() => {
                    const paidLabel = inv.paid && inv.paid !== 'imported' ? `Paid ${inv.paid}` : 'Paid'
                    return (
                      <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}>
                        Status: <span className={inv.isPaid ? 'paid-yes' : 'paid-no'}>{inv.isPaid ? paidLabel : 'Unpaid'}</span>
                      </div>
                    )
                  })()}
                  {showStripeBtn && (
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {inv?.stripeInvoiceId ? (
                        <a href={inv.stripeInvoiceUrl || `https://dashboard.stripe.com/invoices/${inv.stripeInvoiceId}`}
                          target="_blank" rel="noreferrer"
                          style={{ fontSize: 11, color: 'var(--green)', textDecoration: 'none', fontWeight: 500 }}>
                          View in Stripe →
                        </a>
                      ) : (
                        <>
                          <button
                            className="btn btn-primary"
                            style={{ fontSize: 11, padding: '3px 10px' }}
                            disabled={stripeLoading === i}
                            onClick={async () => {
                              setStripeLoading(i)
                              setStripeMsg(prev => { const n = {...prev}; delete n[i]; return n })
                              try {
                                const res = await fetch('/api/create-stripe-invoice', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    clientEmail: detail.email,
                                    clientName: detail.startup,
                                    contactName: detail.contact,
                                    amount: inv!.amt,
                                    description: inv?.invoiceDetails || detail.description || `${detail.startup} - ${detail.delivery} - ${detail.month}`,
                                  }),
                                })
                                if (!res.ok) {
                                  const text = await res.text()
                                  throw new Error(text || 'Stripe invoice creation failed')
                                }
                                const data = await res.json()
                                updateField(detail.id, `inv.${i}.stripeInvoiceId`, data.invoiceId)
                                updateField(detail.id, `inv.${i}.stripeInvoiceUrl`, data.invoiceUrl)
                                const today = new Date().toISOString().slice(0, 10)
                                if (!inv?.date) updateField(detail.id, `inv.${i}.date`, today)
                                updateField(detail.id, 'invoicedAt', today)
                                setStripeMsg(prev => ({ ...prev, [i]: { type: 'link', text: 'View in Stripe →', url: data.invoiceUrl } }))
                              } catch (err) {
                                setStripeMsg(prev => ({ ...prev, [i]: { type: 'error', text: err instanceof Error ? err.message : String(err) } }))
                              } finally {
                                setStripeLoading(null)
                              }
                            }}
                          >
                            {stripeLoading === i ? 'Creating…' : 'Create Stripe Invoice'}
                          </button>
                          {stripeMsg[i]?.type === 'error' && (
                            <span style={{ fontSize: 11, color: 'var(--red)' }}>{stripeMsg[i].text}</span>
                          )}
                          {stripeMsg[i]?.type === 'link' && (
                            <a href={stripeMsg[i].url} target="_blank" rel="noreferrer"
                              style={{ fontSize: 11, color: 'var(--green)', textDecoration: 'none', fontWeight: 500 }}>
                              {stripeMsg[i].text}
                            </a>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '0.5px solid var(--border)', display: 'flex', gap: 8 }}>
              <button className="btn btn-danger" onClick={() => { if (confirm('Delete this project?')) deleteProject(detail.id) }}>Delete project</button>
              <button
                onClick={() => updateField(detail.id, 'badDebt', !detail.badDebt)}
                style={{ padding: '4px 12px', borderRadius: 'var(--radius)', border: `1px solid ${detail.badDebt ? '#888' : '#8B0000'}`, background: detail.badDebt ? 'rgba(136,136,136,0.1)' : 'rgba(139,0,0,0.15)', color: detail.badDebt ? 'var(--text2)' : '#ff6b6b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                {detail.badDebt ? 'Remove Bad Debt' : 'Mark as Bad Debt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
