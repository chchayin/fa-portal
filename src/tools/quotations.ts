import { faGet, faPost } from '../client.js'
import { CommonDocFields, buildListParams, toDocDate, buildFullDoc } from './document.js'

const BASE = '/api/th/quotations'

export async function listQuotations(params: Parameters<typeof buildListParams>[0]) {
  return faGet(BASE, buildListParams(params))
}

export async function getQuotation(id: string | number) {
  return faGet(`${BASE}/${id}`)
}

export async function createQuotation(fields: CommonDocFields & { creditDays?: number }) {
  // Default dueDate = publishedOn + creditDays (default 30)
  const creditDays = fields.creditDays ?? 30
  let dueDate = fields.dueDate
  if (!dueDate) {
    const base = fields.publishedOn ? new Date(fields.publishedOn) : new Date()
    base.setDate(base.getDate() + creditDays)
    dueDate = base.toISOString().slice(0, 10)
  }

  const doc = await buildFullDoc(3, BASE, 3, { ...fields, dueDate }, { creditDays })
  return faPost(BASE, doc)
}
