'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Project, Invoice, Allocation, paymentStatus, totalNetReceived, remainingBalance, invoiceNet, fmt, ALLOC_COLORS, parseCSVRow,
  fetchProjects, insertProject, insertProjects, upsertProject, deleteProject as deleteProjectRow,
} from './lib/data'
import { AllocBar } from './components/AllocBar'

type SortKey = 'month' | 'client' | 'amount' | 'balance' | 'status' | 'date' | 'readyForBilling'
type View = 'all' | 'outstanding' | 'ready' | 'paid'

const emptyInv = (): Invoice => ({ num: '', date: '', amt: 0, due: '', paid: '', net: 0, uwFee: 0, stripeFee: 0 })
const emptyAlloc = (): Allocation => ({ J: 0, M: 0, N: 0, A: 0, G: 0, S: 0 })

function emptyProject(id: number): Project {
  return {
    id, newrep: 'New', month: '', channel: 'UW', delivery: 'FM', startup: '',
    modelDesc: '', soldBy: 'M', alloc: emptyAlloc(), description: '', upworkName: '', country: 'US',
    contact: '', email: '', date: '', amount: 0, billingThru: 'UW', invoicingValue: '',
    billingDetails: '',
    readyForBilling: false, notes: '', invoices: [emptyInv()]
  }
}

