import { supabase } from './supabase'

export type Payout = {
  id: number
  member: string
  month: string
  amount: number
  note: string
}

export type DevEarning = {
  id: number
  member: string
  month: string
  amount: number
  note: string
}

export async function fetchPayouts(): Promise<Payout[]> {
  const { data, error } = await supabase.from('payouts').select('*').order('id')
  if (error) throw error
  return data as Payout[]
}

export async function upsertPayout(p: { id?: number; member: string; month: string; amount: number; note: string }): Promise<Payout> {
  const { id, ...rest } = p
  const payload = id ? { id, ...rest } : rest
  const { data, error } = await supabase
    .from('payouts')
    .upsert(payload, { onConflict: 'member,month' })
    .select()
    .single()
  if (error) throw error
  return data as Payout
}

export async function deletePayout(id: number): Promise<void> {
  const { error } = await supabase.from('payouts').delete().eq('id', id)
  if (error) throw error
}

export async function fetchDevEarnings(): Promise<DevEarning[]> {
  const { data, error } = await supabase.from('dev_earnings').select('*').order('id')
  if (error) throw error
  return data as DevEarning[]
}

export async function upsertDevEarning(d: { id?: number; member: string; month: string; amount: number; note: string }): Promise<DevEarning> {
  const { id, ...rest } = d
  const payload = id ? { id, ...rest } : rest
  const { data, error } = await supabase
    .from('dev_earnings')
    .upsert(payload, { onConflict: 'member,month' })
    .select()
    .single()
  if (error) throw error
  return data as DevEarning
}

export async function bulkUpsertPayouts(items: Omit<Payout, 'id'>[]): Promise<Payout[]> {
  if (items.length === 0) return []
  const { data, error } = await supabase
    .from('payouts')
    .upsert(items, { onConflict: 'member,month' })
    .select()
  if (error) throw error
  return data as Payout[]
}

export async function bulkUpsertDevEarnings(items: Omit<DevEarning, 'id'>[]): Promise<DevEarning[]> {
  if (items.length === 0) return []
  const { data, error } = await supabase
    .from('dev_earnings')
    .upsert(items, { onConflict: 'member,month' })
    .select()
  if (error) throw error
  return data as DevEarning[]
}
