// Upload service: prefers HTTP backend when configured, falls back to in-memory store.
// The encryption stays the same; only the storage transport changes.

import { log } from '../ui/logger'

const store = new Map<string, { mime: string; data: string }>() // fallback store (dev/demo)
const BASE_URL = (import.meta as any).env?.VITE_UPLOAD_BASE_URL as string | undefined

export async function putObject(key: string, mime: string, base64Data: string): Promise<string> {
  if (BASE_URL) {
    // POST to backend: { key, mime, data } -> returns { url }
    try {
      log(`Upload -> ${key} (${mime}), backend=${BASE_URL}`)
      const res = await fetch(`${BASE_URL.replace(/\/$/, '')}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, mime, data: base64Data })
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      const out = await res.json().catch(() => ({})) as any
      if (typeof out.url === 'string') return out.url
      // fallback: predictable path
      return `${BASE_URL.replace(/\/$/, '')}/o/${encodeURIComponent(key)}`
    } catch (e) {
      log(`Upload backend failed, falling back to memory: ${(e as any)?.message || e}`, 'warn')
      // soft-fail to in-memory for resilience in dev
    }
  }
  store.set(key, { mime, data: base64Data })
  log(`Upload stored in memory: ${key}`)
  return `mem://${key}`
}

export async function getObject(keyOrUrl: string): Promise<{ mime: string; base64Data: string } | null> {
  // If we received a full HTTP(S) URL, fetch it directly regardless of BASE_URL
  if (/^https?:\/\//i.test(keyOrUrl)) {
    try {
      log(`Download <- ${keyOrUrl} (absolute)`)
      const res = await fetch(keyOrUrl)
      if (!res.ok) throw new Error(`Get failed: ${res.status}`)
      const out = await res.json().catch(() => ({})) as any
      if (out && typeof out.data === 'string') return { mime: out.mime || 'application/octet-stream', base64Data: out.data }
    } catch (e) {
      log(`Absolute download failed: ${(e as any)?.message || e}`, 'warn')
    }
  } else if (BASE_URL && !parseMemUrl(keyOrUrl)) {
    // GET from backend using configured base URL: /o/:key -> { mime, data }
    try {
      log(`Download <- ${keyOrUrl} (backend)`)
      const url = `${BASE_URL.replace(/\/$/, '')}/o/${encodeURIComponent(keyOrUrl)}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Get failed: ${res.status}`)
      const out = await res.json().catch(() => ({})) as any
      if (out && typeof out.data === 'string') return { mime: out.mime || 'application/octet-stream', base64Data: out.data }
    } catch (e) {
      log(`Download backend failed, trying memory: ${(e as any)?.message || e}`, 'warn')
      // soft-fail to mem
    }
  }
  const key = parseMemUrl(keyOrUrl) ?? keyOrUrl
  const v = store.get(key)
  if (!v) return null
  log(`Download from memory: ${key}`)
  return { mime: v.mime, base64Data: v.data }
}

export function parseMemUrl(url: string): string | null {
  if (!url.startsWith('mem://')) return null
  return url.slice('mem://'.length)
}
