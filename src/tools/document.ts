/**
 * Shared utilities for FlowAccount document creation.
 */

// ─── Line Item ────────────────────────────────────────────────────────

export interface LineItem {
  name: string
  description?: string
  quantity: number
  pricePerUnit: number
  unitName?: string
  vatRate?: number // 0 or 7
}

export function buildItems(items: LineItem[]) {
  return items.map((item, i) => ({
    no: i,
    name: item.name,
    description: item.description ?? null,
    quantity: item.quantity,
    pricePerUnit: item.pricePerUnit,
    total: item.quantity * item.pricePerUnit,
    unitName: item.unitName ?? 'ชิ้น',
    vatRate: item.vatRate ?? 7,
    productDiscountTypes: 1,
    documentWithholdingTaxType: 1,
    discountPerItem: 0,
    discountPerItemValue: 0,
    withHeldPerItem: 0,
    withHeldPerItemValue: 0,
    productMasterId: 0,
    type: 1,
    unitId: 0,
    expenseCategoryId: 0,
    sellChartOfAccountId: 0,
    buyChartOfAccountId: 0,
  }))
}

// ─── Totals (single pass) ─────────────────────────────────────────────

export function calculateTotals(productItems: ReturnType<typeof buildItems>) {
  let subTotal = 0
  let vatAmount = 0
  let hasVat = false
  for (const item of productItems) {
    subTotal += item.total
    if (item.vatRate > 0) {
      vatAmount += Math.round(item.total * item.vatRate) / 100
      hasVat = true
    }
  }
  return {
    subTotal,
    vatAmount,
    grandTotal: subTotal + vatAmount,
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
  note?: string          // โน้ตภายในบริษัท (internal note)
  remarks?: string       // หมายเหตุ (external note shown on printed document)
  reference?: string
  publishedOn?: string
  dueDate?: string
  projectId?: number
  salesId?: number
  showSignatureOrStamp?: boolean
}
