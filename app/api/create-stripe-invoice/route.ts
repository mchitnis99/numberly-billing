import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

export async function POST(req: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  const { clientEmail, clientName, amount, description } = await req.json()

  if (!clientEmail || !amount) {
    return NextResponse.json({ error: 'clientEmail and amount are required' }, { status: 400 })
  }

  // Find or create customer
  const existing = await stripe.customers.list({ email: clientEmail, limit: 1 })
  const customer = existing.data.length > 0
    ? existing.data[0]
    : await stripe.customers.create({ email: clientEmail, name: clientName || undefined })

  // Create draft invoice with description as memo
  const invoice = await stripe.invoices.create({
    customer: customer.id,
    collection_method: 'send_invoice',
    days_until_due: 30,
    description: description || undefined,
  })

  // Add line item
  await stripe.invoiceItems.create({
    customer: customer.id,
    invoice: invoice.id,
    amount: Math.round(amount * 100),
    currency: 'usd',
    description: description || undefined,
  })

  const invoiceUrl = `https://dashboard.stripe.com/invoices/${invoice.id}`
  return NextResponse.json({ invoiceId: invoice.id, invoiceUrl })
}
