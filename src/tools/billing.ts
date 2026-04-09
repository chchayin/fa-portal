import { faGet, faPost } from '../client.js'
import { CommonDocFields, buildListParams, buildFullDoc } from './document.js'

export type { LineItem } from './document.js'

const BILLING_BASE = '/api/th/billing-notes'
const TAX_BASE = '/api/th/tax-invoices'
const CASH_BASE = '/api/th/cash-invoices'

// ─── Billing Notes (ใบวางบิล) ─────────────────────────────────────────

export async function listBillingNotes(params: Parameters<typeof buildListParams>[0]) {
  return faGet(BILLING_BASE, buildListParams(params))
}

export async function getBillingNote(id: string | number) {
  return faGet(`${BILLING_BASE}/${id}`)
}

export async function createBillingNote(fields: CommonDocFields) {
  const doc = await buildFullDoc(5, BILLING_BASE, 3, fields)
  return faPost(BILLING_BASE, doc)
}

// ─── Tax Invoices (ใบกำกับภาษี) ──────────────────────────────────────

export async function listTaxInvoices(params: Parameters<typeof buildListParams>[0]) {
  return faGet(TAX_BASE, buildListParams(params))
}

export async function getTaxInvoice(id: string | number) {
  return faGet(`${TAX_BASE}/${id}`)
}

export async function createTaxInvoice(fields: CommonDocFields) {
  const doc = await buildFullDoc(2, TAX_BASE, 3, fields)
  return faPost(TAX_BASE, doc)
}

// ─── Cash Invoices (ใบเสร็จรับเงิน) ─────────────────────────────────

export async function listCashInvoices(params: Parameters<typeof buildListParams>[0]) {
  return faGet(CASH_BASE, buildListParams(params))
}

export async function createCashInvoice(fields: CommonDocFields) {
  const doc = await buildFullDoc(3, CASH_BASE, 3, fields)
  return faPost(CASH_BASE, doc)
}
