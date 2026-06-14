export type Invoice = {
  num: string
  date: string
  amt: number
  due: string
  paid: string
  net: number
  fee: number
}

export type Allocation = {
  J: number; M: number; N: number; A: number; G: number; S: number
}

export type Project = {
  id: number
  newrep: string
  month: string
  channel: string
  type: string
  client: string
  bm: string
  complexity: string
  contact: string
  country: string
  email: string
  date: string
  amount: number
  billing: string
  alloc: Allocation
  desc: string
  invoices: Invoice[]
}

export const SAMPLE_PROJECTS: Project[] = [
  {id:1,newrep:'New',month:'Jan 2025',channel:'UW',type:'FM',client:'Sanctuary',bm:'Marketplace',complexity:'Wizard+',contact:'Jeanne Anderson',country:'US',email:'',date:'01/02/2025',amount:1500,billing:'Upwork',alloc:{J:10,M:40,N:20,A:0,G:30,S:0},desc:'',invoices:[{num:'770653999',date:'01/19/2025',amt:500,due:'',paid:'01/19/2025',net:450,fee:50},{num:'779430780',date:'02/16/2025',amt:1000,due:'',paid:'02/16/2025',net:900,fee:100}]},
  {id:2,newrep:'Repeat',month:'Jan 2025',channel:'UW',type:'FM',client:'CornerstoneMD',bm:'Health Clinic',complexity:'Wizard+',contact:'Logan Ferrie',country:'US',email:'logan@wellbridgehealth.co',date:'01/07/2025',amount:800,billing:'Upwork',alloc:{J:0,M:40,N:30,A:0,G:30,S:0},desc:'',invoices:[{num:'773407570',date:'01/29/2025',amt:800,due:'',paid:'01/29/2025',net:720,fee:80}]},
  {id:3,newrep:'New',month:'Jan 2025',channel:'UW',type:'FM',client:'Advisory (Robin)',bm:'Advisory',complexity:'',contact:'Robin Van Lingen',country:'UK',email:'',date:'01/10/2025',amount:75,billing:'Upwork',alloc:{J:0,M:70,N:30,A:0,G:0,S:0},desc:'',invoices:[{num:'769296910',date:'01/15/2025',amt:75,due:'',paid:'01/15/2025',net:67.50,fee:7.50}]},
  {id:4,newrep:'New',month:'Jan 2025',channel:'UW',type:'FM',client:'Advisory (Ugochukwu)',bm:'Advisory',complexity:'',contact:'Ugochukwu Umeh',country:'US',email:'',date:'01/10/2025',amount:75,billing:'Upwork',alloc:{J:0,M:70,N:30,A:0,G:0,S:0},desc:'',invoices:[{num:'775270509',date:'01/03/2025',amt:75,due:'',paid:'01/03/2025',net:67.50,fee:7.50}]},
  {id:5,newrep:'Repeat',month:'Jan 2025',channel:'UW',type:'FM Update',client:'Intend',bm:'Bespoke',complexity:'Complex',contact:'Celina Pena',country:'UK',email:'',date:'01/12/2025',amount:1400,billing:'Upwork',alloc:{J:0,M:70,N:30,A:0,G:0,S:0},desc:'Summary tabs, staffing flexibility, MMCIF fixes',invoices:[{num:'777865065',date:'02/13/2025',amt:1400,due:'',paid:'02/13/2025',net:1260,fee:140}]},
  {id:6,newrep:'New',month:'Jan 2025',channel:'UW',type:'FM',client:'AILF',bm:'Consulting',complexity:'Wizard+',contact:'Lisa Yerebakan',country:'US',email:'',date:'01/14/2025',amount:1000,billing:'Upwork',alloc:{J:0,M:70,N:30,A:0,G:0,S:0},desc:'',invoices:[{num:'777159550',date:'02/09/2025',amt:1000,due:'',paid:'02/09/2025',net:900,fee:100}]},
  {id:7,newrep:'New',month:'Jan 2025',channel:'UW',type:'FM',client:'RadiCath',bm:'Med Hardware',complexity:'Wizard+',contact:'Robin Van Lingen',country:'US',email:'',date:'01/14/2025',amount:2000,billing:'Upwork',alloc:{J:0,M:40,N:30,A:0,G:30,S:0},desc:'Radial catheter partner development model',invoices:[{num:'777590262',date:'02/11/2025',amt:500,due:'',paid:'02/11/2025',net:450,fee:50},{num:'784171937',date:'03/04/2025',amt:1500,due:'',paid:'03/04/2025',net:1350,fee:150}]},
]

export function paymentStatus(p: Project): 'Fully paid' | 'Partial' | 'Unpaid' {
  const paid = p.invoices.reduce((s, inv) => s + (inv.paid ? inv.amt : 0), 0)
  if (paid >= p.amount) return 'Fully paid'
  if (paid > 0) return 'Partial'
  return 'Unpaid'
}

export function totalNetReceived(p: Project): number {
  return p.invoices.reduce((s, inv) => s + (inv.net || 0), 0)
}

export function remainingBalance(p: Project): number {
  const paid = p.invoices.reduce((s, inv) => s + (inv.paid ? inv.amt : 0), 0)
  return Math.max(0, p.amount - paid)
}

export function fmt(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const ALLOC_COLORS: Record<string, string> = {
  J: '#534AB7', M: '#1D9E75', N: '#D85A30', A: '#D4537E', G: '#378ADD', S: '#888780'
}
