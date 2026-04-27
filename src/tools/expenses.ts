import { faGet, faPost } from '../client.js'
import { resolveContact } from './contacts.js'
import { buildListParams, toDocDate, getNextSerial, getDefaultWarehouseId } from './document.js'

const BASE = '/api/th/expenses'

export async function listExpenses(params: Parameters<typeof buildListParams>[0]) {
  return faGet(BASE, buildListParams(params))
}

export async function getExpense(id: string | number) {
  return faGet(`${BASE}/${id}`)
}

export interface ExpenseItem {
  expenseDebitId: number
  expenseCreditId: number
  expenseDescription: string
  pricePerUnit: number
  quantity?: number
  vatRate?: number        // 0 or 7; omit or 0 → out-of-scope (-1 sent to API)
  withHeldPerItem?: number
  unitId?: number
  unitName?: string
}

export async function createExpense(fields: {
  contactName: string
  contactId?: number
  items: ExpenseItem[]
  publishedOn?: string
  dueDate?: string
  creditDays?: number
  expenseCategoryViewType?: number
  remarks?: string
  internalNotes?: string
  salesId?: number
  showSignatureOrStamp?: boolean
}) {
  const [contact, documentSerial, warehouseId] = await Promise.all([
    resolveContact(fields.contactName, fields.contactId, 5),
    getNextSerial(BASE, fields.publishedOn),
    getDefaultWarehouseId(),
  ])

  const productItems = fields.items.map((item, i) => {
    const qty = item.quantity ?? 1
    const hasVat = (item.vatRate ?? 0) > 0
    // API uses -1 for out-of-scope VAT, 7 for standard VAT
    const apiVatRate = hasVat ? item.vatRate! : -1
    const total = qty * item.pricePerUnit
    const inlineVat = hasVat ? Math.round(total * item.vatRate!) / 100 : 0

    return {
      no: i,
      id: null,
      description: null,
      name: null,
      productDiscountTypes: 1,
      documentWithholdingTaxType: 1,
      quantity: qty,
      vatRate: apiVatRate,
      expenseCategoryId: 0,
      expenseCategoryNameLocal: null,
      expenseCategoryNameForeign: null,
      expenseSystemCode: null,
      expenseDebitId: item.expenseDebitId,
      expenseDebitCode: null,
      expenseDebitNameLocal: null,
      expenseDebitNameForeign: null,
      expenseCreditId: item.expenseCreditId,
      expenseCreditCode: null,
      expenseCreditNameLocal: null,
      expenseCreditNameForeign: null,
      withHeldPerItem: item.withHeldPerItem ?? 0,
      withHeldPerItemValue: 0,
      discountPerItem: 0,
      discountPerItemValue: 0,
      total,
      pricePerUnit: item.pricePerUnit,
      originalPrice: 0,
      originalPriceWithVat: 0,
      isManualWithholdingTaxItem: false,
      expenseDebitCategory: 5,
      expenseCreditCategory: 2,
      expenseDescription: item.expenseDescription,
      isVat: hasVat,
      outOfScopeVat: !hasVat,
      inlineVatValue: inlineVat,
      buyChartOfAccountId: 0,
      sellChartOfAccountId: 0,
      unitId: item.unitId ?? 0,
      unitName: item.unitName ?? 'รายการ',
      reverseAccrualDescription: '',
    }
  })

  // Calculate totals
  let subTotal = 0
  let vatAmount = 0
  let withholdingTotal = 0
  for (const item of productItems) {
    subTotal += item.total
    vatAmount += item.inlineVatValue
    withholdingTotal += item.withHeldPerItem * item.quantity
  }
  const grandTotal = subTotal + vatAmount - withholdingTotal
  const hasAnyVat = vatAmount > 0

  const publishedOn = toDocDate(fields.publishedOn)
  const creditDays = fields.creditDays ?? 0
  let dueDate: string
  if (fields.dueDate) {
    dueDate = toDocDate(fields.dueDate)
  } else if (creditDays > 0) {
    const base = new Date(fields.publishedOn ?? new Date().toISOString().slice(0, 10))
    base.setDate(base.getDate() + creditDays)
    dueDate = toDocDate(base.toISOString().slice(0, 10))
  } else {
    dueDate = publishedOn
  }

  return faPost(BASE, {
    isComplieAccountingRule: false,
    documentContactCompanyChangeType: 7,
    isReCalculate: false,
    documentType: 13,
    recordId: 0,
    documentSerial,
    contactCode: null,
    contactId: contact.id,
    contactName: contact.name,
    contactAddress: contact.addressLocal ?? '',
    contactAddressLine2: null,
    contactAddressLine3: null,
    contactOriginAddress: contact.addressLocal ?? '',
    contactShippingAddress: null,
    contactNumber: contact.contactNumber ?? '',
    contactNumberOffice: null,
    contactFax: null,
    contactTaxId: contact.taxId ?? '',
    contactBranch: contact.branch ?? '',
    contactZipCode: contact.zipCode ?? '',
    contactPerson: contact.contactPerson ?? '',
    contactEmail: contact.email ?? '',
    contactGroup: 3,
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
    publishedOn,
    dueDate,
    discount: 0,
    discountPercentage: 0,
    creditDays,
    creditType: 1,
    vatRate: hasAnyVat ? 7 : 0,
    isDicountAsPercentage: true,
    productItems,
    status: 1,
    tax: 0,
    withHeld: 0,
    isManualVat: false,
    isManualWHT: false,
    isWithholding: true,
    isBatchDocument: false,
    documentDiscountTypes: 1,
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
    textOther: fields.internalNotes ?? '',
    remarks: fields.remarks ?? null,
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
    expenseCategoryViewType: fields.expenseCategoryViewType ?? 1,
    isVatInclusive: false,
    isVat: true,
    subTotal,
    discountAmount: 0,
    totalAfterDiscount: subTotal,
    vatValue: vatAmount,
    exemptAmount: hasAnyVat ? 0 : subTotal,
    vatableAmount: hasAnyVat ? subTotal : 0,
    grandTotal,
    totalExcludingVat: subTotal,
    withholdingTaxAmount: withholdingTotal,
    originalWithholdingTaxAmount: 0,
    paymentAmount: grandTotal,
    grandTotalCurrency: null,
    version: 2,
    inlineDiscountValue: 0,
    inlineVatValue: vatAmount,
    vatAmount,
    total: grandTotal,
    paymentSummaryItems: null,
    warehouseId,
    ...(fields.salesId != null && { salesId: fields.salesId }),
  })
}
