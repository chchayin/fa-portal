/**
 * Shared utilities for FlowAccount document creation.
 */

import { faGet } from '../client.js'
import { Contact, resolveContact } from './contacts.js'

// ─── Document Serial ─────────────────────────────────────────────────

/**
 * Fetch the next document serial number from FlowAccount.
 * @param basePath  API base path e.g. '/api/th/quotations'
 * @param publishedOn  Document date YYYY-MM-DD (default today)
 */
export async function getNextSerial(basePath: string, publishedOn?: string): Promise<string> {
  const date = publishedOn ?? new Date().toISOString().slice(0, 10)
  const res = await faGet<{ data: { documentSerial: string } }>(`${basePath}/documentSerial`, { publishedOn: date })
  return res?.data?.documentSerial ?? ''
}

// ─── Warehouse ───────────────────────────────────────────────────────

let cachedWarehouseId: number | null = null

export async function getDefaultWarehouseId(): Promise<number> {
  if (cachedWarehouseId != null) return cachedWarehouseId
  const res = await faGet<{ data: { list: { id: number; isMain: boolean }[] } }>('/api/th/warehouses', { PageSize: 50 })
  const main = res?.data?.list?.find(w => w.isMain)
  cachedWarehouseId = main?.id ?? res?.data?.list?.[0]?.id ?? 0
  return cachedWarehouseId
}

// ─── Line Item ────────────────────────────────────────────────────────

export interface LineItem {
  name: string
  description?: string
  quantity: number
  pricePerUnit: number
  unitName?: string
  vatRate?: number // 0 or 7
  discount?: number // percent or THB, per DiscountType
}

/** How line-item discounts are expressed. FlowAccount allows one type per document. */
export type DiscountType = 'percent' | 'amount'

// FlowAccount productDiscountTypes / documentDiscountTypes codes
const DISCOUNT_TYPE_CODE: Record<DiscountType, number> = { percent: 1, amount: 3 }

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildItems(items: LineItem[], discountType: DiscountType = 'percent') {
  return items.map((item, i) => {
    const gross = round2(item.quantity * item.pricePerUnit)
    const discount = item.discount ?? 0
    if (discount < 0) throw new Error(`Item ${i + 1} (${item.name}): discount must not be negative`)
    if (discountType === 'percent' && discount > 100) {
      throw new Error(`Item ${i + 1} (${item.name}): discount ${discount}% exceeds 100%`)
    }
    const discountValue = discountType === 'percent' ? round2(gross * discount / 100) : round2(discount)
    if (discountValue > gross) {
      throw new Error(`Item ${i + 1} (${item.name}): discount ${discountValue} exceeds line total ${gross}`)
    }
    return {
      no: i,
      name: item.name,
      description: item.description ?? null,
      quantity: item.quantity,
      pricePerUnit: item.pricePerUnit,
      total: round2(gross - discountValue), // net of discount, as FlowAccount stores it
      unitName: item.unitName ?? 'ชิ้น',
      vatRate: item.vatRate ?? 7,
      productDiscountTypes: DISCOUNT_TYPE_CODE[discountType],
      documentWithholdingTaxType: 1,
      discountPerItem: discount,
      discountPerItemValue: discountValue,
      withHeldPerItem: 0,
      withHeldPerItemValue: 0,
      productMasterId: 0,
      type: 1,
      unitId: 0,
      expenseCategoryId: 0,
      sellChartOfAccountId: 0,
      buyChartOfAccountId: 0,
    }
  })
}

// ─── Totals (single pass) ─────────────────────────────────────────────

export function calculateTotals(productItems: ReturnType<typeof buildItems>) {
  let subTotal = 0 // gross, before line discounts
  let discountTotal = 0
  let vatAmount = 0
  let hasVat = false
  for (const item of productItems) {
    subTotal += item.total + item.discountPerItemValue
    discountTotal += item.discountPerItemValue
    if (item.vatRate > 0) {
      vatAmount += Math.round(item.total * item.vatRate) / 100
      hasVat = true
    }
  }
  subTotal = round2(subTotal)
  vatAmount = round2(vatAmount)
  discountTotal = round2(discountTotal)
  const totalAfterDiscount = round2(subTotal - discountTotal)
  return {
    subTotal,
    discountTotal,
    totalAfterDiscount,
    vatAmount,
    grandTotal: round2(totalAfterDiscount + vatAmount),
    docVatRate: hasVat ? 7 : 0,
  }
}

// ─── List params ──────────────────────────────────────────────────────

export function buildListParams(params: {
  page?: number
  pageSize?: number
  startDate?: string
  endDate?: string
  search?: string
  status?: string
}) {
  const today = new Date().toISOString().slice(0, 10)
  return {
    currentPage: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
    startDate: params.startDate ?? today,
    endDate: params.endDate ?? today,
    searchString: params.search ?? '',
    filter: '[]',
    sortBy: JSON.stringify([{ name: 'documentSerial', sortOrder: 'desc' }]),
    range: 0,
    filterColumnValue: '{}',
    totalRecords: 0,
    year: 0,
    month: 0,
    advanceFilter: '',
    filterStatus: params.status ? Number(params.status) : 0,
  }
}

// ─── Date formatting ──────────────────────────────────────────────────

export function toDocDate(dateStr?: string): string {
  const d = dateStr ?? new Date().toISOString().slice(0, 10)
  return `${d}T00:00:00`
}

// ─── Common document fields (shared across all doc types) ────────────

