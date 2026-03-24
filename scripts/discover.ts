/**
 * FlowAccount API Discovery Script
 *
 * Run with: npm run discover
 *
 * This script opens a visible browser, logs into FlowAccount,
 * then intercepts all XHR/fetch requests while you navigate.
 * Results are saved to api-map.json for use in building tool handlers.
 *
 * Steps:
 * 1. Make sure .env has FA_EMAIL and FA_PASSWORD
 * 2. Run: npm run discover
 * 3. Browser opens — navigate to each section you want to map:
 *    - Purchase orders / quotations
 *    - Billing notes
 *    - Withholding tax
 *    - Try creating one document to capture POST payloads
 * 4. Close the browser or press Ctrl+C
 * 5. Check api-map.json for discovered endpoints
 */

import { chromium } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'
import { config } from 'dotenv'

config()

const FA_EMAIL = process.env.FA_EMAIL
const FA_PASSWORD = process.env.FA_PASSWORD
const FA_BASE_URL = process.env.FA_BASE_URL || 'https://app.flowaccount.com'

if (!FA_EMAIL || !FA_PASSWORD) {
  console.error('Error: FA_EMAIL and FA_PASSWORD must be set in .env')
  process.exit(1)
}

interface CapturedRequest {
  method: string
  url: string
  requestHeaders: Record<string, string>
  requestBody: string | null
  status: number
  responseBody: string | null
  timestamp: string
}

const captured: CapturedRequest[] = []
const responseBodyMap = new Map<string, string>()

const browser = await chromium.launch({ headless: false })
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
})
const page = await context.newPage()

// Intercept requests
page.on('request', (req) => {
  const type = req.resourceType()
  if (type === 'xhr' || type === 'fetch') {
    const url = req.url()
    // Skip static assets and analytics
    if (url.includes('analytics') || url.includes('intercom') || url.includes('hotjar')) return

    captured.push({
      method: req.method(),
      url,
      requestHeaders: req.headers(),
      requestBody: req.postData(),
      status: 0,
      responseBody: null,
      timestamp: new Date().toISOString(),
    })
    console.log(`→ ${req.method()} ${url}`)
  }
})

page.on('response', async (res) => {
  const type = res.request().resourceType()
  if (type !== 'xhr' && type !== 'fetch') return
  const url = res.url()
  if (url.includes('analytics') || url.includes('intercom') || url.includes('hotjar')) return

  try {
    const text = await res.text()
    responseBodyMap.set(url + '|' + res.request().method(), text)

    // Update matching captured entry
    const entry = [...captured].reverse().find(
      (c) => c.url === url && c.method === res.request().method()
    )
    if (entry) {
      entry.status = res.status()
      entry.responseBody = text.length > 5000 ? text.slice(0, 5000) + '...[truncated]' : text
    }
  } catch {
    // ignore non-text responses
  }
})

console.log('\n=== FlowAccount API Discovery ===')
console.log('Navigating to FlowAccount...\n')

await page.goto(FA_BASE_URL, { waitUntil: 'networkidle' })

// Check if already logged in
const isLoginPage = page.url().includes('/login') || page.url().includes('/signin') ||
  await page.locator('input[type="email"], input[name="email"]').count() > 0

if (isLoginPage) {
  console.log('Logging in...')
  try {
    await page.locator('input[type="email"], input[name="email"]').fill(FA_EMAIL)
    await page.locator('input[type="password"], input[name="password"]').fill(FA_PASSWORD)
    await page.locator('button[type="submit"], button:has-text("เข้าสู่ระบบ"), button:has-text("Login")').click()
    await page.waitForURL((url) => !url.toString().includes('/login') && !url.toString().includes('/signin'), { timeout: 15000 })
    console.log('Logged in successfully!\n')
  } catch (err) {
    console.error('Login failed. Please log in manually in the browser.')
  }
} else {
  console.log('Already logged in.\n')
}

console.log('=== Navigate in the browser to capture API calls ===')
console.log('Suggested actions:')
console.log('  1. Go to each document list (PO, Billing, WHT)')
console.log('  2. Open a single document')
console.log('  3. Start creating a new document (do not submit unless testing)')
console.log('\nClose the browser window when done.\n')

// Wait for browser to close
await page.waitForEvent('close', { timeout: 0 }).catch(() => {})
await browser.close().catch(() => {})

// Save results
const outputPath = path.join(process.cwd(), 'api-map.json')

// Deduplicate by URL + method
const seen = new Set<string>()
const deduped = captured.filter((c) => {
  const key = `${c.method}|${c.url}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})

// Group by path for readability
const grouped: Record<string, CapturedRequest[]> = {}
for (const entry of deduped) {
  try {
    const urlObj = new URL(entry.url)
    const basePath = urlObj.pathname
    if (!grouped[basePath]) grouped[basePath] = []
    grouped[basePath].push(entry)
  } catch {
    grouped['other'] = grouped['other'] || []
    grouped['other'].push(entry)
  }
}

const output = {
  capturedAt: new Date().toISOString(),
  baseUrl: FA_BASE_URL,
  totalRequests: deduped.length,
  endpoints: grouped,
}

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))
console.log(`\n✓ Saved ${deduped.length} unique endpoints to api-map.json`)
console.log('  Review api-map.json to build your tool handlers.')
