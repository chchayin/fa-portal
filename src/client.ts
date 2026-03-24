import { readFileSync } from 'fs'
import { basename } from 'path'
import { getSession, refreshSession, FA_API_BASE } from './auth.js'

export class SessionExpiredError extends Error {
  constructor() {
    super('FlowAccount session expired and could not be renewed.')
    this.name = 'SessionExpiredError'
  }
}

type Params = Record<string, string | number | boolean | undefined | null>

function buildUrl(path: string, params?: Params): string {
  const base = path.startsWith('http') ? path : `${FA_API_BASE}${path}`
  const url = new URL(base)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }
  }
  return url.toString()
}

function parseResponseBody<T>(text: string): T {
  if (!text) return {} as T
  try { return JSON.parse(text) as T } catch { return text as unknown as T }
}

async function faFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; params?: Params } = {},
  retry = true
): Promise<T> {
  const session = await getSession()

  const url = buildUrl(path, options.params)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Referer: 'https://advance.flowaccount.com/',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  }

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (res.status === 401 || res.status === 403) {
    if (retry) {
      console.error('[client] Token expired, refreshing session...')
      await refreshSession()
      return faFetch(path, options, false)
    }
    throw new SessionExpiredError()
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`FlowAccount API ${res.status}: ${body.slice(0, 400)}`)
  }

  return parseResponseBody<T>(await res.text())
}

export const faGet = <T = unknown>(path: string, params?: Params) =>
  faFetch<T>(path, { method: 'GET', params })

export const faPost = <T = unknown>(path: string, body: unknown) =>
  faFetch<T>(path, { method: 'POST', body })

export const faPut = <T = unknown>(path: string, body: unknown) =>
  faFetch<T>(path, { method: 'PUT', body })

export const faDelete = <T = unknown>(path: string) =>
  faFetch<T>(path, { method: 'DELETE' })

export async function faUpload<T = unknown>(path: string, filePath: string, retry = true): Promise<T> {
  const session = await getSession()
  const url = buildUrl(path)
  const fileBuffer = readFileSync(filePath)
  const fileName = basename(filePath)

  const form = new FormData()
  form.append('file', new Blob([fileBuffer]), fileName)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.token}`,
      Accept: 'application/json',
      Referer: 'https://advance.flowaccount.com/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    body: form,
  })

  if (res.status === 401 || res.status === 403) {
    if (retry) {
      await refreshSession()
      return faUpload(path, filePath, false)
    }
    throw new SessionExpiredError()
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`FlowAccount API ${res.status}: ${body.slice(0, 400)}`)
  }

  return parseResponseBody<T>(await res.text())
}
