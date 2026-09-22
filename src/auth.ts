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

/**
 * FlowAccount bearer tokens stay usable for roughly 22 hours.
 * Anything older than this is treated as absent, not as a valid session.
 */
export const SESSION_TTL_MS = 22 * 60 * 60 * 1000

/** Non-interactive view of session state — see peekSession(). */
export interface SessionStatus {
  state: 'none' | 'expired' | 'valid'
  session: Session | null
  /** Milliseconds since the token was captured (null when there is no token). */
  ageMs: number | null
  /** Milliseconds left before the token hits the TTL (0 when expired, null when absent). */
  remainingMs: number | null
  /** True while an interactive browser login is already running. */
  loginInProgress: boolean
}

let cached: Session | null = null

/** Shared promise for an interactive login that is currently running. */
let loginInFlight: Promise<Session> | null = null

function isExpired(session: Session): boolean {
  return Date.now() - session.extractedAt >= SESSION_TTL_MS
}

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

/**
 * Start an interactive login, or join the one already running.
 *
 * Callers never touch loginViaBrowser directly: only one Chromium window may
 * exist at a time, and every concurrent caller resolves with the same Session.
 * The in-flight promise is cleared once it settles — success or failure — so a
 * later refresh always gets a fresh browser login and a rejected attempt is
 * never cached.
 */
function startLogin(): Promise<Session> {
  if (loginInFlight) {
    console.error('[auth] Login already in progress — joining it.')
    return loginInFlight
  }

  const attempt: Promise<Session> = loginViaBrowser()
    .then((session) => {
      cached = session
      return session
    })
    .finally(() => {
      if (loginInFlight === attempt) loginInFlight = null
    })

  loginInFlight = attempt
  return attempt
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Report session state without ever opening a browser.
 * Consults the in-memory cache first, then the Keychain.
 */
export function peekSession(): SessionStatus {
  const session = cached ?? keychainLoad()
  const loginInProgress = loginInFlight !== null

  if (!session) {
    return { state: 'none', session: null, ageMs: null, remainingMs: null, loginInProgress }
  }

  const ageMs = Date.now() - session.extractedAt
  if (ageMs >= SESSION_TTL_MS) {
    return { state: 'expired', session, ageMs, remainingMs: 0, loginInProgress }
  }

  return { state: 'valid', session, ageMs, remainingMs: SESSION_TTL_MS - ageMs, loginInProgress }
}

export async function getSession(): Promise<Session> {
  // 1. In-memory cache — only if still inside the TTL
  if (cached && !isExpired(cached)) return cached
  cached = null

  // 2. macOS Keychain — a stored token past the TTL counts as no token at all
  const stored = keychainLoad()
  if (stored) {
    if (!isExpired(stored)) {
      cached = stored
      return cached
    }
    console.error('[auth] Stored token is past its 22h TTL — re-login required.')
  }

  // 3. Interactive browser login (deduplicated across concurrent callers)
  return startLogin()
}

export async function refreshSession(): Promise<Session> {
  // Join a login that is already open rather than racing a second window.
  if (loginInFlight) {
    console.error('[auth] Login already in progress — joining it.')
    return loginInFlight
  }

  // No login running: drop the stale token and start one. Nothing can observe
  // the null cache before loginInFlight is set — startLogin assigns it in this
  // same synchronous turn, so getSession() can never slip in and open its own
  // browser window.
  cached = null
  return startLogin()
}
