# fa-portal

FlowAccount MCP Server — automate Thai accounting documents (purchase orders, invoices, billing notes, withholding tax) through any MCP-compatible client.

## Setup

### 1. Install

```bash
# From npm (once published)
npm install -g fa-portal

# Or clone and build locally
git clone <repo-url> && cd fa-portal
npm install
npm run build
```

### 2. Install Playwright browser

```bash
npx playwright install chromium
```

### 3. First-time login

The server authenticates by opening a browser to FlowAccount's login page and capturing the session token. On first run, you need a visible browser:

```bash
FA_HEADLESS=false npx fa-portal
```

Log in to FlowAccount in the browser window. The token is saved to `~/.fa-portal/token.json` and reused for 22 hours.

### 4. Configure your MCP client

#### Claude Desktop / Claude Code

Add to your MCP settings (`claude_desktop_config.json` or `.claude.json`):

```json
{
  "mcpServers": {
    "flowaccount": {
      "command": "npx",
      "args": ["fa-portal"],
      "env": {
        "FA_HEADLESS": "true"
      }
    }
  }
}
```

Or if installed from a local path:

```json
{
  "mcpServers": {
    "flowaccount": {
      "command": "node",
      "args": ["/absolute/path/to/fa-portal/dist/index.js"],
      "env": {
        "FA_HEADLESS": "true"
      }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FA_HEADLESS` | `true` | Set to `false` to show browser during login |

## Available Tools

| Tool | Description |
|---|---|
| `check_session` | Check if session is active |
| `refresh_session` | Force re-login |
| `search_contacts` | Search contacts by name |
| `list_purchase_orders` | List purchase orders (ใบสั่งซื้อ) |
| `get_purchase_order` | Get purchase order by ID |
| `create_purchase_order` | Create purchase order |
| `list_billing_notes` | List billing notes (ใบวางบิล) |
| `get_billing_note` | Get billing note by ID |
| `create_billing_note` | Create billing note |
| `list_tax_invoices` | List tax invoices (ใบกำกับภาษี) |
| `get_tax_invoice` | Get tax invoice by ID |
| `create_tax_invoice` | Create tax invoice |
| `list_cash_invoices` | List cash invoices (ใบเสร็จรับเงิน) |
| `create_cash_invoice` | Create cash invoice |
| `list_withholding_tax` | List WHT certificates (ใบหัก ณ ที่จ่าย) |
| `get_withholding_tax` | Get WHT certificate by ID |
| `create_withholding_tax` | Create WHT certificate |
| `attach_file` | Attach file to document |
| `fa_raw_get` | Raw GET for debugging |

## Token Storage

Session tokens are encrypted at rest (AES-256-GCM with a machine-derived key) and stored at `~/.fa-portal/token.json` with `600` permissions. Tokens are valid for 22 hours. The server automatically opens a browser for re-login when the token expires.

The encryption key is derived from the local machine identity (hostname + username), so the token file cannot be decrypted on a different machine.
