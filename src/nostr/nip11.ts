// Minimal NIP-11 (Relay Information Document) fetcher with localStorage cache
// https://github.com/nostr-protocol/nips/blob/master/11.md

export type RelayInfo = {
  name?: string
  description?: string
  pubkey?: string
  contact?: string
  supported_nips?: number[]
  software?: string
  version?: string
  limitation?: Record<string, unknown>
  retention?: Record<string, unknown>
  payments_url?: string
  fees?: unknown
}

type Cached = { ts: number; info: RelayInfo }

const TTL_MS = 24 * 60 * 60 * 1000 // 1 day

function cacheKey(url: string) {
  return `nip11:${url}`
}

export function getCachedRelayInfo(url: string): RelayInfo | null {
  try {
    const raw = localStorage.getItem(cacheKey(url))
    if (!raw) return null
    const obj = JSON.parse(raw) as Cached
    if (Date.now() - obj.ts > TTL_MS) return null
    return obj.info
  } catch {
    return null
  }
}

export function setCachedRelayInfo(url: string, info: RelayInfo) {
  try {
    const obj: Cached = { ts: Date.now(), info }
    localStorage.setItem(cacheKey(url), JSON.stringify(obj))
  } catch {}
}

function relayUrlToHttp(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol === 'wss:') u.protocol = 'https:'
    else if (u.protocol === 'ws:') u.protocol = 'http:'
    // Some relays serve the info at the root; NIP-11 says GET the relay URL with Accept header.
    // Using the base URL is correct.
    return u.toString()
  } catch {
    return null
  }
}

export async function fetchRelayInfo(url: string, { force = false, timeoutMs = 5000 }: { force?: boolean; timeoutMs?: number } = {}): Promise<RelayInfo> {
  if (!force) {
    const cached = getCachedRelayInfo(url)
    if (cached) return cached
  }
  const httpUrl = relayUrlToHttp(url)
  if (!httpUrl) throw new Error('Invalid relay URL')
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined
  const id = ctrl ? setTimeout(() => { try { ctrl.abort() } catch {} }, timeoutMs) : null
  try {
    const res = await fetch(httpUrl, {
      method: 'GET',
      headers: { Accept: 'application/nostr+json' },
      mode: 'cors',
      signal: ctrl?.signal as any,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const info = (await res.json()) as RelayInfo
    setCachedRelayInfo(url, info)
    return info
  } finally {
    if (id) try { clearTimeout(id as any) } catch {}
  }
}
