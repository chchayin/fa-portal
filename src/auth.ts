import { chromium } from 'playwright'
import { homedir, hostname, userInfo } from 'os'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs'
import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'crypto'

// ─── Data directory & token file ─────────────────────────────────────

const DATA_DIR = join(homedir(), '.fa-portal')
const TOKEN_FILE = join(DATA_DIR, 'token.json')
export const FA_API_BASE = 'https://api-core-canary.flowaccount.com'

// ─── Token encryption (AES-256-GCM, machine-derived key) ────────────

const ALGO = 'aes-256-gcm'
const KEY_SALT = 'fa-portal-token-salt'

function deriveKey(): Buffer {
  const identity = `${hostname()}:${userInfo().username}:fa-portal`
  return scryptSync(identity, KEY_SALT, 32)
}

function encryptToken(token: string): { iv: string; data: string; tag: string } {
  const key = deriveKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    iv: iv.toString('hex'),
    data: encrypted.toString('hex'),
    tag: tag.toString('hex'),
  }
}

function decryptToken(enc: { iv: string; data: string; tag: string }): string {
  const key = deriveKey()
  const decipher = createDecipheriv(ALGO, key, Buffer.from(enc.iv, 'hex'))
  decipher.setAuthTag(Buffer.from(enc.tag, 'hex'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(enc.data, 'hex')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

// ─── Session type & cache ────────────────────────────────────────────

export interface Session {
  token: string
  extractedAt: number
}

let cached: Session | null = null

// ─── Token persistence (encrypted at rest, chmod 600) ────────────────

interface StoredToken {
  iv: string
  data: string
  tag: string
  extractedAt: number
}

function loadStoredToken(): Session | null {
  try {
    if (!existsSync(TOKEN_FILE)) return null
    const stored = JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as StoredToken
    if (!stored.iv || !stored.data || !stored.tag || !stored.extractedAt) return null
    const token = decryptToken(stored)
    return { token, extractedAt: stored.extractedAt }
  } catch {
    return null
  }
}

function saveToken(session: Session) {
  mkdirSync(DATA_DIR, { recursive: true })
  const encrypted = encryptToken(session.token)
  const stored: StoredToken = { ...encrypted, extractedAt: session.extractedAt }
  writeFileSync(TOKEN_FILE, JSON.stringify(stored, null, 2))
  chmodSync(TOKEN_FILE, 0o600)
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
    saveToken(session)
    console.error('[auth] Token saved. Browser closed. Ready.')
    return session
  } finally {
    await browser.close()
  }
}

// ─── Public API ──────────────────────────────────────────────────────

const SESSION_TTL = 22 * 60 * 60 * 1000 // 22 hours

export async function getSession(): Promise<Session> {
  // 1. In-memory cache
  if (cached && Date.now() - cached.extractedAt < SESSION_TTL) return cached

  // 2. Persisted (encrypted) token file
  const stored = loadStoredToken()
  if (stored && Date.now() - stored.extractedAt < SESSION_TTL) {
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
