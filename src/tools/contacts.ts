import { faGet } from '../client.js'

export interface Contact {
  id: number
  name: string
  addressLocal: string
  addressLocalLine2?: string
  addressLocalLine3?: string
  contactNumber: string | null
  taxId: string | null
  branch?: string | null
  zipCode?: string | null
  contactPerson?: string | null
  email?: string | null
}

/**
 * Search contacts by name. contactType filters:
 *   3 = customer, 5 = supplier/vendor, 7 = both
 */
export async function searchContacts(name: string, contactType: 3 | 5 | 7 = 7): Promise<Contact[]> {
  const filter =
    contactType === 7
      ? '[]'
      : JSON.stringify([
          { columnName: 'contactType', columnValue: contactType, columnPredicateOperator: 'And' },
        ])

  const res = await faGet<{ data: { list: Contact[] } }>('/api/th/contacts/search', {
    currentPage: 1,
    pageSize: 30,
    searchString: name,
    filter,
    sortBy: '[]',
  })

  return res?.data?.list ?? []
}

/**
 * Look up a contact by name, returning the first match.
 * Falls back to searching all types if the specific type returns nothing.
 */
export async function findContact(name: string, contactType: 3 | 5 | 7 = 7): Promise<Contact | null> {
  const results = await searchContacts(name, contactType)
  if (results.length > 0) return results[0]
  if (contactType !== 7) {
    const fallback = await searchContacts(name, 7)
    return fallback[0] ?? null
  }
  return null
}

/**
 * Resolve a contact for document creation.
 * - If contactId is given: search by name hint to get full data (address etc.);
 *   falls back to a stub if not found (FA backend will fill address from contactId).
 * - If only name is given: look up by name with the given type filter.
 *
 * @param type  3 = customer, 5 = supplier (default)
 */
export async function resolveContact(
  name: string,
  id: number | undefined,
  type: 3 | 5 = 5
): Promise<Contact> {
  if (id) {
    const results = await searchContacts(name, 7)
    const match = results.find(c => c.id === id)
    if (match) return match
    // Stub: FA backend will populate address from contactId
    return { id, name, addressLocal: '', contactNumber: null, taxId: null, branch: null, zipCode: null, contactPerson: null, email: null }
  }
  const contact = await findContact(name, type)
  if (!contact) {
    throw new Error(
      `Contact not found: "${name}". Use search_contacts to find the correct name or pass contactId.`
    )
  }
  return contact
}
