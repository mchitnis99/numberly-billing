import Papa from 'papaparse'
import { Project, Invoice } from './data'
import { emptyInvoice, nextInvoiceSlot, formatDateMDY, deriveMonth, suggestNameMatch, FuzzySuggestion as NameSuggestion } from './importShared'

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

  const results: UpworkTransaction[] = []
  for (const [txId, rows] of groups) {
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
  const name = clientName.trim().toLowerCase()
  if (!name) return { status: 'unmatched', candidates: [] }
  const matches = projects.filter(p => (p.upworkName || '').trim().toLowerCase() === name && p.month === month)
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
    startup: tx.contractTitle,
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
    invoices: [{ ...emptyInvoice(), num: tx.transactionId, amt: tx.grossAmount, uwFee: tx.fee, net: tx.net, paid: formattedDate, isPaid: true }],
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

// Builds review rows for the whole parsed batch in one pass, so multiple transactions that
// auto-match to the SAME existing project (e.g. two weekly payments in the same month) are
// assigned distinct, sequential invoice slots instead of colliding on the same slot.
//
// Transactions whose Upwork Transaction ID is already recorded on any existing project's invoices
// (`invoice.num`) are flagged 'Already recorded' up front and never re-matched — this is what
// makes re-running the importer over the same or overlapping CSV export safe.
export function buildReviewRows(transactions: UpworkTransaction[], projects: Project[]): ReviewRow[] {
  const recordedIds = new Set(projects.flatMap(p => p.invoices.map(inv => inv.num).filter(Boolean)))

  const workingInvoices = new Map<number, Invoice[]>()
  const getWorking = (project: Project): Invoice[] => {
    if (!workingInvoices.has(project.id)) workingInvoices.set(project.id, project.invoices.map(inv => ({ ...inv })))
    return workingInvoices.get(project.id)!
  }
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
      const project = match.candidates[0]
      projectId = project.id
      const working = getWorking(project)
      slot = nextInvoiceSlot(working, tx.grossAmount)
      while (working.length <= slot) working.push(emptyInvoice())
      // Tentatively reserve the slot so the next transaction targeting this project moves past it
      working[slot] = { ...working[slot], amt: tx.grossAmount, paid: 'pending' }
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
