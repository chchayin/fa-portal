#!/usr/bin/env node
import 'dotenv/config'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { getSession, refreshSession } from './auth.js'
import { faGet, faUpload } from './client.js'
import { searchContacts } from './tools/contacts.js'
import {
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
} from './tools/purchase-orders.js'
import {
  listBillingNotes,
  getBillingNote,
  createBillingNote,
  listTaxInvoices,
  getTaxInvoice,
  createTaxInvoice,
  listCashInvoices,
  createCashInvoice,
} from './tools/billing.js'
import {
  listWithholdingTax,
  getWithholdingTax,
  createWithholdingTax,
} from './tools/withholding-tax.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

const server = new McpServer({
  name: 'flowaccount',
  version: pkg.version,
})

// ─── Shared Zod schemas ───────────────────────────────────────────────

const ListParams = {
  page: z.number().int().positive().optional().describe('Page number (default 1)'),
  pageSize: z.number().int().positive().max(100).optional().describe('Results per page (default 20)'),
  startDate: z.string().optional().describe('Start date YYYY-MM-DD'),
  endDate: z.string().optional().describe('End date YYYY-MM-DD'),
  search: z.string().optional().describe('Search keyword'),
}

const LineItemSchema = z.object({
  name: z.string().describe('Product / service name'),
  description: z.string().optional().describe('Additional description'),
  quantity: z.number().positive().describe('Quantity'),
  pricePerUnit: z.number().nonnegative().describe('Unit price in THB'),
  unitName: z.string().optional().describe('Unit label e.g. ชิ้น, ชั่วโมง'),
  vatRate: z.number().optional().describe('VAT rate: 0 or 7 (default 7)'),
})

// ─── Session tools ────────────────────────────────────────────────────

server.tool(
  'check_session',
  'Check if the FlowAccount session is active and valid',
  {},
  async () => {
    try {
      const session = await getSession()
      const age = Math.round((Date.now() - session.extractedAt) / 60000)
      return {
        content: [{ type: 'text', text: `✓ Session active. Bearer token present. Age: ${age} min.` }],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `✗ Session error: ${err instanceof Error ? err.message : String(err)}` }],
      }
    }
  }
)

server.tool(
  'refresh_session',
  'Force re-login to FlowAccount and refresh session cookies',
  {},
  async () => {
    try {
      await refreshSession()
      return {
        content: [{ type: 'text', text: `✓ Re-logged in. New Bearer token captured.` }],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `✗ Login failed: ${err instanceof Error ? err.message : String(err)}` }],
      }
    }
  }
)

// ─── Purchase Orders (ใบสั่งซื้อ) ─────────────────────────────────────

