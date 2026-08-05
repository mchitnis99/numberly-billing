import Papa from 'papaparse'
import { Project } from './data'
import { emptyInvoice, nextInvoiceSlot, formatDateMDY, deriveMonth, suggestNameMatch, normalizeForMatch, accumulateInvoice, invoiceNumIds, FuzzySuggestion as NameSuggestion } from './importShared'

export type UpworkTransaction = {
  transactionId: string
  date: string
  month: string // derived from `date`, formatted like project.month (e.g. "Jul 2026")
  clientName: string
  contractTitle: string
  grossAmount: number
  fee: number
  net: number
}

type RawRow = Record<string, string | undefined>

function parseAmt(s: string | undefined): number {
  if (!s) return 0
  return parseFloat(s.replace(/[$,]/g, '')) || 0
}

export const formatUpworkDate = formatDateMDY
export { emptyInvoice, nextInvoiceSlot, deriveMonth }

// Parses an Upwork transaction-history CSV export into one transaction per Transaction ID group.
// Rows with Transaction type "Payment" (personal card charges, no Transaction ID) are ignored.
//
// Refunds need special handling. When Monica/Numberly refunds a client, Upwork logs it as a
// *separate* Transaction ID containing a "Refund to client" row (the negative reversal) and a
// "Service fee refund" row (Upwork crediting back its cut) — it does not reference the original
// earning's Transaction ID. Naively summing every group's positive amounts as revenue means a
// refunded week's earnings still get counted, AND the refund's own fee-credit line gets counted
// again as if it were new income. Both the refund group and the original earning group it reverses
// are excluded entirely — matched by same Client team + contract title + exact refunded amount.
export function parseUpworkCSV(text: string): UpworkTransaction[] {
  const { data } = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() })

  const groups = new Map<string, RawRow[]>()
  for (const row of data) {
    const type = (row['Transaction type'] || '').trim()
    if (type === 'Payment') continue
    const txId = (row['Transaction ID'] || '').trim()
    if (!txId) continue
    if (!groups.has(txId)) groups.set(txId, [])
    groups.get(txId)!.push(row)
  }

  const excluded = new Set<string>()
  for (const [txId, rows] of groups) {
    const refundRow = rows.find(r => (r['Transaction type'] || '').trim() === 'Refund to client')
    if (!refundRow) continue
    excluded.add(txId)
    const refundedAmt = Math.abs(parseAmt(refundRow['Amount $']))
    const client = (refundRow['Client team'] || '').trim()
    const contract = (refundRow['Transaction summary'] || '').trim()
    for (const [otherId, otherRows] of groups) {
      if (excluded.has(otherId)) continue
      if ((otherRows[0]['Client team'] || '').trim() !== client) continue
      if ((otherRows[0]['Transaction summary'] || '').trim() !== contract) continue
      const otherGross = otherRows.reduce((s, r) => { const a = parseAmt(r['Amount $']); return a > 0 ? s + a : s }, 0)
      if (Math.abs(otherGross - refundedAmt) <= 0.01) {
        excluded.add(otherId)
        break
      }
    }
  }

  const results: UpworkTransaction[] = []
  for (const [txId, rows] of groups) {
    if (excluded.has(txId)) continue
    let grossAmount = 0
    let fee = 0
    for (const row of rows) {
      const amt = parseAmt(row['Amount $'])
      if (amt > 0) grossAmount += amt
      else if (amt < 0) fee += Math.abs(amt)
    }
    // Prefer the positive-amount row for date/client/contract when the group disagrees
    const primaryRow = rows.find(r => parseAmt(r['Amount $']) > 0) || rows[0]
    const date = (primaryRow['Date'] || '').trim()
    results.push({
      transactionId: txId,
      date,
      month: deriveMonth(date),
      clientName: (primaryRow['Client team'] || '').trim(),
      contractTitle: (primaryRow['Transaction summary'] || '').trim(),
      grossAmount,
      fee,
      net: grossAmount - fee,
    })
  }
  return results
}

export type MatchStatus = 'matched' | 'ambiguous' | 'new' | 'unmatched'

// Matches on upworkName + month together. A same-client project in a different month is not
// "ambiguous" — it just means there's no project for this month yet, so it falls through to 'new'.
export function matchProjectsByNameAndMonth(clientName: string, month: string, projects: Project[]): { status: MatchStatus; candidates: Project[] } {
  const name = normalizeForMatch(clientName)
  if (!name) return { status: 'unmatched', candidates: [] }
  const matches = projects.filter(p => normalizeForMatch(p.upworkName || '') === name && p.month === month)
  if (matches.length === 1) return { status: 'matched', candidates: matches }
  if (matches.length > 1) return { status: 'ambiguous', candidates: matches }
  return { status: 'new', candidates: [] }
}

