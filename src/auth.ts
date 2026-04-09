import { chromium } from 'playwright'
import { execFileSync } from 'child_process'

export const FA_API_BASE = 'https://api-core-canary.flowaccount.com'

const KEYCHAIN_SERVICE = 'fa-portal'
const KEYCHAIN_ACCOUNT = 'flowaccount-token'

// ─── macOS Keychain storage ─────────────────────────────────────────

function keychainSave(session: Session): void {
  const payload = JSON.stringify({ token: session.token, extractedAt: session.extractedAt })
  try {
    // Delete existing entry first (ignore errors if not found)
    execFileSync('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT],
      { stdio: 'ignore' })
  } catch { /* not found — fine */ }
  execFileSync('security', ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w', payload])
  console.error('[auth] Token saved to macOS Keychain.')
}

function keychainLoad(): Session | null {
  try {
    const raw = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
      { encoding: 'utf8' }).trim()
    const parsed = JSON.parse(raw) as { token: string; extractedAt: number }
    if (!parsed.token || !parsed.extractedAt) return null
    return { token: parsed.token, extractedAt: parsed.extractedAt }
  } catch {
    return null
  }
}

// ─── Session type & cache ────────────────────────────────────────────

export interface Session {
  token: string
  extractedAt: number
}

let cached: Session | null = null

// ─── Browser login (interactive only) ────────────────────────────────

async function loginViaBrowser(): Promise<Session> {
  console.error('[auth] Opening browser — please log in to FlowAccount...')

  const browser = await chromium.launch({ headless: false })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()

    // Resolve as soon as we see the first Bearer token in any API request
    let clearTimeout: (() => void) | undefined
    const tokenPromise = new Promise<string>((resolve, reject) => {
      context.on('request', (req) => {
        const auth = req.headers()['authorization']
        if (auth?.startsWith('Bearer ') && req.url().includes('api-core-canary.flowaccount.com')) {
          resolve(auth.replace('Bearer ', ''))
        }
      })
      const timer = setTimeout(
        () => reject(new Error('Login timed out after 3 minutes.')),
        180000,
      )
      clearTimeout = () => globalThis.clearTimeout(timer)
    })

    await page.goto('https://advance.flowaccount.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    console.error('[auth] Log in and wait for the dashboard to load. Browser will close automatically.')

    const token = await tokenPromise
    clearTimeout?.()

    const session: Session = { token, extractedAt: Date.now() }
    keychainSave(session)
    return session
  } finally {
    await browser.close().catch(() => {})
    console.error('[auth] Browser closed.')
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export async function getSession(): Promise<Session> {
  // 1. In-memory cache
  if (cached) return cached

  // 2. macOS Keychain
  const stored = keychainLoad()
  if (stored) {
    cached = stored
    return cached
  }

  // 3. Interactive browser login
  cached = await loginViaBrowser()
  return cached
}

export async function refreshSession(): Promise<Session> {
  cached = null
  cached = await loginViaBrowser()
  return cached
}
