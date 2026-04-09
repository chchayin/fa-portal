import { faGet, faPost } from '../client.js'
import { resolveContact } from './contacts.js'
import { buildListParams, toDocDate, getNextSerial, getDefaultWarehouseId } from './document.js'

const BASE = '/api/th/withholding-taxes'

// FlowAccount internal incomeType codes (use get_withholding_tax on an existing doc to discover codes)
// Common codes observed: entity=3 (นิติบุคคล) → incomeType=27 (ค่าบริการ 3%)
// entity: 2 = บุคคลธรรมดา (ภ.ง.ด.3), 3 = นิติบุคคล (ภ.ง.ด.53)

export async function listWithholdingTax(params: Parameters<typeof buildListParams>[0]) {
  return faGet(BASE, buildListParams(params))
}

export async function getWithholdingTax(id: string | number) {
  return faGet(`${BASE}/${id}`)
}

export async function createWithholdingTax(fields: {
  contactName: string
  contactId?: number
  incomeType: number   // FlowAccount internal code e.g. 27. Use get_withholding_tax on an existing doc to find the right code.
  entity: number       // 2 = บุคคลธรรมดา (ภ.ง.ด.3), 3 = นิติบุคคล (ภ.ง.ด.53)
  amount: number
  taxRate: number
  note?: string
  remarks?: string
  publishedOn?: string
  projectId?: number
  salesId?: number
  showSignatureOrStamp?: boolean
}) {
  const [contact, documentSerial, warehouseId] = await Promise.all([
    resolveContact(fields.contactName, fields.contactId, 5),
    getNextSerial(BASE, fields.publishedOn),
    getDefaultWarehouseId(),
  ])
  const publishedOn = toDocDate(fields.publishedOn)

  // fields.amount = base amount before VAT (taxAmountNoVat)
  const r2 = (n: number) => Math.round(n * 100) / 100
  const taxAmountNoVat = fields.amount
  const taxAmount = r2(taxAmountNoVat * 1.07)       // gross including 7% VAT
  const withheld = r2(taxAmountNoVat * fields.taxRate / 100)
  const itemTotal = r2(taxAmount - withheld)         // net to pay after WHT

  return faPost(BASE, {
    isComplieAccountingRule: false,
    documentContactCompanyChangeType: 7,
    isReCalculate: false,
    documentType: 17,
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
    contactGroup: 5,
    contactBankId: 0,
    contactBankName: null,
    contactBankBranch: null,
    contactBankBranchCode: null,
    contactBankAccountName: null,
    contactBankAccountNumber: null,
    contactBankAccountType: null,
    contactQRCodeURL: '',
    publishedOn,
    dueDate: publishedOn,
    discount: 0,
    vatRate: 0,
    isDicountAsPercentage: true,
    subTotal: taxAmount,
    totalAfterDiscount: taxAmount,
    vatableAmount: taxAmountNoVat,
    exemptAmount: 0,
    total: taxAmountNoVat,
    isVat: true,
    isVatInclusive: false,
    status: 1,
    isManualVat: false,
    isManualWHT: false,
    isBatchDocument: false,
    media: [],
    entity: fields.entity,
    internalNotes: fields.note ?? null,
    remarks: fields.remarks ?? null,
    contactStateChange: false,
    companyStateChange: false,
    totalTaxWithheld: withheld,
    taxPayment: 1,
    warehouseId,
    ...(fields.projectId != null && { projectId: fields.projectId }),
    ...(fields.salesId != null && { salesId: fields.salesId }),
    ...(fields.showSignatureOrStamp != null && { showSignatureOrStamp: fields.showSignatureOrStamp }),
    withholdingTaxItems: [
      {
        no: 1,
        incomeType: fields.incomeType,
        taxType: 1,
        taxRate: fields.taxRate,
        taxAmount,
        taxAmountNoVat,
        withheld,
        total: itemTotal,
        isVatInclusive: false,
        vatType: 3,
        description: null,
      },
    ],
    productItems: [],
  })
}