server.tool(
  'list_purchase_orders',
  'List purchase orders (ใบสั่งซื้อ) from FlowAccount',
  { ...ListParams, status: z.string().optional().describe('Filter by status') },
  async (args) => {
    const data = await listPurchaseOrders(args)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_purchase_order',
  'Get a single purchase order by ID',
  { id: z.string().describe('Purchase order ID') },
  async ({ id }) => {
    const data = await getPurchaseOrder(id)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_purchase_order',
  'Create a new purchase order (ใบสั่งซื้อ) in FlowAccount',
  {
    contactName: z.string().describe('Vendor / supplier name'),
    contactId: z.number().int().optional().describe('Contact ID from search_contacts — preferred over name lookup'),
    items: z.array(LineItemSchema).min(1).describe('Line items'),
    note: z.string().optional().describe('Internal note (โน้ตภายในบริษัท)'),
    remarks: z.string().optional().describe('External note on printed document (หมายเหตุ)'),
    reference: z.string().optional().describe('Reference document number e.g. LN6016774800H2'),
    publishedOn: z.string().optional().describe('Document date YYYY-MM-DD (default today)'),
    dueDate: z.string().optional().describe('Due date YYYY-MM-DD (default today)'),
    projectId: z.number().int().optional().describe('Project ID to associate this document with'),
    salesId: z.number().int().optional().describe('Sales person ID'),
    showSignatureOrStamp: z.boolean().optional().describe('Show signature/stamp on printed document'),
  },
  async (args) => {
    const data = await createPurchaseOrder(args)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

// ─── Billing Notes (ใบวางบิล) ─────────────────────────────────────────

server.tool(
  'list_billing_notes',
  'List billing notes (ใบวางบิล) from FlowAccount',
  { ...ListParams, status: z.string().optional() },
  async (args) => {
    const data = await listBillingNotes(args)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_billing_note',
  'Get a single billing note by ID',
  { id: z.string() },
  async ({ id }) => {
    const data = await getBillingNote(id)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_billing_note',
  'Create a new billing note (ใบวางบิล) in FlowAccount',
  {
    contactName: z.string().describe('Customer name'),
    contactId: z.number().int().optional().describe('Contact ID from search_contacts — preferred over name lookup'),
    items: z.array(LineItemSchema).min(1),
    dueDate: z.string().optional().describe('Due date YYYY-MM-DD'),
    publishedOn: z.string().optional().describe('Document date YYYY-MM-DD'),
    note: z.string().optional().describe('Internal note (โน้ตภายในบริษัท)'),
    remarks: z.string().optional().describe('External note on printed document (หมายเหตุ)'),
    reference: z.string().optional().describe('Reference document number'),
    projectId: z.number().int().optional().describe('Project ID to associate this document with'),
    salesId: z.number().int().optional().describe('Sales person ID'),
    showSignatureOrStamp: z.boolean().optional().describe('Show signature/stamp on printed document'),
  },
  async (args) => {
    const data = await createBillingNote(args)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

// ─── Tax Invoices (ใบกำกับภาษี) ──────────────────────────────────────

server.tool(
  'list_tax_invoices',
  'List tax invoices (ใบกำกับภาษี) from FlowAccount',
  { ...ListParams },
  async (args) => {
    const data = await listTaxInvoices(args)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_tax_invoice',
  'Get a single tax invoice by ID',
  { id: z.string() },
  async ({ id }) => {
    const data = await getTaxInvoice(id)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_tax_invoice',
  'Create a new tax invoice (ใบกำกับภาษี) in FlowAccount',
  {
    contactName: z.string().describe('Customer name'),
    contactId: z.number().int().optional().describe('Contact ID from search_contacts — preferred over name lookup'),
    items: z.array(LineItemSchema).min(1),
    dueDate: z.string().optional().describe('Due date YYYY-MM-DD'),
    publishedOn: z.string().optional().describe('Document date YYYY-MM-DD'),
    note: z.string().optional().describe('Internal note (โน้ตภายในบริษัท)'),
    remarks: z.string().optional().describe('External note on printed document (หมายเหตุ)'),
    reference: z.string().optional().describe('Reference document number'),
    projectId: z.number().int().optional().describe('Project ID to associate this document with'),
    salesId: z.number().int().optional().describe('Sales person ID'),
    showSignatureOrStamp: z.boolean().optional().describe('Show signature/stamp on printed document'),
  },
  async (args) => {
    const data = await createTaxInvoice(args)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

// ─── Cash Invoices (ใบเสร็จรับเงิน) ─────────────────────────────────

server.tool(
  'list_cash_invoices',
  'List cash invoices (ใบเสร็จรับเงิน) from FlowAccount',
  { ...ListParams },
  async (args) => {
    const data = await listCashInvoices(args)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_cash_invoice',
  'Create a new cash invoice (ใบเสร็จรับเงิน) in FlowAccount',
  {
    contactName: z.string().describe('Customer name'),
    contactId: z.number().int().optional().describe('Contact ID from search_contacts — preferred over name lookup'),
    items: z.array(LineItemSchema).min(1),
    dueDate: z.string().optional(),
    publishedOn: z.string().optional(),
    note: z.string().optional().describe('Internal note (โน้ตภายในบริษัท)'),
    remarks: z.string().optional().describe('External note on printed document (หมายเหตุ)'),
    reference: z.string().optional().describe('Reference document number'),
    projectId: z.number().int().optional().describe('Project ID to associate this document with'),
    salesId: z.number().int().optional().describe('Sales person ID'),
    showSignatureOrStamp: z.boolean().optional().describe('Show signature/stamp on printed document'),
  },
  async (args) => {
    const data = await createCashInvoice(args)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

// ─── Contacts ─────────────────────────────────────────────────────────

server.tool(
  'search_contacts',
  'Search FlowAccount contacts by name. Use this to find the exact contact name before creating documents.',
  {
    name: z.string().describe('Contact name to search'),
    contactType: z.enum(['customer', 'supplier', 'both']).optional().describe('Filter: customer, supplier, or both (default)'),
  },
  async ({ name, contactType }) => {
    const typeMap = { customer: 3, supplier: 5, both: 7 } as const
    const data = await searchContacts(name, typeMap[contactType ?? 'both'])
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

// ─── Withholding Tax (ใบหัก ณ ที่จ่าย) ──────────────────────────────

server.tool(
  'list_withholding_tax',
  'List withholding tax certificates (ใบหัก ณ ที่จ่าย) from FlowAccount',
  { ...ListParams },
  async (args) => {
    const data = await listWithholdingTax(args)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_withholding_tax',
  'Get a single withholding tax certificate by ID',
  { id: z.string() },
  async ({ id }) => {
    const data = await getWithholdingTax(id)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_withholding_tax',
  'Create a new withholding tax certificate (ใบหัก ณ ที่จ่าย). Use get_withholding_tax on an existing doc to find the correct incomeType code (e.g. 27 = ค่าบริการ นิติบุคคล 3%). entity: 2=บุคคลธรรมดา, 3=นิติบุคคล.',
  {
    contactName: z.string().describe('Vendor / payee name'),
    contactId: z.number().int().optional().describe('Contact ID from search_contacts — preferred over name lookup'),
    incomeType: z.number().int().describe('FlowAccount internal income type code (e.g. 27). Look up from an existing WHT doc.'),
    entity: z.number().int().describe('2 = บุคคลธรรมดา (ภ.ง.ด.3), 3 = นิติบุคคล (ภ.ง.ด.53)'),
    amount: z.number().positive().describe('Income amount before tax (THB)'),
    taxRate: z.number().positive().describe('Withholding tax rate % e.g. 3'),
    note: z.string().optional().describe('Internal notes (internalNotes)'),
    remarks: z.string().optional().describe('Remarks shown on document'),
    publishedOn: z.string().optional().describe('Document date YYYY-MM-DD'),
    projectId: z.number().int().optional().describe('Project ID to associate this document with'),
    salesId: z.number().int().optional().describe('Sales person ID'),
    showSignatureOrStamp: z.boolean().optional().describe('Show signature/stamp on printed document'),
  },
  async (args) => {
    const data = await createWithholdingTax(args)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

// ─── Attach file to document ──────────────────────────────────────────

const DOC_TYPE_PATH: Record<string, string> = {
  'purchase-order': 'purchase-orders',
  'billing-note': 'billing-notes',
  'tax-invoice': 'tax-invoices',
  'cash-invoice': 'cash-invoices',
  'withholding-tax': 'withholding-taxes',
}

server.tool(
  'attach_file',
  'Attach a local file (PDF, image, etc.) to an existing FlowAccount document',
  {
    documentType: z.enum(['purchase-order', 'billing-note', 'tax-invoice', 'cash-invoice', 'withholding-tax'])
      .describe('Type of document to attach the file to'),
    documentId: z.number().int().describe('Document recordId returned by the create tool'),
    filePath: z.string().describe('Absolute path to the file on disk e.g. /Users/you/Downloads/invoice.pdf'),
  },
  async ({ documentType, documentId, filePath }) => {
    const docPath = DOC_TYPE_PATH[documentType]
    const data = await faUpload(`/api/th/${docPath}/${documentId}/update-document-attachment`, filePath)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

// ─── Generic HTTP tool (for debugging / after API discovery) ─────────

server.tool(
  'fa_raw_get',
  'Make a raw GET request to a FlowAccount internal API path (useful after API discovery)',
  {
    path: z.string().describe('Path starting with / e.g. /api/th/billing-notes'),
    params: z.record(z.string(), z.string()).optional().describe('Query parameters'),
  },
  async ({ path, params }) => {
    const data = await faGet(path, params as Record<string, string>)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

// ─── Start server ─────────────────────────────────────────────────────

async function main() {
  console.error('[fa-portal] Starting FlowAccount MCP server...')

  // Pre-warm: login on startup
  try {
    await getSession()
    console.error('[fa-portal] Ready.')
  } catch (err) {
    console.error('[fa-portal] Warning: Could not pre-login:', err instanceof Error ? err.message : err)
    console.error('[fa-portal] Server will try again on first tool call.')
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[fa-portal] Fatal error:', err)
  process.exit(1)
})
