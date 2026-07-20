import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

// Best-effort processing-fee lookup for a paid invoice, via its InvoicePayment -> Charge ->
// BalanceTransaction chain. Stripe's expand depth limits mean this needs its own calls rather
// than a single deep `expand` on the invoices.list call. Never throws — callers get 0 on failure,
// and the Stripe Fee field stays manually editable in the review UI either way.
async function lookupFee(stripe: Stripe, invoiceId: string): Promise<number> {
  try {
    const payments = await stripe.invoicePayments.list({
      invoice: invoiceId,
      status: 'paid',
      expand: ['data.payment.charge.balance_transaction'],
    })
    const payment = payments.data[0]?.payment
    if (!payment) return 0

    if (payment.type === 'charge' && payment.charge && typeof payment.charge !== 'string') {
      const bt = payment.charge.balance_transaction
      if (bt && typeof bt !== 'string') return bt.fee / 100
    } else if (payment.type === 'payment_intent' && payment.payment_intent) {
      const piId = typeof payment.payment_intent === 'string' ? payment.payment_intent : payment.payment_intent.id
      const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge.balance_transaction'] })
      const charge = pi.latest_charge
      if (charge && typeof charge !== 'string') {
        const bt = charge.balance_transaction
        if (bt && typeof bt !== 'string') return bt.fee / 100
      }
    }
  } catch (err) {
    console.error('[stripe] fee lookup failed for', invoiceId, err instanceof Error ? err.message : err)
  }
  return 0
}

export async function POST(req: NextRequest) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
    const { since } = await req.json()
    if (!since) {
      return NextResponse.json({ error: 'since (ISO date) is required' }, { status: 400 })
    }
    const gte = Math.floor(new Date(since).getTime() / 1000)
    if (!Number.isFinite(gte)) {
      return NextResponse.json({ error: 'since must be a valid date' }, { status: 400 })
    }

    const invoices: Stripe.Invoice[] = []
    for await (const invoice of stripe.invoices.list({
      status: 'paid',
      created: { gte },
      expand: ['data.customer'],
      limit: 100,
    })) {
      invoices.push(invoice)
    }

    const results = await Promise.all(invoices.map(async (invoice) => {
      const customer = invoice.customer && typeof invoice.customer !== 'string' && !('deleted' in invoice.customer)
        ? invoice.customer
        : null
      const fee = await lookupFee(stripe, invoice.id!)
      const paidAtSec = invoice.status_transitions?.paid_at
      return {
        id: invoice.id!,
        number: invoice.number || '',
        customerEmail: customer?.email || '',
        customerName: customer?.name || '',
        description: invoice.description || '',
        amount: invoice.amount_paid / 100,
        fee,
        paidAt: paidAtSec ? new Date(paidAtSec * 1000).toISOString().slice(0, 10) : '',
        hostedInvoiceUrl: invoice.hosted_invoice_url || '',
      }
    }))

    return NextResponse.json(results)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[stripe] list-invoices error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
