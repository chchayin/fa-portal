import { faGet, faPost } from '../client.js'
import { resolveContact } from './contacts.js'
import { LineItem, CommonDocFields, buildItems, calculateTotals, buildListParams, toDocDate } from './document.js'

export type { LineItem }

const BILLING_BASE = '/api/th/billing-notes'
const TAX_BASE = '/api/th/tax-invoices'
const CASH_BASE = '/api/th/cash-invoices'

async function buildDoc(docType: number, fields: CommonDocFields) {
  const contact = await resolveContact(fields.contactName, fields.contactId, 3)
  const productItems = buildItems(fields.items)
  const { subTotal, grandTotal, docVatRate } = calculateTotals(productItems)

  return {
    documentType: docType,
    recordId: 0,
    isComplieAccountingRule: false,
    documentContactCompanyChangeType: 7,
    isReCalculate: true,
    contactId: contact.id,
    contactName: contact.name,
    contactAddress: contact.addressLocal ?? '',
    contactOriginAddress: contact.addressLocal ?? '',
    contactTaxId: contact.taxId ?? '',
    contactBranch: contact.branch ?? '',
    contactZipCode: contact.zipCode ?? '',
    contactPerson: contact.contactPerson ?? '',
    contactEmail: contact.email ?? '',
    publishedOn: toDocDate(fields.publishedOn),
    dueDate: toDocDate(fields.dueDate),
    discount: 0,
    discountPercentage: 0,
    vatRate: docVatRate,
    isDicountAsPercentage: true,
    productItems,
    status: 1,
    subTotal,
    totalAfterDiscount: subTotal,
    vatableAmount: subTotal,
    exemptAmount: 0,
    total: grandTotal,
    isVat: true,
    isVatInclusive: false,
    tax: 0,
    isManualVat: false,
    isManualWHT: false,
    isBatchDocument: false,
    documentDiscountTypes: 1,
    documentWithholdingTaxTypes: 1,
    useInlineWithholdingTax: true,
    useInlineDiscount: true,
    useInlineVat: true,
    media: [],
    entity: 0,
    textOther: fields.note ?? '',
    remarks: fields.remarks ?? null,
    reference: fields.reference ?? null,
    creditDays: 0,
    creditType: 1,
    contactStateChange: false,
    companyStateChange: false,
    ...(fields.projectId != null && { projectId: fields.projectId }),
    ...(fields.salesId != null && { salesId: fields.salesId }),
    ...(fields.showSignatureOrStamp != null && { showSignatureOrStamp: fields.showSignatureOrStamp }),
  }
}

// ─── Billing Notes (ใบวางบิล) ─────────────────────────────────────────

export async function listBillingNotes(params: Parameters<typeof buildListParams>[0]) {
  return faGet(BILLING_BASE, buildListParams(params))
}

export async function getBillingNote(id: string | number) {
  return faGet(`${BILLING_BASE}/${id}`)
}

export async function createBillingNote(fields: CommonDocFields) {
  return faPost(BILLING_BASE, await buildDoc(5, fields))
}

// ─── Tax Invoices (ใบกำกับภาษี) ──────────────────────────────────────

export async function listTaxInvoices(params: Parameters<typeof buildListParams>[0]) {
  return faGet(TAX_BASE, buildListParams(params))
}

export async function getTaxInvoice(id: string | number) {
  return faGet(`${TAX_BASE}/${id}`)
}

export async function createTaxInvoice(fields: CommonDocFields) {
  return faPost(TAX_BASE, await buildDoc(2, fields))
}

// ─── Cash Invoices (ใบเสร็จรับเงิน) ─────────────────────────────────

export async function listCashInvoices(params: Parameters<typeof buildListParams>[0]) {
  return faGet(CASH_BASE, buildListParams(params))
}

export async function createCashInvoice(fields: CommonDocFields) {
  return faPost(CASH_BASE, await buildDoc(3, fields))
}
