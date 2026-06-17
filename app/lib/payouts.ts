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

export async function upsertPayout({ id: _id, ...rest }: { id?: number; member: string; month: string; amount: number; note: string }): Promise<Payout> {
  const { data, error } = await supabase
    .from('payouts')
    .upsert(rest, { onConflict: 'member,month' })
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

export async function upsertDevEarning({ id: _id, ...rest }: { id?: number; member: string; month: string; amount: number; note: string }): Promise<DevEarning> {
  const { data, error } = await supabase
    .from('dev_earnings')
    .upsert(rest, { onConflict: 'member,month' })
    .select()
    .single()
  if (error) throw error
  return data as DevEarning
}