type EditCell = { id: number; field: string } | null

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [view, setView] = useState<View>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [editCell, setEditCell] = useState<EditCell>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [showAddRow, setShowAddRow] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchProjects()
      .then(data => { if (!cancelled) setProjects(data) })
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
        return { ...p, invoices: invs }
      }
      return { ...p, [field]: field === "amount" ? +(value as string) || 0 : value }
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
      setTimeout(() => setSaveStatus('idle'), 1500)
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
  const filtered = projects.filter(p => {
    const s = search.toLowerCase()
    const matchSearch = !s || p.startup.toLowerCase().includes(s) || p.contact.toLowerCase().includes(s) || p.month.toLowerCase().includes(s) || p.channel.toLowerCase().includes(s)
    const status = paymentStatus(p)
    const matchView = view === 'all' ? true :
      view === 'outstanding' ? remainingBalance(p) > 0 :
      view === 'ready' ? p.readyForBilling :
      view === 'paid' ? status === 'Fully paid' : true
    return matchSearch && matchView
  })

  // Sorting
  const sorted = [...filtered].sort((a, b) => {
    let av: string | number = 0, bv: string | number = 0
    if (sortKey === 'month') { av = a.month; bv = b.month }
    else if (sortKey === 'client') { av = a.startup; bv = b.startup }
    else if (sortKey === 'amount') { av = a.amount; bv = b.amount }
    else if (sortKey === 'balance') { av = remainingBalance(a); bv = remainingBalance(b) }
    else if (sortKey === 'status') { av = paymentStatus(a); bv = paymentStatus(b) }
    else if (sortKey === 'date') { av = a.date; bv = b.date }
    else if (sortKey === 'readyForBilling') { av = a.readyForBilling ? 1 : 0; bv = b.readyForBilling ? 1 : 0 }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

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
        th { background: #f0eff8; font-weight: 600; color: #4a4870; padding: 7px 10px; text-align: left; border-bottom: 1px solid rgba(83,74,183,0.15); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; cursor: pointer; user-select: none; overflow: hidden; text-overflow: ellipsis; }
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
        .pe-input { padding: 6px 8px; border: 0.5px solid var(--border2); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 12px; font-family: inherit; }
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
            {([['all','All'],['outstanding','Outstanding'],['ready','Ready to bill'],['paid','Paid']] as [View,string][]).map(([v,l]) => (
              <button key={v} className={`nav-view ${view===v?'active':''}`} onClick={() => setView(v)}>{l}{v==='ready'&&readyCount>0?` (${readyCount})`:''}</button>
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

        <div className="toolbar">
          <input type="text" placeholder="Search client, contact, month..." value={search} onChange={e => setSearch(e.target.value)} />
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{sorted.length} project{sorted.length !== 1 ? 's' : ''}</span>
          {search && <button className="btn" onClick={() => setSearch('')}>Clear</button>}
        </div>

        <div className="scroll-hint">↔ Scroll horizontally to see all columns</div>
        <div className="table-wrap">
          <table>
            <colgroup>
              <col style={{ width: 36 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 64 }} />
            </colgroup>
            <thead>
              <tr>
                <th onClick={() => toggleSort('readyForBilling')} className={sortKey==='readyForBilling'?'sorted':''}>Bill<span className="sort-arrow">{sortKey==='readyForBilling'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></th>
                <th onClick={() => toggleSort('month')} className={sortKey==='month'?'sorted':''}>Month<span className="sort-arrow">{sortKey==='month'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></th>
                <th>Delivery</th>
                <th onClick={() => toggleSort('client')} className={sortKey==='client'?'sorted':''}>Client<span className="sort-arrow">{sortKey==='client'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></th>
                <th>Sold by</th>
                <th>Contact</th>
                <th onClick={() => toggleSort('amount')} className={sortKey==='amount'?'sorted':''}>Booked<span className="sort-arrow">{sortKey==='amount'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></th>
                <th>Billing details</th>
                <th>Billing thru</th>
                <th onClick={() => toggleSort('status')} className={sortKey==='status'?'sorted':''}>Status<span className="sort-arrow">{sortKey==='status'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></th>
                <th>Net recv.</th>
                <th onClick={() => toggleSort('balance')} className={sortKey==='balance'?'sorted':''}>Balance<span className="sort-arrow">{sortKey==='balance'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={13}><div className="empty">{loading ? 'Loading projects…' : 'No projects found'}</div></td></tr>
              )}
              {sorted.map(p => {
                const status = paymentStatus(p)
                const bal = remainingBalance(p)
                const net = totalNetReceived(p)
                const rowClass = p.readyForBilling ? 'ready-row' : status === 'Fully paid' ? 'paid-row' : ''
                return (
                  <tr key={p.id} className={rowClass}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={p.readyForBilling}
                        onChange={e => updateField(p.id, 'readyForBilling', e.target.checked)}
                        style={{ cursor: 'pointer' }}
                        title="Mark as ready to bill" />
                    </td>
                    <td><InlineEdit id={p.id} field="month" value={p.month} /></td>
                    <td><InlineEdit id={p.id} field="delivery" value={p.delivery} /></td>
                    <td style={{ fontWeight: 500 }}><InlineEdit id={p.id} field="startup" value={p.startup} /></td>
                    <td><InlineEdit id={p.id} field="soldBy" value={p.soldBy} /></td>
                    <td><InlineEdit id={p.id} field="contact" value={p.contact} /></td>
                    <td className="amt"><InlineEdit id={p.id} field="amount" value={p.amount} type="number" /></td>
                    <td><InlineEdit id={p.id} field="billingDetails" value={p.billingDetails} /></td>
                    <td><InlineEdit id={p.id} field="billingThru" value={p.billingThru} options={['UW','Stripe','Bank Transfer','Open Link']} /></td>
                    <td>
                      <span className={`badge badge-${status === 'Fully paid' ? 'paid' : status === 'Partial' ? 'partial' : 'unpaid'}`}>{status}</span>
                      {p.readyForBilling && <span className="badge badge-ready" style={{ marginLeft: 4 }}>Ready</span>}
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
                    return <span className={`badge badge-${status === 'Fully paid' ? 'paid' : status === 'Partial' ? 'partial' : 'unpaid'}`}>{status}</span>
                  })()}
                </div>
              </div>
            </div>

            <div className="section-label">Project details</div>
            <div className="panel-edit">
              {([
                ['Client / startup', 'startup', 'text'],
                ['Month', 'month', 'text'],
                ['New / Repeat', 'newrep', 'select', ['New','Repeat']],
                ['Channel', 'channel', 'select', ['UW','Repeat','Referral','Website']],
                ['Delivery type', 'delivery', 'text'],
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
                <div className="pe-label">Billing details</div>
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
                  Mark as ready to bill (work done, invoice not sent yet)
                </label>
              </div>
            </div>

            <div className="section-label">Revenue allocation</div>
            <div className="alloc-row">
              {(['J','M','N','A','G','S'] as (keyof Allocation)[]).map(k => (
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
              const hasData = inv && (inv.num || inv.amt > 0)
              if (!hasData && i > 0 && !detail.invoices[i - 1]) return null
              const net = inv ? invoiceNet(inv) : 0
              return (
                <div className="inv-card" key={i}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 8 }}>
                    Invoice {i + 1} {inv?.num ? `— #${inv.num}` : ''}
                  </div>
                  <div className="inv-grid">
                    {([
                      ['Invoice #','num','text'],['Date','date','text'],['Amount','amt','number'],
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
                  {inv && (
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}>
                      Status: <span className={inv.paid ? 'paid-yes' : 'paid-no'}>{inv.paid ? 'Paid ' + inv.paid : 'Unpaid'}</span>
                    </div>
                  )}
                </div>
              )
            })}

            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '0.5px solid var(--border)', display: 'flex', gap: 8 }}>
              <button className="btn btn-danger" onClick={() => { if (confirm('Delete this project?')) deleteProject(detail.id) }}>Delete project</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
