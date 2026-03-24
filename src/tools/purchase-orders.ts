import { faGet, faPost } from '../client.js'
import { resolveContact } from './contacts.js'
import { LineItem, CommonDocFields, buildItems, calculateTotals, buildListParams, toDocDate } from './document.js'

export type { LineItem }

const BASE = '/api/th/purchase-orders'

export async function listPurchaseOrders(params: Parameters<typeof buildListParams>[0]) {
  return faGet(BASE, buildListParams(params))
}

export async function getPurchaseOrder(id: string | number) {
  return faGet(`${BASE}/${id}`)
}

export async function createPurchaseOrder(fields: CommonDocFields) {
  const contact = await resolveContact(fields.contactName, fields.contactId, 5)
  const productItems = buildItems(fields.items)
  const { subTotal, grandTotal, docVatRate } = calculateTotals(productItems)

  return faPost(BASE, {
    documentType: 1,
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
    withHeld: -1,
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
    media: [],
    withholdingTaxItems: [{ no: 1, incomeType: 0, taxRate: -2, taxAmount: 0, total: 0, isVatInclusive: false, vatType: 3 }],
    entity: 0,
    textOther: fields.note ?? '',
    remarks: fields.remarks ?? null,
    reference: fields.reference ?? null,
    creditDays: 0,
    creditType: 1,
    isForeignBase: false,
    deductionAmount: 0,
    documentDeductionType: 0,
    paymentDeductionType: 0,
    isReverseAccrual: false,
    contactStateChange: false,
    companyStateChange: false,
    partialPaymentMethod: 1,
    partialPercent: 0,
    partialAmount: 0,
    depositAmount: 0,
    ...(fields.projectId != null && { projectId: fields.projectId }),
    ...(fields.salesId != null && { salesId: fields.salesId }),
    ...(fields.showSignatureOrStamp != null && { showSignatureOrStamp: fields.showSignatureOrStamp }),
  })
}
