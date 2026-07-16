import Papa from 'papaparse'
import { Project, Invoice } from './data'

const MONTH_ORDER = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

// Normalizes an Upwork CSV date into the app's existing MM/DD/YYYY invoice-date format.
export function formatUpworkDate(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) return `${mdy[1].padStart(2, '0')}/${mdy[2].padStart(2, '0')}/${mdy[3]}`
  const d = new Date(s)
  if (!isNaN(d.getTime())) {
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`
  }
  return s
}

// Derives a "Mon YYYY" month string from a raw CSV date, matching project.month's format.
export function deriveMonth(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return MONTH_ORDER[parseInt(iso[2], 10) - 1] + ' ' + iso[1]
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) return MONTH_ORDER[parseInt(mdy[1], 10) - 1] + ' ' + mdy[3]
  const d = new Date(s)
  if (!isNaN(d.getTime())) return MONTH_ORDER[d.getMonth()] + ' ' + d.getFullYear()
  return ''
}

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

export function emptyInvoice(): Invoice {
  return { num: '', date: '', amt: 0, due: '', paid: '', net: 0, uwFee: 0, stripeFee: 0, isPaid: false }
}

// Finds the invoice slot awaiting this payment: first empty slot, or a slot whose amount roughly
// matches (within $1) and hasn't been marked paid yet. If none fits, expands past the end rather
// than dropping the payment — the caller is responsible for actually pushing the new slot.
export function nextInvoiceSlot(invoices: Invoice[], grossAmount: number): number {
  const emptyIdx = invoices.findIndex(inv => !inv || !inv.amt)
  if (emptyIdx !== -1) return emptyIdx
  const awaitingIdx = invoices.findIndex(inv => inv && !inv.paid && Math.abs(inv.amt - grossAmount) <= 1)
  if (awaitingIdx !== -1) return awaitingIdx
  return invoices.length
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
    invoices: [{ ...emptyInvoice(), amt: tx.grossAmount, uwFee: tx.fee, net: tx.net, paid: formattedDate, isPaid: true }],
    stripeInvoiceId: '',
    stripeInvoiceUrl: '',
    invoicedAt: '',
  }
}

// Plain Levenshtein edit distance (single-row DP, O(n*m) time / O(n) space).
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = new Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prevDiag = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prevDiag : 1 + Math.min(prevDiag, dp[j], dp[j - 1])
      prevDiag = temp
    }
  }
  return dp[n]
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
}

// Similarity in [0, 1]: 1 = identical after normalizing, 0 = completely different / either side empty.
function nameSimilarity(a: string, b: string): number {
  const na = normalizeForMatch(a)
  const nb = normalizeForMatch(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const maxLen = Math.max(na.length, nb.length)
  return 1 - levenshtein(na, nb) / maxLen
}

export const FUZZY_MATCH_THRESHOLD = 0.8

export type FuzzySuggestion = { upworkName: string; score: number }

// Best fuzzy match for `clientName` among `candidateNames`, above FUZZY_MATCH_THRESHOLD.
// Exact matches (after normalizing) are excluded — those represent the same client in a
// different month, which is expected/intentional, not a typo worth flagging.
export function suggestUpworkName(clientName: string, candidateNames: string[]): FuzzySuggestion | null {
  let best: FuzzySuggestion | null = null
  for (const name of candidateNames) {
    const score = nameSimilarity(clientName, name)
    if (score >= 1) continue
    if (!best || score > best.score) best = { upworkName: name, score }
  }
  return best && best.score >= FUZZY_MATCH_THRESHOLD ? best : null
}

export type RowStatus = 'Matched' | 'Ambiguous' | 'Unmatched' | 'No slot' | 'New project'

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
export function buildReviewRows(transactions: UpworkTransaction[], projects: Project[]): ReviewRow[] {
  const workingInvoices = new Map<number, Invoice[]>()
  const getWorking = (project: Project): Invoice[] => {
    if (!workingInvoices.has(project.id)) workingInvoices.set(project.id, project.invoices.map(inv => ({ ...inv })))
    return workingInvoices.get(project.id)!
  }
  const distinctUpworkNames = [...new Set(projects.map(p => (p.upworkName || '').trim()).filter(Boolean))]

  return transactions.map(tx => {
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
