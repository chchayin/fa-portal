import { faGet, faPost } from '../client.js'
import { CommonDocFields, buildListParams, buildFullDoc } from './document.js'

export type { LineItem } from './document.js'

const BASE = '/api/th/purchase-orders'

export async function listPurchaseOrders(params: Parameters<typeof buildListParams>[0]) {
  return faGet(BASE, buildListParams(params))
}

export async function getPurchaseOrder(id: string | number) {
  return faGet(`${BASE}/${id}`)
}

export async function createPurchaseOrder(fields: CommonDocFields) {
  const doc = await buildFullDoc(1, BASE, 5, fields, {
    withHeld: -1,
    useReceiptDeduction: false,
    depositAmount: 0,
  })
  return faPost(BASE, doc)
}
