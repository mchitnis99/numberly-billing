'use client'

import { useState, useEffect, useCallback } from 'react'
import { Project, Invoice, SAMPLE_PROJECTS, paymentStatus, totalNetReceived, remainingBalance, fmt, ALLOC_COLORS } from './lib/data'
import { StatusBadge, ChannelBadge, NewRepBadge } from './components/Badge'
import { AllocBar } from './components/AllocBar'

const STORAGE_KEY = 'nb_billing_v1'

function loadProjects(): Project[] {
  if (typeof window === 'undefined') return SAMPLE_PROJECTS
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : SAMPLE_PROJECTS
  } catch { return SAMPLE_PROJECTS }
}

function saveProjects(projects: Project[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)) } catch {}
}

type Page = 'dashboard' | 'projects' | 'add' | 'detail'
const emptyInv = (): Invoice => ({ num: '', date: '', amt: 0, due: '', paid: '', net: 0, fee: 0 })

export default function BillingApp() {
  const [page, setPage] = useState<Page>('dashboard')
  const [projects, setProjects] = useState<Project[]>([])
  const [detailId, setDetailId] = useState<number | null>(null)
  const [projSearch, setProjSearch] = useState('')
  const [projChannel, setProjChannel] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [formMsg, setFormMsg] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null)

  const [fClient, setFClient] = useState('')
  const [fContact, setFContact] = useState('')
  const [fEmail, setFEmail] = useState('')
  const [fCountry, setFCountry] = useState('US')
  const [fDate, setFDate] = useState('')
  const [fChannel, setFChannel] = useState('UW')
  const [fNewrep, setFNewrep] = useState('New')
  const [fAmount, setFAmount] = useState('')
  const [fType, setFType] = useState('')
  const [fComplexity, setFComplexity] = useState('Wizard+')
  const [fDesc, setFDesc] = useState('')
  const [fJ, setFJ] = useState('')
  const [fM, setFM] = useState('')
  const [fN, setFN] = useState('')
  const [fA, setFA] = useState('')
  const [fG, setFG] = useState('')
  const [fInv1, setFInv1] = useState<Invoice>(emptyInv())
  const [fInv2, setFInv2] = useState<Invoice>(emptyInv())
  const [fInv3, setFInv3] = useState<Invoice>(emptyInv())

  useEffect(() => { setProjects(loadProjects()) }, [])

  const mutate = useCallback((updated: Project[]) => {
    setProjects(updated)
    saveProjects(updated)
  }, [])

  const months = [...new Set(projects.map(p => p.month))]

  const totalBooked = projects.reduce((s, p) => s + p.amount, 0)
  const totalCollected = projects.reduce((s, p) => s + totalNetReceived(p), 0)
  const totalOutstanding = projects.reduce((s, p) => s + remainingBalance(p), 0)
  const unpaidCount = projects.filter(p => paymentStatus(p) === 'Unpaid').length

  const outstanding = projects.filter(p => remainingBalance(p) > 0)
  const recentFiltered = [...projects].reverse().filter(p =>
    (!filterMonth || p.month === filterMonth) && (!filterStatus || paymentStatus(p) === filterStatus)
  )
  const projFiltered = [...projects].reverse().filter(p => {
    const s = projSearch.toLowerCase()
    return (!s || p.client.toLowerCase().includes(s) || (p.contact || '').toLowerCase().includes(s)) &&
      (!projChannel || p.channel === projChannel)
  })

  const detail = projects.find(p => p.id === detailId) || null

  function goDetail(id: number) { setDetailId(id); setPage('detail') }

  function deleteProject(id: number) {
    mutate(projects.filter(p => p.id !== id))
    setShowDeleteConfirm(null)
    setPage('projects')
  }

  function resetForm() {
    setFClient(''); setFContact(''); setFEmail(''); setFCountry('US'); setFDate('')
    setFChannel('UW'); setFNewrep('New'); setFAmount(''); setFType(''); setFComplexity('Wizard+'); setFDesc('')
    setFJ(''); setFM(''); setFN(''); setFA(''); setFG('')
    setFInv1(emptyInv()); setFInv2(emptyInv()); setFInv3(emptyInv()); setFormMsg('')
  }

  function addProject() {
    if (!fClient.trim()) { setFormMsg('Client name is required.'); return }
    const amount = parseFloat(fAmount) || 0
    if (!amount) { setFormMsg('Booked amount is required.'); return }
    const makeInv = (inv: Invoice): Invoice => ({ ...inv, fee: Math.max(0, inv.amt - inv.net) })
    const invoices = [makeInv(fInv1)]
    if (fInv2.amt > 0) invoices.push(makeInv(fInv2))
    if (fInv3.amt > 0) invoices.push(makeInv(fInv3))
    const now = new Date()
    const month = now.toLocaleString('en-US', { month: 'short' }) + ' ' + now.getFullYear()
    const newId = projects.length > 0 ? Math.max(...projects.map(p => p.id)) + 1 : 1
    const project: Project = {
      id: newId, newrep: fNewrep, month, channel: fChannel, type: fType,
      client: fClient.trim(), bm: '', complexity: fComplexity,
      contact: fContact, country: fCountry, email: fEmail, date: fDate, amount,
      billing: fChannel, alloc: { J: +fJ||0, M: +fM||0, N: +fN||0, A: +fA||0, G: +fG||0, S: 0 },
      desc: fDesc, invoices
    }
    mutate([...projects, project])
    setFormMsg('Project saved!')
    setTimeout(() => { resetForm(); setPage('projects') }, 600)
  }

  const navItems: { label: string; page: Page }[] = [
    { label: 'Dashboard', page: 'dashboard' },
    { label: 'Projects', page: 'projects' },
    { label: '+ Add project', page: 'add' },
  ]

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        .wrap { max-width: 960px; margin: 0 auto; padding: 0 1.25rem 3rem; }
        .nav { background: var(--surface); border-bottom: 0.5px solid var(--border); position: sticky; top: 0; z-index: 10; }
        .nav-inner { max-width: 960px; margin: 0 auto; padding: 0 1.25rem; display: flex; align-items: center; gap: 2rem; height: 52px; }
        .nav-brand { font-size: 15px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
        .nav-links { display: flex; gap: 4px; }
        .nav-link { padding: 5px 12px; border-radius: var(--radius); font-size: 13px; border: none; background: transparent; color: var(--text2); cursor: pointer; transition: all 0.12s; font-family: inherit; }
        .nav-link:hover { background: var(--surface2); color: var(--text); }
        .nav-link.active { background: var(--surface2); color: var(--text); font-weight: 500; }
        .page-header { display: flex; align-items: center; justify-content: space-between; padding: 1.5rem 0 1rem; gap: 12px; flex-wrap: wrap; }
        .page-title { font-size: 13px; font-weight: 500; color: var(--text2); text-transform: uppercase; letter-spacing: 0.06em; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 1.5rem; }
        .metric { background: var(--surface2); border-radius: var(--radius); padding: 0.875rem 1rem; }
        .metric-label { font-size: 11px; color: var(--text3); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
        .metric-value { font-size: 20px; font-weight: 500; color: var(--text); }
        .metric-value.green { color: var(--green); }
        .metric-value.amber { color: var(--amber); }
        .metric-value.red { color: var(--red); }
        .card { background: var(--surface); border: 0.5px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; margin-bottom: 1.5rem; }
        .card-header { padding: 10px 14px; border-bottom: 0.5px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
        .card-title { font-size: 12px; font-weight: 500; color: var(--text2); text-transform: uppercase; letter-spacing: 0.06em; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { background: var(--surface2); font-weight: 500; color: var(--text2); padding: 8px 12px; text-align: left; border-bottom: 0.5px solid var(--border); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
        td { padding: 9px 12px; border-bottom: 0.5px solid var(--border); color: var(--text); vertical-align: middle; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: var(--surface2); }
        .amt { font-variant-numeric: tabular-nums; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 100px; font-size: 11px; font-weight: 500; white-space: nowrap; }
        .badge-paid { background: var(--green-bg); color: var(--green-text); }
        .badge-partial { background: var(--amber-bg); color: var(--amber-text); }
        .badge-unpaid { background: var(--red-bg); color: var(--red-text); }
        .badge-uw { background: var(--blue-bg); color: var(--blue-text); }
        .badge-direct { background: var(--purple-bg); color: var(--purple-text); }
        .badge-new { background: var(--green-bg); color: var(--green-text); }
        .badge-repeat { background: var(--amber-bg); color: var(--amber-text); }
        .btn { padding: 6px 12px; font-size: 12px; border: 0.5px solid var(--border2); border-radius: var(--radius); background: var(--surface); color: var(--text); cursor: pointer; transition: all 0.12s; font-family: inherit; }
        .btn:hover { background: var(--surface2); }
        .btn-primary { background: var(--text); color: var(--bg); border-color: var(--text); font-weight: 500; }
        .btn-primary:hover { opacity: 0.85; }
        .btn-danger { color: var(--red); border-color: rgba(163,45,45,0.3); }
        .btn-danger:hover { background: var(--red-bg); }
        .actions { display: flex; gap: 6px; align-items: center; }
        .form-panel { background: var(--surface); border: 0.5px solid var(--border); border-radius: var(--radius-lg); padding: 1.5rem; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .form-group { display: flex; flex-direction: column; gap: 4px; }
        .form-group.full { grid-column: 1 / -1; }
        label { font-size: 11px; color: var(--text2); font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
        input[type="text"], input[type="email"], input[type="number"], input[type="date"], select, textarea {
          padding: 7px 10px; border: 0.5px solid var(--border2); border-radius: var(--radius);
          background: var(--surface); color: var(--text); font-size: 13px; font-family: inherit;
          transition: border-color 0.12s; width: 100%;
        }
        input:focus, select:focus, textarea:focus { outline: none; border-color: var(--text); }
        .section-label { font-size: 11px; font-weight: 500; color: var(--text2); text-transform: uppercase; letter-spacing: 0.06em; margin: 1.25rem 0 0.75rem; }
        .inv-section { border: 0.5px solid var(--border); border-radius: var(--radius); padding: 12px; margin-bottom: 8px; }
        .inv-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
        .alloc-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
        .detail-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 10px; }
        .detail-name { font-size: 20px; font-weight: 500; color: var(--text); }
        .detail-sub { font-size: 13px; color: var(--text2); margin-top: 3px; }
        .detail-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 1.25rem; }
        .detail-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; font-size: 12px; margin-bottom: 1rem; }
        .detail-meta-item { display: flex; gap: 6px; }
        .detail-meta-key { color: var(--text2); min-width: 100px; }
        .inv-detail { border: 0.5px solid var(--border); border-radius: var(--radius); padding: 10px 12px; margin-bottom: 8px; }
        .inv-detail-header { font-size: 11px; font-weight: 500; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
        .inv-detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 12px; }
        .inv-detail-cell { display: flex; flex-direction: column; gap: 2px; }
        .inv-detail-cell-label { color: var(--text3); font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
        .paid-yes { color: var(--green); font-weight: 500; }
        .paid-no { color: var(--red); }
        .filters { display: flex; gap: 8px; flex-wrap: wrap; }
        .filters input, .filters select { width: auto !important; font-size: 12px; padding: 5px 8px; }
        .empty { text-align: center; padding: 2rem; color: var(--text3); font-size: 13px; }
        .form-msg-ok { color: var(--green); font-size: 12px; margin-top: 8px; }
        .form-msg-err { color: var(--red); font-size: 12px; margin-top: 8px; }
        .confirm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
        .confirm-box { background: var(--surface); border: 0.5px solid var(--border); border-radius: var(--radius-lg); padding: 1.5rem; max-width: 340px; width: 90%; }
        .confirm-title { font-size: 15px; font-weight: 500; margin-bottom: 8px; }
        .confirm-body { font-size: 13px; color: var(--text2); margin-bottom: 1.25rem; }
        .confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
        @media (max-width: 600px) {
          .form-grid { grid-template-columns: 1fr; }
          .alloc-grid { grid-template-columns: repeat(3, 1fr); }
          .detail-metrics { grid-template-columns: 1fr 1fr; }
          .inv-detail-grid { grid-template-columns: 1fr 1fr; }
        }
      `}</style>

      <nav className="nav">
        <div className="nav-inner">
          <span className="nav-brand">Numberly</span>
          <div className="nav-links">
            {navItems.map(n => (
              <button key={n.page} className={`nav-link ${page === n.page ? 'active' : ''}`}
                onClick={() => { if (n.page !== 'add') resetForm(); setPage(n.page) }}>
                {n.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="wrap">

        {page === 'dashboard' && (
          <>
            <div className="page-header"><span className="page-title">Overview</span></div>
            <div className="metrics">
              <div className="metric"><div className="metric-label">Total booked</div><div className="metric-value">{fmt(totalBooked)}</div></div>
              <div className="metric"><div className="metric-label">Collected (net)</div><div className="metric-value green">{fmt(totalCollected)}</div></div>
              <div className="metric"><div className="metric-label">Outstanding</div><div className="metric-value amber">{fmt(totalOutstanding)}</div></div>
              <div className="metric"><div className="metric-label">Projects</div><div className="metric-value">{projects.length}</div></div>
              <div className="metric"><div className="metric-label">Unpaid</div><div className={`metric-value ${unpaidCount > 0 ? 'red' : ''}`}>{unpaidCount}</div></div>
            </div>

            <div className="card">
              <div className="card-header"><span className="card-title">Outstanding balances</span></div>
              {outstanding.length === 0 ? (
                <div className="empty">✓ No outstanding balances</div>
              ) : (
                <table>
                  <thead><tr><th>Client</th><th>Month</th><th>Booked</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {outstanding.map(p => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 500 }}>{p.client}</td>
                        <td style={{ color: 'var(--text2)' }}>{p.month}</td>
                        <td className="amt">{fmt(p.amount)}</td>
                        <td className="amt" style={{ color: 'var(--amber)', fontWeight: 500 }}>{fmt(remainingBalance(p))}</td>
                        <td><StatusBadge status={paymentStatus(p)} /></td>
                        <td><button className="btn" onClick={() => goDetail(p.id)}>View</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">All projects</span>
                <div className="filters">
                  <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
                    <option value="">All months</option>
                    {months.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    <option value="Fully paid">Fully paid</option>
                    <option value="Partial">Partial</option>
                    <option value="Unpaid">Unpaid</option>
                  </select>
                </div>
              </div>
              <table>
                <thead><tr><th>Client</th><th>Month</th><th>Channel</th><th>Booked</th><th>Net recv.</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {recentFiltered.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.client}</td>
                      <td style={{ color: 'var(--text2)', fontSize: 12 }}>{p.month}</td>
                      <td><ChannelBadge channel={p.channel} /></td>
                      <td className="amt">{fmt(p.amount)}</td>
                      <td className="amt">{fmt(totalNetReceived(p))}</td>
                      <td><StatusBadge status={paymentStatus(p)} /></td>
                      <td><button className="btn" onClick={() => goDetail(p.id)}>View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {page === 'projects' && (
          <>
            <div className="page-header">
              <span className="page-title">All projects ({projFiltered.length})</span>
              <div className="filters">
                <input type="text" placeholder="Search client..." value={projSearch} onChange={e => setProjSearch(e.target.value)} style={{ width: 180 }} />
                <select value={projChannel} onChange={e => setProjChannel(e.target.value)}>
                  <option value="">All channels</option>
                  <option value="UW">Upwork</option>
                  <option value="Direct">Direct</option>
                </select>
              </div>
            </div>
            <div className="card">
              <table>
                <thead>
                  <tr><th>Client</th><th>Month</th><th>Type</th><th>Ch.</th><th>Booked</th><th>Net recv.</th><th>Balance</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {projFiltered.length === 0 ? (
                    <tr><td colSpan={9}><div className="empty">No projects found</div></td></tr>
                  ) : projFiltered.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.client}</td>
                      <td style={{ color: 'var(--text2)', fontSize: 12 }}>{p.month}</td>
                      <td style={{ color: 'var(--text2)', fontSize: 12 }}>{p.type || '—'}</td>
                      <td><ChannelBadge channel={p.channel} /></td>
                      <td className="amt">{fmt(p.amount)}</td>
                      <td className="amt">{fmt(totalNetReceived(p))}</td>
                      <td className="amt" style={{ color: remainingBalance(p) > 0 ? 'var(--amber)' : 'var(--text3)' }}>{fmt(remainingBalance(p))}</td>
                      <td><StatusBadge status={paymentStatus(p)} /></td>
                      <td>
                        <div className="actions">
                          <button className="btn" onClick={() => goDetail(p.id)}>View</button>
                          <button className="btn btn-danger" onClick={() => setShowDeleteConfirm(p.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {page === 'add' && (
          <>
            <div className="page-header"><span className="page-title">New project</span></div>
            <div className="form-panel">
              <div className="form-grid">
                <div className="form-group"><label>Client name *</label><input type="text" value={fClient} onChange={e => setFClient(e.target.value)} placeholder="e.g. Acme Corp" /></div>
                <div className="form-group"><label>Contact person</label><input type="text" value={fContact} onChange={e => setFContact(e.target.value)} /></div>
                <div className="form-group"><label>Email</label><input type="email" value={fEmail} onChange={e => setFEmail(e.target.value)} /></div>
                <div className="form-group"><label>Country</label><input type="text" value={fCountry} onChange={e => setFCountry(e.target.value)} /></div>
                <div className="form-group"><label>Contract close date</label><input type="date" value={fDate} onChange={e => setFDate(e.target.value)} /></div>
                <div className="form-group"><label>Channel</label>
                  <select value={fChannel} onChange={e => setFChannel(e.target.value)}>
                    <option value="UW">Upwork</option><option value="Direct">Direct</option><option value="Stripe">Stripe</option>
                  </select>
                </div>
                <div className="form-group"><label>New / Repeat</label>
                  <select value={fNewrep} onChange={e => setFNewrep(e.target.value)}>
                    <option value="New">New</option><option value="Repeat">Repeat</option>
                  </select>
                </div>
                <div className="form-group"><label>Booked amount ($) *</label><input type="number" value={fAmount} onChange={e => setFAmount(e.target.value)} placeholder="0.00" /></div>
                <div className="form-group"><label>Project type</label><input type="text" value={fType} onChange={e => setFType(e.target.value)} placeholder="FM, Advisory, etc." /></div>
                <div className="form-group"><label>Complexity</label>
                  <select value={fComplexity} onChange={e => setFComplexity(e.target.value)}>
                    <option>Wizard+</option><option>Complex</option><option>Standard</option><option>Simple</option>
                  </select>
                </div>
                <div className="form-group full"><label>Project description</label><textarea value={fDesc} onChange={e => setFDesc(e.target.value)} rows={2} /></div>
              </div>

              <div className="section-label">Revenue allocation (%)</div>
              <div className="alloc-grid">
                {([['J', fJ, setFJ], ['M', fM, setFM], ['N', fN, setFN], ['A', fA, setFA], ['G', fG, setFG]] as [string, string, (v: string) => void][]).map(([k, v, set]) => (
                  <div className="form-group" key={k}>
                    <label style={{ color: ALLOC_COLORS[k] }}>{k}%</label>
                    <input type="number" value={v} onChange={e => set(e.target.value)} min="0" max="100" placeholder="0" />
                  </div>
                ))}
              </div>

              {([
                ['Invoice 1', fInv1, setFInv1],
                ['Invoice 2 (optional)', fInv2, setFInv2],
                ['Invoice 3 (optional)', fInv3, setFInv3],
              ] as [string, Invoice, (v: Invoice) => void][]).map(([lbl, inv, setInv]) => (
                <div key={lbl}>
                  <div className="section-label">{lbl}</div>
                  <div className="inv-section">
                    <div className="inv-grid">
                      <div className="form-group"><label>Invoice #</label><input type="text" value={inv.num} onChange={e => setInv({ ...inv, num: e.target.value })} /></div>
                      <div className="form-group"><label>Date</label><input type="date" value={inv.date} onChange={e => setInv({ ...inv, date: e.target.value })} /></div>
                      <div className="form-group"><label>Amount ($)</label><input type="number" value={inv.amt || ''} onChange={e => setInv({ ...inv, amt: +e.target.value })} /></div>
                      <div className="form-group"><label>Due date</label><input type="date" value={inv.due} onChange={e => setInv({ ...inv, due: e.target.value })} /></div>
                      <div className="form-group"><label>Date paid</label><input type="date" value={inv.paid} onChange={e => setInv({ ...inv, paid: e.target.value })} /></div>
                      <div className="form-group"><label>Net received ($)</label><input type="number" value={inv.net || ''} onChange={e => setInv({ ...inv, net: +e.target.value })} /></div>
                    </div>
                  </div>
                </div>
              ))}

              <div style={{ marginTop: '1.25rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-primary" onClick={addProject}>Save project</button>
                <button className="btn" onClick={() => { resetForm(); setPage('projects') }}>Cancel</button>
              </div>
              {formMsg && <div className={formMsg.includes('saved') || formMsg.includes('!') ? 'form-msg-ok' : 'form-msg-err'}>{formMsg}</div>}
            </div>
          </>
        )}

        {page === 'detail' && detail && (
          <>
            <div className="page-header">
              <button className="btn" onClick={() => setPage('projects')}>← Back</button>
              <button className="btn btn-danger" onClick={() => setShowDeleteConfirm(detail.id)}>Delete project</button>
            </div>
            <div className="form-panel">
              <div className="detail-header">
                <div>
                  <div className="detail-name">{detail.client}</div>
                  <div className="detail-sub">
                    {[detail.contact, detail.country, detail.email].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="actions">
                  <NewRepBadge newrep={detail.newrep} />
                  <StatusBadge status={paymentStatus(detail)} />
                  <ChannelBadge channel={detail.channel} />
                </div>
              </div>

              <div className="detail-metrics">
                <div className="metric"><div className="metric-label">Booked</div><div className="metric-value">{fmt(detail.amount)}</div></div>
                <div className="metric"><div className="metric-label">Net received</div><div className="metric-value green">{fmt(totalNetReceived(detail))}</div></div>
                <div className="metric"><div className="metric-label">Balance</div><div className={`metric-value ${remainingBalance(detail) > 0 ? 'amber' : ''}`}>{fmt(remainingBalance(detail))}</div></div>
                <div className="metric"><div className="metric-label">Invoices</div><div className="metric-value">{detail.invoices.length}</div></div>
              </div>

              <div className="detail-meta">
                {[
                  ['Month', detail.month], ['Contract date', detail.date],
                  ['Type', detail.type || '—'], ['Business model', detail.bm || '—'],
                  ['Complexity', detail.complexity || '—'], ['Billing via', detail.billing],
                ].map(([k, v]) => (
                  <div className="detail-meta-item" key={k}><span className="detail-meta-key">{k}</span><span>{v}</span></div>
                ))}
              </div>

              {detail.desc && (
                <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: 13, color: 'var(--text2)', marginBottom: '1rem' }}>
                  {detail.desc}
                </div>
              )}

              <div className="section-label">Revenue allocation</div>
              <AllocBar alloc={detail.alloc} />

              <div className="section-label" style={{ marginTop: '1.25rem' }}>Invoices</div>
              {detail.invoices.map((inv, i) => (
                <div className="inv-detail" key={i}>
                  <div className="inv-detail-header">Invoice {i + 1}{inv.num ? ` — #${inv.num}` : ''}</div>
                  <div className="inv-detail-grid">
                    <div className="inv-detail-cell"><span className="inv-detail-cell-label">Date</span><span>{inv.date || '—'}</span></div>
                    <div className="inv-detail-cell"><span className="inv-detail-cell-label">Amount</span><span className="amt">{fmt(inv.amt)}</span></div>
                    <div className="inv-detail-cell"><span className="inv-detail-cell-label">Due</span><span>{inv.due || '—'}</span></div>
                    <div className="inv-detail-cell"><span className="inv-detail-cell-label">Date paid</span><span className={inv.paid ? 'paid-yes' : 'paid-no'}>{inv.paid || 'Unpaid'}</span></div>
                    <div className="inv-detail-cell"><span className="inv-detail-cell-label">Net received</span><span className="amt">{fmt(inv.net || 0)}</span></div>
                    <div className="inv-detail-cell"><span className="inv-detail-cell-label">Platform fee</span><span className="amt" style={{ color: 'var(--text2)' }}>{fmt(inv.fee || 0)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {showDeleteConfirm !== null && (
        <div className="confirm-overlay" onClick={() => setShowDeleteConfirm(null)}>
          <div className="confirm-box" onClick={e => e.stopPropagation()}>
            <div className="confirm-title">Delete project?</div>
            <div className="confirm-body">
              This will permanently remove <strong>{projects.find(p => p.id === showDeleteConfirm)?.client}</strong> and all its invoices. This cannot be undone.
            </div>
            <div className="confirm-actions">
              <button className="btn" onClick={() => setShowDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => deleteProject(showDeleteConfirm!)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