// Builds a shell project for a client+month combo with no existing project — the first
// transaction in the group seeds it; later transactions in the same group get merged in by the caller.
export function buildShellProject(tx: UpworkTransaction): Project {
  const formattedDate = formatUpworkDate(tx.date)
  return {
    id: 0,
    newrep: 'New',
    month: tx.month,
    channel: 'UW',
    delivery: 'FM',
    startup: tx.clientName,
    modelDesc: '',
    soldBy: '',
    alloc: { J: 0, M: 0, N: 0, A: 0, G: 0, S: 0 },
    description: tx.contractTitle,
    upworkName: tx.clientName,
    country: 'US',
    contact: '',
    email: '',
    date: formattedDate,
    amount: tx.grossAmount,
    billingThru: 'Upwork',
    invoicingValue: '',
    billingDetails: '',
    readyForBilling: false,
    badDebt: false,
    done: false,
    importedBalance: 0,
    importedData: false,
    notes: '',
    invoices: [accumulateInvoice(emptyInvoice(), { amt: tx.grossAmount, fee: tx.fee, net: tx.net, paid: formattedDate, txId: tx.transactionId })],
    stripeInvoiceId: '',
    stripeInvoiceUrl: '',
    invoicedAt: '',
  }
}

export const FUZZY_MATCH_THRESHOLD = 0.8

export type FuzzySuggestion = { upworkName: string; score: number }

// Best fuzzy match for `clientName` among `candidateNames`, above FUZZY_MATCH_THRESHOLD.
export function suggestUpworkName(clientName: string, candidateNames: string[]): FuzzySuggestion | null {
  const match: NameSuggestion | null = suggestNameMatch(clientName, candidateNames, FUZZY_MATCH_THRESHOLD)
  return match ? { upworkName: match.name, score: match.score } : null
}

export type RowStatus = 'Matched' | 'Ambiguous' | 'Unmatched' | 'No slot' | 'New project' | 'Already recorded'

export type ReviewRow = {
  key: string
  tx: UpworkTransaction
  status: RowStatus
  candidates: Project[]
  projectId: number | null
  slot: number | null
  groupKey: string | null // set for 'New project' rows — groups same client+month transactions into one shell
  suggestion: FuzzySuggestion | null // populated only for 'New project' / 'Unmatched' rows
}

// Builds review rows for the whole parsed batch in one pass.
//
// Transactions whose Upwork Transaction ID is already recorded on any existing project's invoices
// are flagged 'Already recorded' up front and never re-matched — this is what makes re-running the
// importer over the same or overlapping CSV export safe. Recorded IDs are read via `invoiceNumIds`
// since an accumulating invoice's `num` field holds a comma-separated list of every transaction
// ID it has folded in, not just one.
//
// Matched/new-project rows all target invoice slot 0 — every transaction for the same client+month
// accumulates into one running-total invoice (see `accumulateInvoice`) rather than each getting its
// own slot, so there's no need to reserve/track slots across rows in the same batch.
export function buildReviewRows(transactions: UpworkTransaction[], projects: Project[]): ReviewRow[] {
  const recordedIds = new Set(projects.flatMap(p => p.invoices.flatMap(inv => invoiceNumIds(inv.num))))
  const distinctUpworkNames = [...new Set(projects.map(p => (p.upworkName || '').trim()).filter(Boolean))]

  return transactions.map(tx => {
    if (recordedIds.has(tx.transactionId)) {
      return { key: tx.transactionId, tx, status: 'Already recorded' as RowStatus, candidates: [], projectId: null, slot: null, groupKey: null, suggestion: null }
    }

    const match = matchProjectsByNameAndMonth(tx.clientName, tx.month, projects)
    let projectId: number | null = null
    let slot: number | null = null
    let status: RowStatus
    let groupKey: string | null = null
    let suggestion: FuzzySuggestion | null = null

    if (match.status === 'matched') {
      projectId = match.candidates[0].id
      slot = 0
      status = 'Matched'
    } else if (match.status === 'ambiguous') {
      status = 'Ambiguous'
    } else if (match.status === 'new') {
      status = 'New project'
      groupKey = tx.clientName.trim().toLowerCase() + '|' + tx.month
      suggestion = suggestUpworkName(tx.clientName, distinctUpworkNames)
    } else {
      status = 'Unmatched'
      suggestion = suggestUpworkName(tx.clientName, distinctUpworkNames)
    }

    return { key: tx.transactionId, tx, status, candidates: match.candidates, projectId, slot, groupKey, suggestion }
  })
}
