import { supabase } from './supabase'

export type Invoice = {
  num: string
  date: string
  amt: number
  due: string
  paid: string
  net: number
  uwFee: number
  stripeFee: number
}

export type Allocation = {
  J: number; M: number; N: number; A: number; G: number; S: number
}

export type Project = {
  id: number
  newrep: string
  month: string
  channel: string
  delivery: string
  startup: string
  bm: string
  modelDesc: string
  soldBy: string
  alloc: Allocation
  description: string
  upworkName: string
  country: string
  contact: string
  email: string
  date: string
  amount: number
  billingThru: string
  invoicingValue: string
  readyForBilling: boolean
  notes: string
  invoices: Invoice[]
}

export const SAMPLE_PROJECTS: Project[] = [
  {id:1,newrep:'New',month:'Jan 2025',channel:'UW',delivery:'FM',startup:'Sanctuary',bm:'Marketplace',modelDesc:'',soldBy:'M',alloc:{J:10,M:40,N:20,A:0,G:30,S:0},description:'',upworkName:'Jeanne Anderson',country:'US',contact:'Jeanne Anderson',email:'',date:'01/02/2025',amount:1500,billingThru:'Upwork',invoicingValue:'3 Milestones',readyForBilling:false,notes:'',invoices:[{num:'770653999',date:'01/19/2025',amt:500,due:'',paid:'01/19/2025',net:450,uwFee:50,stripeFee:0},{num:'779430780',date:'02/16/2025',amt:1000,due:'',paid:'02/16/2025',net:900,uwFee:100,stripeFee:0}]},
  {id:2,newrep:'Repeat',month:'Jan 2025',channel:'UW',delivery:'FM',startup:'CornerstoneMD',bm:'Health Clinic',modelDesc:'',soldBy:'M',alloc:{J:0,M:40,N:30,A:0,G:30,S:0},description:'',upworkName:'Logan Ferrie',country:'US',contact:'Logan Ferrie',email:'logan@wellbridgehealth.co',date:'01/07/2025',amount:800,billingThru:'Upwork',invoicingValue:'1 Milestone',readyForBilling:false,notes:'',invoices:[{num:'773407570',date:'01/29/2025',amt:800,due:'',paid:'01/29/2025',net:720,uwFee:80,stripeFee:0}]},
  {id:3,newrep:'New',month:'Jan 2025',channel:'UW',delivery:'FM',startup:'Advisory',bm:'Advisory',modelDesc:'',soldBy:'M',alloc:{J:0,M:70,N:30,A:0,G:0,S:0},description:'',upworkName:'Robin Van Lingen',country:'UK',contact:'Robin Van Lingen',email:'',date:'01/10/2025',amount:75,billingThru:'Upwork',invoicingValue:'100',readyForBilling:false,notes:'',invoices:[{num:'769296910',date:'01/15/2025',amt:75,due:'',paid:'01/15/2025',net:67.50,uwFee:7.50,stripeFee:0}]},
  {id:4,newrep:'New',month:'Jan 2025',channel:'UW',delivery:'FM',startup:'Advisory',bm:'Advisory',modelDesc:'',soldBy:'M',alloc:{J:0,M:70,N:30,A:0,G:0,S:0},description:'',upworkName:'Ugochukwu Umeh',country:'US',contact:'Ugochukwu Umeh',email:'',date:'01/10/2025',amount:75,billingThru:'Upwork',invoicingValue:'100',readyForBilling:false,notes:'',invoices:[{num:'775270509',date:'01/03/2025',amt:75,due:'',paid:'01/03/2025',net:67.50,uwFee:7.50,stripeFee:0}]},
  {id:5,newrep:'Repeat',month:'Jan 2025',channel:'UW',delivery:'FM Update',startup:'Intend',bm:'Bespoke',modelDesc:'',soldBy:'M',alloc:{J:0,M:70,N:30,A:0,G:0,S:0},description:'Summary tabs, staffing flexibility, MMCIF fixes',upworkName:'Celina Pena',country:'UK',contact:'Celina Pena',email:'',date:'01/12/2025',amount:1400,billingThru:'Upwork',invoicingValue:'2 Milestones',readyForBilling:false,notes:'',invoices:[{num:'777865065',date:'02/13/2025',amt:1400,due:'',paid:'02/13/2025',net:1260,uwFee:140,stripeFee:0}]},
  {id:6,newrep:'New',month:'Jan 2025',channel:'UW',delivery:'FM',startup:'AILF',bm:'Consulting',modelDesc:'',soldBy:'M',alloc:{J:0,M:70,N:30,A:0,G:0,S:0},description:'',upworkName:'Lisa Yerebakan',country:'US',contact:'Lisa Yerebakan',email:'',date:'01/14/2025',amount:1000,billingThru:'Upwork',invoicingValue:'100',readyForBilling:false,notes:'',invoices:[{num:'777159550',date:'02/09/2025',amt:1000,due:'',paid:'02/09/2025',net:900,uwFee:100,stripeFee:0}]},
  {id:7,newrep:'New',month:'Jan 2025',channel:'UW',delivery:'FM',startup:'RadiCath',bm:'Med Hardware',modelDesc:'',soldBy:'M',alloc:{J:0,M:40,N:30,A:0,G:30,S:0},description:'Radial catheter partner development model',upworkName:'Robin Van Lingen',country:'US',contact:'Robin Van Lingen',email:'',date:'01/14/2025',amount:2000,billingThru:'Upwork',invoicingValue:'100',readyForBilling:false,notes:'',invoices:[{num:'777590262',date:'02/11/2025',amt:500,due:'',paid:'02/11/2025',net:450,uwFee:50,stripeFee:0},{num:'784171937',date:'03/04/2025',amt:1500,due:'',paid:'03/04/2025',net:1350,uwFee:150,stripeFee:0}]},
]

