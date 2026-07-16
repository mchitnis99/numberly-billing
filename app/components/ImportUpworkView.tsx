'use client'

import { Dispatch, SetStateAction, useRef, useState } from 'react'
import { Project, fmt, insertProject, upsertProject } from '../lib/data'
import {
  parseUpworkCSV, buildReviewRows, nextInvoiceSlot, formatUpworkDate, buildShellProject, emptyInvoice,
  ReviewRow, RowStatus,
} from '../lib/upworkImport'

type SuggestionState = 'pending' | 'use-project' | 'dismissed' | null

type RowState = ReviewRow & { included: boolean; applied: boolean; suggestionResolved: SuggestionState }

const statusBadgeClass: Record<RowStatus, string> = {
  Matched: 'badge-paid',
  'New project': 'badge-new',
  Ambiguous: 'badge-partial',
  Unmatched: 'badge-unpaid',
  'No slot': 'badge-unpaid',
}

function displayBadge(r: RowState): { label: string; cls: string } {
  if (r.applied) return { label: 'Applied', cls: 'badge-paid' }
  if (r.suggestion && r.suggestionResolved === 'pending') return { label: 'Possible match', cls: 'badge-partial' }
  return { label: r.status, cls: statusBadgeClass[r.status] }
}

function ordinal(n: number): string {
  return ['1st', '2nd', '3rd'][n] || `${n + 1}th`
}