export interface CommonDocFields {
  contactName: string
  contactId?: number
  items: LineItem[]
  discountType?: DiscountType // how items[].discount is expressed (default 'percent')
  note?: string          // โน้ตภายในบริษัท (internal note)
  remarks?: string       // หมายเหตุ (external note shown on printed document)
  reference?: string
  publishedOn?: string
  dueDate?: string
  projectId?: number
  salesId?: number
  showSignatureOrStamp?: boolean
}

// ─── Full document payload builder ───────────────────────────────────

/**
 * Build a complete FlowAccount document payload matching what the web UI sends.
 * Used by all document types except withholding tax (which has its own structure).
 *
 * @param docType   FlowAccount documentType code (1=PO, 2=TaxInv, 3=QT/CashInv, 5=Billing)
 * @param basePath  API base e.g. '/api/th/quotations'
 * @param contactType  3=customer, 5=supplier
 * @param fields    User-provided fields
 * @param overrides Extra fields specific to a doc type
 */
export async function buildFullDoc(
  docType: number,
  basePath: string,
  contactType: 3 | 5,
  fields: CommonDocFields,
  overrides?: Record<string, unknown>,
) {
  const [contact, documentSerial, warehouseId] = await Promise.all([
    resolveContact(fields.contactName, fields.contactId, contactType),
    getNextSerial(basePath, fields.publishedOn),
    getDefaultWarehouseId(),
  ])

  const discountType = fields.discountType ?? 'percent'
  const productItems = buildItems(fields.items, discountType)
  const { subTotal, discountTotal, totalAfterDiscount, grandTotal, docVatRate, vatAmount } = calculateTotals(productItems)

  return {
    isComplieAccountingRule: false,
    documentContactCompanyChangeType: 7,
    isReCalculate: false,
    documentType: docType,
    recordId: 0,
    documentSerial,
    contactCode: null,
    contactId: contact.id,
    contactName: contact.name,
    contactAddress: contact.addressLocal ?? '',
    contactAddressLine2: null,
    contactAddressLine3: null,
    contactOriginAddress: contact.addressLocal ?? '',
    contactShippingAddress: '',
    contactNumber: contact.contactNumber ?? '',
    contactNumberOffice: '',
    contactFax: '',
    contactTaxId: contact.taxId ?? '',
    contactBranch: contact.branch ?? '',
    contactZipCode: contact.zipCode ?? '',
    contactPerson: contact.contactPerson ?? '',
    contactEmail: contact.email ?? '',
    contactGroup: contactType,
    contactBankId: 0,
    contactBankName: null,
    contactBankBranch: null,
    contactBankBranchCode: null,
    contactBankAccountName: null,
    contactBankAccountNumber: null,
    contactBankAccountType: null,
    contactQRCodeURL: '',
    isForeignBase: false,
    deductionAmount: 0,
    documentDeductionType: 0,
    paymentDeductionType: 0,
    isReverseAccrual: false,
    contactStateChange: false,
    companyStateChange: false,
    publishedOn: toDocDate(fields.publishedOn),
    dueDate: toDocDate(fields.dueDate),
    discount: discountTotal,
    discountPercentage: 0,
    discountAmount: 0,
    creditDays: 0,
    creditType: 1,
    vatRate: docVatRate,
    isDicountAsPercentage: true,
    productItems,
    status: 1,
    tax: 0,
    withHeld: 0,
    isManualVat: false,
    isManualWHT: false,
    isWithholding: true,
    isBatchDocument: false,
    documentDiscountTypes: DISCOUNT_TYPE_CODE[discountType],
    documentWithholdingTaxTypes: 1,
    useInlineWithholdingTax: true,
    useInlineDiscount: true,
    useInlineVat: true,
    useReceiptDeduction: false,
    showSignatureOrStamp: fields.showSignatureOrStamp ?? true,
    media: [],
    withholdingTaxItems: [
      { no: 1, incomeType: 0, taxRate: -2, taxAmount: 0, taxAmountNoVat: 0, total: 0, isVatInclusive: false, vatType: 3, description: null },
    ],
    entity: 0,
    textOther: fields.note ?? '',
    remarks: fields.remarks ?? null,
    reference: fields.reference ?? null,
    partialPaymentMethod: 1,
    partialPercent: 0,
    partialAmount: 0,
    depositAmount: 0,
    isDeposit: false,
    isMigrate: false,
    exchangeRateFee: 0,
    isETaxEmailSent: false,
    eTaxEmailStatus: 0,
    eTaxEmailSendDate: null,
    paymentDebitId: null,
    isUpgradeFromCN: false,
    paymentInfo: null,
    paymentInfoMetadata: null,
    usedEWHT: false,
    isMultiPayment: false,
    taxInfoList: null,
    eTaxStatus: 0,
    eTaxDocumentEmailStatus: 0,
    eTaxDocumentEmailSendDate: null,
    depositDocumentType: 0,
    expenseCategoryViewType: 3,
    isVatInclusive: false,
    isVat: true,
    subTotal,
    totalAfterDiscount,
    vatValue: vatAmount,
    exemptAmount: 0,
    vatableAmount: totalAfterDiscount,
    vatAmount,
    grandTotal,
    totalExcludingVat: totalAfterDiscount,
    total: grandTotal,
    inlineDiscountValue: discountTotal,
    inlineVatValue: vatAmount,
    withholdingTaxAmount: 0,
    originalWithholdingTaxAmount: 0,
    paymentAmount: 0,
    grandTotalCurrency: null,
    version: 2,
    warehouseId,
    paymentSummaryItems: null,
    ...(fields.projectId != null && { projectId: fields.projectId }),
    ...(fields.salesId != null && { salesId: fields.salesId }),
    ...overrides,
  }
}