// Shape of a row in the Supabase `projects` table (snake_case columns)
type ProjectRow = {
  id: number
  newrep: string
  month: string
  channel: string
  delivery: string
  startup: string
  bm: string
  model_desc: string
  sold_by: string
  alloc_j: number
  alloc_m: number
  alloc_n: number
  alloc_a: number
  alloc_g: number
  alloc_s: number
  description: string
  upwork_name: string
  country: string
  contact: string
  email: string
  date: string
  amount: number
  billing_thru: string
  invoicing_value: string
  ready_for_billing: boolean
  notes: string
  invoices: Invoice[]
}

function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id,
    newrep: r.newrep,
    month: r.month,
    channel: r.channel,
    delivery: r.delivery,
    startup: r.startup,
    bm: r.bm,
    modelDesc: r.model_desc,
    soldBy: r.sold_by,
    alloc: { J: r.alloc_j, M: r.alloc_m, N: r.alloc_n, A: r.alloc_a, G: r.alloc_g, S: r.alloc_s },
    description: r.description,
    upworkName: r.upwork_name,
    country: r.country,
    contact: r.contact,
    email: r.email,
    date: r.date,
    amount: r.amount,
    billingThru: r.billing_thru,
    invoicingValue: r.invoicing_value,
    readyForBilling: r.ready_for_billing,
    notes: r.notes,
    invoices: r.invoices || [],
  }
}

function projectToRow(p: Project): Omit<ProjectRow, 'id'> {
  return {
    newrep: p.newrep,
    month: p.month,
    channel: p.channel,
    delivery: p.delivery,
    startup: p.startup,
    bm: p.bm,
    model_desc: p.modelDesc,
    sold_by: p.soldBy,
    alloc_j: p.alloc.J,
    alloc_m: p.alloc.M,
    alloc_n: p.alloc.N,
    alloc_a: p.alloc.A,
    alloc_g: p.alloc.G,
    alloc_s: p.alloc.S,
    description: p.description,
    upwork_name: p.upworkName,
    country: p.country,
    contact: p.contact,
    email: p.email,
    date: p.date,
    amount: p.amount,
    billing_thru: p.billingThru,
    invoicing_value: p.invoicingValue,
    ready_for_billing: p.readyForBilling,
    notes: p.notes,
    invoices: p.invoices,
  }
}

export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from('projects').select('*').order('id')
  if (error) throw error
  return (data as ProjectRow[]).map(rowToProject)
}

// Inserts a new project, ignoring `p.id` and returning the row with its DB-assigned id
export async function insertProject(p: Project): Promise<Project> {
  const { data, error } = await supabase.from('projects').insert(projectToRow(p)).select().single()
  if (error) throw error
  return rowToProject(data as ProjectRow)
}

// Bulk insert (used for CSV import), returning rows with their DB-assigned ids
export async function insertProjects(ps: Project[]): Promise<Project[]> {
  const { data, error } = await supabase.from('projects').insert(ps.map(projectToRow)).select()
  if (error) throw error
  return (data as ProjectRow[]).map(rowToProject)
}