export function ImportUpworkView({ projects, setProjects }: {
  projects: Project[]
  setProjects: Dispatch<SetStateAction<Project[]>>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<RowState[]>([])
  const [parseError, setParseError] = useState('')
  const [summary, setSummary] = useState<{ count: number; projectNames: string[] } | null>(null)
  const [applying, setApplying] = useState(false)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSummary(null)
    setParseError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const transactions = parseUpworkCSV(text)
      if (transactions.length === 0) {
        setParseError('No transactions found in this file.')
        setRows([])
        return
      }
      const built = buildReviewRows(transactions, projects)
      setRows(built.map(r => ({
        ...r,
        included: r.status === 'Matched' || r.status === 'New project',
        applied: false,
        suggestionResolved: r.suggestion ? 'pending' : null,
      })))
    }
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  function updateRow(key: string, patch: Partial<RowState>) {
    setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r))
  }

  function selectProject(key: string, projectId: number | null) {
    setRows(prev => prev.map(r => {
      if (r.key !== key) return r
      if (projectId === null) return { ...r, projectId: null, slot: null }
      const project = projects.find(p => p.id === projectId)
      const slot = project ? nextInvoiceSlot(project.invoices, r.tx.grossAmount) : null
      return { ...r, projectId, slot }
    }))
  }

  // "Use this project": switch the row from auto-create/unmatched to point at the fuzzy-suggested
  // client. If that client has projects in more than one month, fall back to a scoped dropdown
  // (reusing the Ambiguous flow) rather than guessing which month's instance is right.
  function applySuggestedProject(key: string) {
    setRows(prev => prev.map(r => {
      if (r.key !== key || !r.suggestion) return r
      const suggestedName = r.suggestion.upworkName.trim().toLowerCase()
      const matches = projects.filter(p => (p.upworkName || '').trim().toLowerCase() === suggestedName)
      if (matches.length === 1) {
        const project = matches[0]
        return {
          ...r, status: 'Matched', candidates: [project], projectId: project.id,
          slot: nextInvoiceSlot(project.invoices, r.tx.grossAmount),
          groupKey: null, suggestionResolved: 'use-project', included: false,
        }
      }
      return {
        ...r, status: 'Ambiguous', candidates: matches, projectId: null, slot: null,
        groupKey: null, suggestionResolved: 'use-project', included: false,
      }
    }))
  }

  function dismissSuggestion(key: string) {
    setRows(prev => prev.map(r => r.key === key ? { ...r, suggestionResolved: 'dismissed' } : r))
  }

  async function applySelected() {
    const toApply = rows.filter(r => r.included && !r.applied)
    if (toApply.length === 0) return
    setApplying(true)

    const workingProjects = new Map<number, Project>(projects.map(p => [p.id, p]))
    const originalAmounts = new Map<number, number>(projects.map(p => [p.id, p.amount]))
    const newlyCreatedByGroup = new Map<string, number>()
    const createdProjects: Project[] = []
    const existingTouchedIds = new Set<number>()
    const touchedNames = new Map<number, string>()
    const appliedKeys = new Set<string>()

    for (const r of toApply) {
      if (r.status === 'New project' && r.groupKey) {
        const existingId = newlyCreatedByGroup.get(r.groupKey)
        if (existingId !== undefined) {
          const current = workingProjects.get(existingId)!
          const invs = [...current.invoices, {
            ...emptyInvoice(), amt: r.tx.grossAmount, uwFee: r.tx.fee, net: r.tx.net,
            paid: formatUpworkDate(r.tx.date), isPaid: true,
          }]
          const updated: Project = { ...current, amount: current.amount + r.tx.grossAmount, invoices: invs }
          workingProjects.set(existingId, updated)
          existingTouchedIds.add(existingId)
          touchedNames.set(existingId, updated.startup)
          appliedKeys.add(r.key)
        } else {
          try {
            const created = await insertProject(buildShellProject(r.tx))
            newlyCreatedByGroup.set(r.groupKey, created.id)
            workingProjects.set(created.id, created)
            createdProjects.push(created)
            touchedNames.set(created.id, created.startup)
            appliedKeys.add(r.key)
          } catch (err) {
            console.error('Failed to create project from Upwork import', err)
          }
        }
      } else if (r.projectId !== null && r.slot !== null) {
        const current = workingProjects.get(r.projectId)
        if (!current) continue
        const invs = [...current.invoices]
        while (invs.length <= r.slot) invs.push(emptyInvoice())
        invs[r.slot] = {
          ...invs[r.slot], amt: r.tx.grossAmount, uwFee: r.tx.fee, net: r.tx.net,
          paid: formatUpworkDate(r.tx.date), isPaid: true,
        }
        const shouldAccumulate = (originalAmounts.get(r.projectId) ?? 0) === 0
        const updated: Project = { ...current, invoices: invs, amount: shouldAccumulate ? current.amount + r.tx.grossAmount : current.amount }
        workingProjects.set(r.projectId, updated)
        existingTouchedIds.add(r.projectId)
        touchedNames.set(r.projectId, updated.startup)
        appliedKeys.add(r.key)
      }
    }

    try {
      await Promise.all([...existingTouchedIds].map(id => upsertProject(workingProjects.get(id)!)))
    } catch (err) {
      console.error('Failed to save one or more projects updated from Upwork import', err)
    }

    setProjects(prev => {
      const byId = new Map(prev.map(p => [p.id, p]))
      existingTouchedIds.forEach(id => { if (workingProjects.has(id)) byId.set(id, workingProjects.get(id)!) })
      createdProjects.forEach(p => byId.set(p.id, p))
      return [...byId.values()].sort((a, b) => a.id - b.id)
    })

    setRows(prev => prev.map(r => appliedKeys.has(r.key) ? { ...r, applied: true, included: false } : r))
    setSummary({ count: appliedKeys.size, projectNames: [...new Set(touchedNames.values())] })
    setApplying(false)
  }

  const selectedCount = rows.filter(r => r.included && !r.applied).length

  return (
    <div style={{ padding: '1.5rem 0', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ fontSize: 12 }} />
        {rows.length > 0 && (
          <button className="btn btn-primary" disabled={selectedCount === 0 || applying} onClick={applySelected}>
            {applying ? 'Applying…' : `Apply Selected (${selectedCount})`}
          </button>
        )}
      </div>

      {parseError && <div style={{ fontSize: 12, color: 'var(--red)' }}>{parseError}</div>}

      {summary && (
        <div style={{ fontSize: 12, color: 'var(--green)' }}>
          {summary.count} invoice{summary.count !== 1 ? 's' : ''} updated
          {summary.projectNames.length > 0 && <> — {summary.projectNames.join(', ')}</>}
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table style={{ minWidth: 1150, tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th></th>
                <th>Date</th>
                <th>Client</th>
                <th>Contract</th>
                <th>Gross</th>
                <th>Fee</th>
                <th>Net</th>
                <th>Matched Project</th>
                <th>Invoice Slot</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const isNew = r.status === 'New project'
                const pendingSuggestion = !!(r.suggestion && r.suggestionResolved === 'pending')
                const projectOptions = r.status === 'Ambiguous' ? r.candidates : projects
                const selectedProject = r.projectId !== null ? projects.find(p => p.id === r.projectId) : undefined
                const slotChoices = Array.from({ length: Math.max(3, selectedProject?.invoices.length ?? 0, (r.slot ?? 0) + 1) }, (_, i) => i)
                const badge = displayBadge(r)
                return (
                  <tr key={r.key}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={r.included} disabled={r.applied}
                        onChange={e => updateRow(r.key, { included: e.target.checked })}
                        style={{ cursor: 'pointer' }} />
                    </td>
                    <td>{r.tx.date}</td>
                    <td>{r.tx.clientName}</td>
                    <td style={{ color: 'var(--text2)' }}>{r.tx.contractTitle}</td>
                    <td className="amt">{fmt(r.tx.grossAmount)}</td>
                    <td className="amt">{fmt(r.tx.fee)}</td>
                    <td className="amt">{fmt(r.tx.net)}</td>
                    <td>
                      {pendingSuggestion ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: 11, color: 'var(--amber)' }}>
                            Did you mean: <strong>{r.suggestion!.upworkName}</strong>?
                          </span>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn" style={{ fontSize: 10, padding: '2px 6px' }}
                              onClick={() => applySuggestedProject(r.key)}>Use this project</button>
                            <button className="btn" style={{ fontSize: 10, padding: '2px 6px' }}
                              onClick={() => dismissSuggestion(r.key)}>No, create new</button>
                          </div>
                        </div>
                      ) : isNew ? (
                        <span style={{ color: 'var(--text2)', fontStyle: 'italic' }}>
                          + New — {r.tx.clientName} ({r.tx.month})
                        </span>
                      ) : (
                        <select className="cell-input" value={r.projectId ?? ''} disabled={r.applied}
                          onChange={e => selectProject(r.key, e.target.value ? +e.target.value : null)}>
                          <option value="">— select —</option>
                          {[...projectOptions].sort((a, b) => a.startup.localeCompare(b.startup)).map(p => (
                            <option key={p.id} value={p.id}>{p.startup} ({p.month}){p.upworkName ? ` — ${p.upworkName}` : ''}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      {pendingSuggestion ? (
                        <span style={{ color: 'var(--text3)' }}>—</span>
                      ) : isNew ? (
                        <span style={{ color: 'var(--text2)', fontStyle: 'italic' }}>new</span>
                      ) : (
                        <select className="cell-input" value={r.slot ?? ''} disabled={r.applied}
                          onChange={e => updateRow(r.key, { slot: e.target.value ? +e.target.value : null })}>
                          <option value="">— select —</option>
                          {slotChoices.map(i => <option key={i} value={i}>{ordinal(i)}</option>)}
                        </select>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${badge.cls}`}>{badge.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
