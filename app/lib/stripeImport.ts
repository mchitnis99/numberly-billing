import { Project, Invoice } from './data'
import { emptyInvoice, nextInvoiceSlot, deriveMonth, suggestNameMatch, FuzzySuggestion } from './importShared'

export type StripeInvoiceTx = {
  id: string
  number: string
  customerEmail: string
  customerName: string
  description: string
  amount: number
  fee: number
  paidAt: string // "YYYY-MM-DD"
  hostedInvoiceUrl: string
}

export type MatchStatus = 'matched' | 'ambiguous' | 'new' | 'unmatched'

// Matches on billing email + month together, mirroring matchProjectsByNameAndMonth in
// upworkImport.ts. A same-client project in a different month is not "ambiguous" — it just means
// there's no project for this month yet, so it falls through to 'new'.
export function matchProjectsByEmailAndMonth(email: string, month: string, projects: Project[]): { status: MatchStatus; candidates: Project[] } {
  const key = email.trim().toLowerCase()
  if (!key) return { status: 'unmatched', candidates: [] }
  const matches = projects.filter(p => (p.email || '').trim().toLowerCase() === key && p.month === month)
  if (matches.length === 1) return { status: 'matched', candidates: matches }
  if (matches.length > 1) return { status: 'ambiguous', candidates: matches }
  return { status: 'new', candidates: [] }
}

export function buildShellProject(tx: StripeInvoiceTx): Project {
  const month = deriveMonth(tx.paidAt)
  return {
    id: 0,
    newrep: 'New',
    month,
    channel: 'Stripe',
    delivery: 'FM',
    startup: tx.customerName || tx.customerEmail,
    modelDesc: '',
    soldBy: '',
    alloc: { J: 0, M: 0, N: 0, A: 0, G: 0, S: 0 },
    description: tx.description,
    upworkName: '',
    country: 'US',
    contact: tx.customerName,
    email: tx.customerEmail,
    date: tx.paidAt,
    amount: tx.amount,
    billingThru: 'Stripe',
    invoicingValue: '',
    billingDetails: '',
    readyForBilling: false,
    badDebt: false,
    done: false,
    importedBalance: 0,
    importedData: false,
    notes: '',
    invoices: [{
      ...emptyInvoice(), num: tx.number, amt: tx.amount, stripeFee: tx.fee, net: tx.amount - tx.fee,
      paid: tx.paidAt, isPaid: true, stripeInvoiceId: tx.id, stripeInvoiceUrl: tx.hostedInvoiceUrl,
    }],
    stripeInvoiceId: '',
    stripeInvoiceUrl: '',
    invoicedAt: '',
  }
}

export type RowStatus = 'Matched' | 'Ambiguous' | 'Unmatched' | 'New project' | 'Already recorded'

export type ReviewRow = {
  key: string
  tx: StripeInvoiceTx
  status: RowStatus
  candidates: Project[]
  projectId: number | null
  slot: number | null
  groupKey: string | null // set for 'New project' rows — groups same client+month invoices into one shell
  suggestion: FuzzySuggestion | null // populated only for 'New project' / 'Unmatched' rows
}

// Builds review rows for the whole fetched batch in one pass, so multiple invoices that auto-match
// to the SAME existing project (e.g. two invoices paid the same month) get distinct, sequential
// invoice slots instead of colliding on the same slot.
//
// Invoices already recorded on any existing project's invoices are flagged 'Already recorded' up
// front and never re-matched — this is what makes re-running the importer over an overlapping
// date range safe. Matched two ways: by Stripe Invoice ID (`invoice.stripeInvoiceId`, set when
// this importer or "Create Stripe Invoice" wrote the row) OR by invoice number
// (`invoice.num`, e.g. "K86DCSOZ-0002") — invoices entered manually before this importer existed
// often have the right number recorded but a missing or stale stripeInvoiceId, so the ID alone
// isn't a reliable enough signal on its own.
export function buildStripeReviewRows(transactions: StripeInvoiceTx[], projects: Project[]): ReviewRow[] {
  const recordedIds = new Set(projects.flatMap(p => p.invoices.map(inv => inv.stripeInvoiceId).filter(Boolean)))
  const recordedNumbers = new Set(projects.flatMap(p => p.invoices.map(inv => inv.num).filter(Boolean)))

  const workingInvoices = new Map<number, Invoice[]>()
  const getWorking = (project: Project): Invoice[] => {
    if (!workingInvoices.has(project.id)) workingInvoices.set(project.id, project.invoices.map(inv => ({ ...inv })))
    return workingInvoices.get(project.id)!
  }
  const distinctClientNames = [...new Set(projects.map(p => (p.startup || '').trim()).filter(Boolean))]

  return transactions.map(tx => {
    if (recordedIds.has(tx.id) || (tx.number && recordedNumbers.has(tx.number))) {
      return { key: tx.id, tx, status: 'Already recorded' as RowStatus, candidates: [], projectId: null, slot: null, groupKey: null, suggestion: null }
    }

    const month = deriveMonth(tx.paidAt)
    const match = matchProjectsByEmailAndMonth(tx.customerEmail, month, projects)
    let projectId: number | null = null
    let slot: number | null = null
    let status: RowStatus
    let groupKey: string | null = null
    let suggestion: FuzzySuggestion | null = null

    if (match.status === 'matched') {
      const project = match.candidates[0]
      projectId = project.id
      const working = getWorking(project)
      slot = nextInvoiceSlot(working, tx.amount)
      while (working.length <= slot) working.push(emptyInvoice())
      // Tentatively reserve the slot so the next transaction targeting this project moves past it
      working[slot] = { ...working[slot], amt: tx.amount, paid: 'pending' }
      status = 'Matched'
    } else if (match.status === 'ambiguous') {
      status = 'Ambiguous'
    } else if (match.status === 'new') {
      status = 'New project'
      groupKey = tx.customerEmail.trim().toLowerCase() + '|' + month
      suggestion = tx.customerName ? suggestNameMatch(tx.customerName, distinctClientNames) : null
    } else {
      status = 'Unmatched'
      suggestion = tx.customerName ? suggestNameMatch(tx.customerName, distinctClientNames) : null
    }

    return { key: tx.id, tx, status, candidates: match.candidates, projectId, slot, groupKey, suggestion }
  })
}
