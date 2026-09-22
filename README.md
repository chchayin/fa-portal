# fa-portal

FlowAccount MCP Server — automate Thai accounting documents (quotations, purchase orders, invoices, billing notes, withholding tax, expenses) from any MCP-compatible client.

> **This drives FlowAccount's internal web API, not a public one.** There is no published contract for these endpoints; they were reverse-engineered from the web app's own network traffic (see [API discovery](#api-discovery)). FlowAccount can change them without notice. Treat this as automation of your own browser session, and sanity-check anything financial that it produces.

## Requirements

- **macOS.** Token storage shells out to the `security` CLI (macOS Keychain). On Linux/Windows the Keychain read silently fails and the server will re-prompt for an interactive browser login on *every* start. See [Platform support](#platform-support).
- **Node.js >= 18**
- A FlowAccount account you can log into interactively.

## Setup

### 1. Clone and build

`dist/` is gitignored, so you must build after cloning:

```bash
git clone git@github.com:chchayin/fa-portal.git && cd fa-portal
npm install
npm run build
```

### 2. Install the Playwright browser

Login happens in a real Chromium window, which Playwright needs to download once:

```bash
npx playwright install chromium
```

### 3. Configure your MCP client

The repo ships a `.mcp.json` with an **absolute path that will not match your machine**. Edit it to point at your own checkout:

```json
{
  "mcpServers": {
    "flowaccount": {
      "command": "node",
      "args": ["/absolute/path/to/your/fa-portal/dist/index.js"]
    }
  }
}
```

For Claude Desktop, put the same block in `claude_desktop_config.json`.

### 4. First login

On first use the server opens a visible Chromium window pointed at FlowAccount. Log in by hand. The server watches outgoing requests, grabs the first `Bearer` token it sees, saves it to your Keychain, and closes the browser automatically.

There is no headless or scripted login, and the server stores no email or password anywhere. If the window does not appear, run the server directly to see its logs:

```bash
node dist/index.js
```

## How authentication works

```
getSession()
  ├── in-memory cache (if within TTL)
  ├── macOS Keychain      service: fa-portal, account: flowaccount-token
  └── interactive browser login → saves to Keychain
```

- Tokens are held in the **macOS Keychain**, not in a file on disk, and are never written to the repo.
- Tokens are treated as valid for **22 hours** (`SESSION_TTL_MS` in `src/auth.ts`). Anything older counts as no token at all and triggers a fresh login.
- `check_session` is **read-only** — it reports `none` / `expired` / `valid` with the token's age, and will never open a browser just because you asked for status. Use `refresh_session` to force a new login.
- Concurrent tool calls with a dead token **share a single login**; you will not get three Chromium windows racing each other.
- Any request that still comes back 401/403 triggers one automatic re-login and retry (`src/client.ts`).

### Environment variables

**None.** The server reads no configuration from the environment.

Older versions of this README documented an `FA_HEADLESS` flag and `FA_EMAIL`/`FA_PASSWORD` credentials — both are gone. Login is interactive only, and `grep process.env src/` returns nothing. If you find a stale `.env` in a checkout, it is dead weight and should be deleted.

## Available tools (26)

### Session
| Tool | Description |
|---|---|
| `check_session` | Report session state and token age (never opens a browser) |
| `refresh_session` | Force an interactive re-login |

### Contacts
| Tool | Description |
|---|---|
| `search_contacts` | Search contacts by name — **run this before creating any document** |
| `create_contact` | Create a customer / supplier / both |

### Documents
| Thai name | List | Get | Create |
|---|---|---|---|
| ใบเสนอราคา (quotation) | `list_quotations` | `get_quotation` | `create_quotation` |
| ใบสั่งซื้อ (purchase order) | `list_purchase_orders` | `get_purchase_order` | `create_purchase_order` |
| ใบวางบิล (billing note) | `list_billing_notes` | `get_billing_note` | `create_billing_note` |
| ใบกำกับภาษี (tax invoice) | `list_tax_invoices` | `get_tax_invoice` | `create_tax_invoice` |
| ใบเสร็จรับเงิน (cash invoice) | `list_cash_invoices` | — | `create_cash_invoice` |
| ใบหัก ณ ที่จ่าย (withholding tax) | `list_withholding_tax` | `get_withholding_tax` | `create_withholding_tax` |
| ค่าใช้จ่าย (expense) | `list_expenses` | `get_expense` | `create_expense` |

### Utility
| Tool | Description |
|---|---|
| `attach_file` | Upload a local PDF/image onto an existing document |
| `fa_raw_get` | Raw GET against any FlowAccount API path, for discovery and debugging |

> **List tools default to today only.** `startDate` and `endDate` both default to the current date, so older documents will not appear unless you pass an explicit range.

## Architecture

```
src/
├── auth.ts               Playwright login → Keychain → TTL + in-flight login dedup
├── client.ts             faGet/faPost/faPut/faDelete/faUpload, 401 retry
├── index.ts              MCP server: 26 tools, Zod schemas, per-call logging
└── tools/
    ├── document.ts       buildFullDoc() — the shared ~90-field payload builder
    ├── contacts.ts       search / create / resolve-for-document
    ├── quotations.ts     ┐
    ├── purchase-orders.ts├ thin wrappers: pick a documentType, pass overrides
    ├── billing.ts        ┘ (billing notes, tax invoices, cash invoices)
    ├── withholding-tax.ts  own payload (withholdingTaxItems)
    └── expenses.ts         own payload (chart-of-account IDs)
```

The heart of this is **`buildFullDoc()`** in `src/tools/document.ts`. FlowAccount's create endpoints reject partial payloads, so it reproduces the entire object the web UI POSTs. Each ordinary document type then reduces to a few lines that pick a `documentType` code and pass a couple of overrides:

| `documentType` | Document |
|---|---|
| 1 | Purchase order |
| 2 | Tax invoice |
| 3 | Quotation / cash invoice |
| 5 | Billing note |
| 13 | Expense |
| 17 | Withholding tax |

Withholding tax and expenses do not fit that mould — they carry `withholdingTaxItems` and chart-of-account IDs respectively — so they build their own payloads.

`contactType` is `3` = customer, `5` = supplier, `7` = both.

## Usage notes

**Always search for the contact first.** Pass the resulting `contactId` to the create tools rather than relying on a name match.

**Expenses need company-specific account IDs.** `expenseDebitId` and `expenseCreditId` are record IDs, not account codes like `51220`. Discover them with:

```
fa_raw_get("/api/th/expenses/categories/business")
fa_raw_get("/api/th/expenses/categories/accounting", { isCustom: "true" })
get_expense(<id>)     # inspect productItems on an existing expense
```

**Withholding tax income types are internal codes.** Call `get_withholding_tax` on an existing document and read its `incomeType`. `27` = ค่าบริการ นิติบุคคล 3%. `entity` is `2` for บุคคลธรรมดา (ภ.ง.ด.3) and `3` for นิติบุคคล (ภ.ง.ด.53).

See `CLAUDE.md` for the full field-level guidance that MCP clients read automatically.

## API discovery

`scripts/discover.ts` opens a browser, records every XHR/fetch the FlowAccount web app makes while you click around, and writes the result to `api-map.json` (gitignored — it contains your live account data).

```bash
npm run discover
```

Log in manually when the window opens, navigate to whichever screens you want to map, then close the browser. This is how every payload shape in `src/tools/` was derived, and it is the right first step when an endpoint changes or you want to add a document type.

## Platform support

Token persistence is macOS-only. `src/auth.ts` calls `security add-generic-password` / `find-generic-password`.

On Linux or Windows the server still *works* — `keychainLoad()` just returns `null` — but nothing persists, so every server start requires a fresh interactive browser login. Adding cross-platform storage means replacing the two `keychain*` functions in `src/auth.ts` with something like `keytar` or an encrypted file; nothing else in the codebase touches the Keychain.

## Development

```bash
npm run dev          # run from source via tsx
npm run build        # compile to dist/
npx tsc --noEmit     # typecheck only
```

Logging goes to **stderr** (`console.error`) because stdout is the MCP stdio transport. Never use `console.log` in this codebase — it corrupts the protocol stream.

## Security notes

- No credentials are stored by the server. Login is interactive; only the resulting bearer token is kept, in the Keychain.
- `.env`, `.token.json`, `.session.json`, and `api-map.json` are gitignored. `api-map.json` in particular contains captured API responses from your real account — do not commit or share it.
- The API base is `api-core-canary.flowaccount.com` (`FA_API_BASE` in `src/auth.ts`). That is FlowAccount's **canary** environment. Confirm that is what you want before issuing real tax documents.
