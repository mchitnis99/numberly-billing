import { Invoice } from './data'

const MONTH_ORDER = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

// Normalizes a raw CSV/API date into the app's existing MM/DD/YYYY invoice-date format.
export function formatDateMDY(raw: string): string {
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

// Derives a "Mon YYYY" month string from a raw date, matching project.month's format.
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

export type FuzzySuggestion = { name: string; score: number }

// Best fuzzy match for `name` among `candidateNames`, above `threshold`.
// Exact matches (after normalizing) are excluded — those represent the same client under a
// different key (e.g. different month), which is expected/intentional, not a typo worth flagging.
export function suggestNameMatch(name: string, candidateNames: string[], threshold: number = FUZZY_MATCH_THRESHOLD): FuzzySuggestion | null {
  let best: FuzzySuggestion | null = null
  for (const candidate of candidateNames) {
    const score = nameSimilarity(name, candidate)
    if (score >= 1) continue
    if (!best || score > best.score) best = { name: candidate, score }
  }
  return best && best.score >= threshold ? best : null
}
