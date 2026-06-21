import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

export async function POST(req: NextRequest) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
    const { clientEmail, clientName, contactName, amount, description } = await req.json()
    console.log('[stripe] received:', { clientEmail, clientName, contactName, amount, description })

    if (!clientEmail || !amount) {
      return NextResponse.json({ error: 'clientEmail and amount are required' }, { status: 400 })
    }

    // Find or create customer, always sync name and contact metadata
    console.log('[stripe] looking up customer:', clientEmail)
    const existing = await stripe.customers.list({ email: clientEmail, limit: 1 })
    let customer: Stripe.Customer
    if (existing.data.length > 0) {
      console.log('[stripe] updating existing customer:', existing.data[0].id)
      customer = await stripe.customers.update(existing.data[0].id, {
        name: clientName || undefined,
        metadata: { contact: contactName || '' },
      })
    } else {
      console.log('[stripe] creating new customer:', clientEmail)
      customer = await stripe.customers.create({
        email: clientEmail,
        name: clientName || undefined,
        metadata: { contact: contactName || '' },
      })
    }
    console.log('[stripe] customer ready:', customer.id)

    // Create draft invoice
    console.log('[stripe] creating invoice for customer:', customer.id)
    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: 'send_invoice',
      days_until_due: 30,
      description: description || undefined,
    })
    console.log('[stripe] invoice created:', invoice.id)

    // Add line item
    console.log('[stripe] creating invoice item, amount cents:', Math.round(amount * 100))
    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: invoice.id,
      amount: Math.round(amount * 100),
      currency: 'usd',
      description: description || undefined,
    })
    console.log('[stripe] invoice item created')

    const invoiceUrl = `https://dashboard.stripe.com/invoices/${invoice.id}`
    console.log('[stripe] done:', { invoiceId: invoice.id, invoiceUrl })
    return NextResponse.json({ invoiceId: invoice.id, invoiceUrl })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[stripe] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
