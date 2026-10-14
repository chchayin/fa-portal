import { chromium } from 'playwright'
import { execFileSync } from 'child_process'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export const FA_API_BASE = 'https://api-core-canary.flowaccount.com'

const KEYCHAIN_SERVICE = 'fa-portal'
const KEYCHAIN_ACCOUNT = 'flowaccount-token'
const KEYCHAIN_STATE_KEY = 'flowaccount-state-key'

/** Where the encrypted Playwright storageState lives (the key is in the Keychain). */
const STATE_DIR = join(homedir(), '.fa-portal')
const STATE_FILE = join(STATE_DIR, 'state.enc')

/** Cap on the silent (headless) re-auth before we fall back to asking the user. */
const SILENT_REFRESH_TIMEOUT_MS = 45_000

// ─── macOS Keychain storage ─────────────────────────────────────────

/**
 * Write a secret to the Keychain through stdin rather than argv.
 *
 * `security add-generic-password -w <value>` would put the secret on the
 * command line, where any local process can read it out of `ps`. Given no
 * value, the tool prompts for it and asks for a retype, so sending the value
 * twice on stdin stores it without it ever appearing in argv. Values are
 * capped around 128 bytes by this path, which is why only small secrets (the
 * token, the state encryption key) live here.
 */
function keychainSaveSecret(account: string, value: string): void {
  try {
    execFileSync('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account],
      { stdio: 'ignore' })
  } catch { /* not found — fine */ }
  execFileSync('security', ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'],
    { input: `${value}\n${value}\n`, stdio: ['pipe', 'ignore', 'ignore'] })
}

function keychainLoadSecret(account: string): string | null {
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'],
      { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function keychainSave(session: Session): void {
  keychainSaveSecret(KEYCHAIN_ACCOUNT, JSON.stringify({ token: session.token, extractedAt: session.extractedAt }))
  console.error('[auth] Token saved to macOS Keychain.')
}

function keychainLoad(): Session | null {
  const raw = keychainLoadSecret(KEYCHAIN_ACCOUNT)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { token: string; extractedAt: number }
    if (!parsed.token || !parsed.extractedAt) return null
    return { token: parsed.token, extractedAt: parsed.extractedAt }
  } catch {
    return null
  }
}

// ─── Encrypted storageState ──────────────────────────────────────────

/**
 * Playwright's storageState (cookies + localStorage) is what makes a silent
 * re-auth possible, and it is password-equivalent: anyone holding it is logged
 * in as you. It runs to tens of KB, far past what the Keychain stdin path
 * accepts, so it is stored as AES-256-GCM ciphertext in a 0600 file while the
 * key itself lives in the Keychain. Losing either half makes the file useless.
 */
function stateKey(): Buffer {
  const existing = keychainLoadSecret(KEYCHAIN_STATE_KEY)
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return Buffer.from(existing, 'hex')
  const key = randomBytes(32)
  keychainSaveSecret(KEYCHAIN_STATE_KEY, key.toString('hex'))
  return key
}

function saveStorageState(state: unknown): void {
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', stateKey(), iv)
    const body = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()])
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
    writeFileSync(STATE_FILE, Buffer.concat([iv, cipher.getAuthTag(), body]), { mode: 0o600 })
    chmodSync(STATE_FILE, 0o600)
  } catch (err) {
    console.error('[auth] Could not save browser state:', err instanceof Error ? err.message : err)
  }
}

function loadStorageState(): unknown | null {
  if (!existsSync(STATE_FILE)) return null
  try {
    const raw = readFileSync(STATE_FILE)
    const decipher = createDecipheriv('aes-256-gcm', stateKey(), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'))
  } catch {
    // Wrong key, truncated or tampered file — treat as absent.
    return null
  }
}

/** Drop the saved browser state, e.g. once it no longer authenticates. */
export function clearStorageState(): void {
  try { if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE) } catch { /* ignore */ }
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

  const attempt: Promise<Session> = (async () => {
    // Several MCP clients (Claude Code, Claude Desktop) each run their own
    // copy of this server, so the in-process guard above cannot see a login
    // happening in a sibling process. Re-read the Keychain first: if one of
    // them finished logging in since we last looked, reuse that token instead
    // of opening a second browser window and asking for the password again.
    const fresh = keychainLoad()
    if (fresh && !isExpired(fresh)) {
      console.error('[auth] Another process already logged in — reusing its token.')
      return fresh
    }
    return loginViaBrowser()
  })()
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
