# FlowAccount MCP Server — Usage Guide

You have access to a FlowAccount (Thai cloud accounting) MCP server called `flowaccount`. Use these tools to manage Thai accounting documents.

## Session

- Always start by calling `check_session` to verify the session is active.
- If the session is expired or errors, call `refresh_session` — a browser window will open for the user to log in manually.

## Contact Lookup (IMPORTANT)

Before creating any document, **always search for the contact first** using `search_contacts` to get the correct `contactId`. Pass `contactId` to create tools — this is more reliable than name-only lookup.

- `search_contacts(name, contactType?)` — contactType: `customer`, `supplier`, or `both` (default)
- If the user gives a partial name, search for it and confirm the match before proceeding.

## Document Types

| Thai Name | Tool Prefix | Use Case |
|-----------|-------------|----------|
| ใบเสนอราคา | `*_quotation*` | Quotations to customers |
| ใบสั่งซื้อ | `*_purchase_order*` | Purchase orders to suppliers/vendors |
| ใบวางบิล | `*_billing_note*` | Billing notes to customers |
| ใบกำกับภาษี | `*_tax_invoice*` | Tax invoices (VAT invoices) to customers |
| ใบเสร็จรับเงิน | `*_cash_invoice*` | Cash invoices / receipts to customers |
| ใบหัก ณ ที่จ่าย | `*_withholding_tax*` | Withholding tax certificates |

## Common Workflow

### Listing documents
All list tools accept: `page`, `pageSize` (max 100), `startDate`, `endDate` (YYYY-MM-DD), `search`.

**Note:** `startDate` and `endDate` default to today. To see older documents, explicitly pass a date range.

### Creating documents (PO, billing, tax invoice, cash invoice)

Required fields:
- `contactName` — vendor/customer name (must exist in FlowAccount)
- `contactId` — preferred; get from `search_contacts`
- `items` — array of line items, each with:
  - `name` (string) — product/service name
  - `quantity` (number)
  - `pricePerUnit` (number, THB)
  - Optional: `description`, `unitName` (default: "ชิ้น"), `vatRate` (0 or 7, default: 7)

Optional fields: `publishedOn`, `dueDate` (YYYY-MM-DD), `note` (internal), `remarks` (printed on doc), `reference`, `projectId`, `salesId`, `showSignatureOrStamp`

**Quotation-specific**: `creditDays` (default 30). The `dueDate` defaults to `publishedOn + creditDays` if not explicitly set.

### Creating withholding tax (ใบหัก ณ ที่จ่าย)

This is different from other documents:
- `entity`: `2` = บุคคลธรรมดา (ภ.ง.ด.3), `3` = นิติบุคคล (ภ.ง.ด.53)
- `incomeType`: FlowAccount internal code. **To find the right code**, call `get_withholding_tax` on an existing WHT document and look at its `incomeType` field. Common: `27` = ค่าบริการ นิติบุคคล 3%.
- `amount`: base amount before VAT
- `taxRate`: WHT rate % (e.g. 3)
- The system auto-calculates: gross = amount × 1.07, withheld = amount × taxRate%

### Attaching files

Use `attach_file` to upload PDF/images to an existing document:
- `documentType`: `quotation`, `purchase-order`, `billing-note`, `tax-invoice`, `cash-invoice`, `withholding-tax`
- `documentId`: the `recordId` returned when creating the document
- `filePath`: absolute path to the file on disk

### Debugging

`fa_raw_get(path, params?)` — make raw GET requests to the FlowAccount API for discovery/debugging.

## Best Practices

1. **Always search contacts first** — don't guess contact names.
2. **Set date ranges when listing** — default is today only, so older docs won't appear without explicit dates.
3. **Use contactId over contactName** — more reliable, avoids ambiguity.
4. **For WHT income types** — inspect an existing WHT doc first to get the correct code.
5. **Confirm with the user** before creating any document — show them the details (contact, items, amounts) and ask for confirmation.
6. **Respond in Thai** when the user writes in Thai.