export async function upsertProject(p: Project): Promise<void> {
  const { error } = await supabase.from('projects').upsert({ id: p.id, ...projectToRow(p) })
  if (error) throw error
}

export async function deleteProject(id: number): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw error
}

export function paymentStatus(p: Project): 'Fully paid' | 'Partial' | 'Unpaid' {
  const paid = p.invoices.reduce((s, inv) => s + (inv.paid ? inv.amt : 0), 0)
  if (p.amount > 0 && paid >= p.amount) return 'Fully paid'
  if (paid > 0) return 'Partial'
  return 'Unpaid'
}

export function invoiceNet(inv: Invoice): number {
  return Math.max(0, (inv.amt || 0) - (inv.uwFee || 0) - (inv.stripeFee || 0))
}

export function totalNetReceived(p: Project): number {
  return p.invoices.reduce((s, inv) => s + (inv.paid ? invoiceNet(inv) : 0), 0)
}

export function remainingBalance(p: Project): number {
  const paid = p.invoices.reduce((s, inv) => s + (inv.paid ? inv.amt : 0), 0)
  return Math.max(0, p.amount - paid)
}

export function numberlyShare(p: Project): number {
  const n = p.alloc.N / 100
  return totalNetReceived(p) * (1 - n)
}

export function fmt(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const ALLOC_COLORS: Record<string, string> = {
  J: '#534AB7', M: '#1D9E75', N: '#D85A30', A: '#D4537E', G: '#378ADD', S: '#888780'
}

// CSV import — maps column headers from the Google Sheet to Project fields
export function parseCSVRow(headers: string[], row: string[]): Partial<Project> | null {
  const get = (name: string) => {
    const i = headers.findIndex(h => h.trim().toLowerCase().includes(name.toLowerCase()))
    return i >= 0 ? (row[i] || '').trim() : ''
  }
  const client = get('startup') || get('client')
  if (!client) return null

  const parseAmt = (s: string) => parseFloat(s.replace(/[$,]/g, '')) || 0

  const allocKeys = ['J%','M%','N%','A%','G%','S%']
  const alloc: Allocation = { J:0, M:0, N:0, A:0, G:0, S:0 }
  const allocMap: Record<string, keyof Allocation> = {'j%':'J','m%':'M','n%':'N','a%':'A','g%':'G','s%':'S'}
  allocKeys.forEach(k => {
    const idx = headers.findIndex(h => h.trim().toLowerCase() === k.toLowerCase())
    if (idx >= 0) {
      const key = allocMap[k.toLowerCase()]
      alloc[key] = parseFloat(row[idx]) || 0
    }
  })

  // Parse invoices
  const invoices: Invoice[] = []
  for (let i = 1; i <= 3; i++) {
    const num = get(`${i}${i===1?'st':i===2?'nd':'rd'} invoice number`) || get(`invoice number ${i}`)
    const date = get(`${i}${i===1?'st':i===2?'nd':'rd'} invoice date`) || get(`invoice date ${i}`)
    const amt = parseAmt(get(`${i}${i===1?'st':i===2?'nd':'rd'} invoice amount`) || get(`invoice amount ${i}`))
    const net = parseAmt(get(`net received stripe`) || '')
    if (amt > 0 || num) {
      invoices.push({ num: num || '', date: date || '', amt, due: '', paid: '', net, uwFee: 0, stripeFee: Math.max(0, amt - net) })
    }
  }
  if (invoices.length === 0) invoices.push({ num: '', date: '', amt: 0, due: '', paid: '', net: 0, uwFee: 0, stripeFee: 0 })

  return {
    newrep: get('new') || get('repeat') || 'New',
    month: get('month'),
    channel: get('channel'),
    delivery: get('delivery'),
    startup: client,
    bm: get('business model'),
    modelDesc: get('model description'),
    soldBy: get('sold by'),
    alloc,
    description: get('project description'),
    upworkName: get('upwork name'),
    country: get('country'),
    contact: get('contact'),
    email: get('email'),
    date: get('contract close date'),
    amount: parseAmt(get('booked amount')),
    billingThru: get('billing thru') || get('billing through'),
    invoicingValue: get('invoicing value'),
    notes: get('notes'),
    readyForBilling: false,
    invoices,
  }
}
