// Upload service: prefers HTTP backend when configured, falls back to in-memory store.
// The encryption stays the same; only the storage transport changes.

import { log } from '../ui/logger'
import { base64ToBytes, sha256Hex } from '../nostr/utils'
import { finalizeEvent, type EventTemplate } from 'nostr-tools'
import { hexToBytes } from '../nostr/utils'

const store = new Map<string, { mime: string; data: string }>() // fallback store (dev/demo)
const BASE_URL = (import.meta as any).env?.VITE_UPLOAD_BASE_URL as string | undefined
const AUTH_TOKEN = (import.meta as any).env?.VITE_UPLOAD_AUTH_TOKEN as string | undefined
const MODE = ((import.meta as any).env?.VITE_UPLOAD_MODE as string | undefined)?.toLowerCase() || 'simple' // 'simple' | 'nip96'
const AUTH_MODE = ((import.meta as any).env?.VITE_UPLOAD_AUTH_MODE as string | undefined)?.toLowerCase() || (AUTH_TOKEN ? 'token' : 'none') // 'none' | 'token' | 'nip98'

function withAuth(init: RequestInit = {}, url?: string): RequestInit {
  const headers = new Headers(init.headers || {})
  // Only attach Authorization for our configured backend URLs
  if (AUTH_TOKEN && BASE_URL) {
    try {
      const b = new URL(BASE_URL)
      if (!url || new URL(url).origin === b.origin) {
        headers.set('Authorization', `Bearer ${AUTH_TOKEN}`)
      }
    } catch {
      // ignore URL parse errors; no auth header
    }
  }
  return { ...init, headers }
}

export async function putObject(key: string, mime: string, base64Data: string): Promise<string> {
  if (BASE_URL) {
    // Two modes:
    // - simple: POST JSON to /upload (our dev server)
    // - nip96:  POST multipart/form-data to BASE_URL with NIP-98 auth
    try {
      log(`Upload -> ${key} (${mime}), backend=${BASE_URL} mode=${MODE} auth=${AUTH_MODE}`)
      if (MODE === 'nip96') {
        // NIP-96 upload expects multipart/form-data at the API URL (BASE_URL)
  const bytes = base64ToBytes(base64Data)
  // Copy into a plain ArrayBuffer to avoid SharedArrayBuffer typing issues
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  const file = new Blob([ab], { type: mime })
        const form = new FormData()
        form.set('file', file, 'upload')
        form.set('size', String(bytes.length))
        form.set('content_type', mime)
        // Optional extras (caption/alt) could be set by callers later
        const uploadUrl = BASE_URL.replace(/\/$/, '')
  const init: RequestInit = { method: 'POST', body: form }
        // Add NIP-98 Authorization when enabled
        if (AUTH_MODE === 'nip98') {
          const payloadHex = await sha256Hex(bytes)
          const auth = await makeNip98Header(uploadUrl, 'POST', payloadHex)
          if (auth) {
            const h = init.headers instanceof Headers ? init.headers : new Headers(init.headers as any)
            h.set('Authorization', auth)
            init.headers = h
          }
        } else {
          // Fallback to token if provided
          Object.assign(init, withAuth(init, uploadUrl))
        }
        const res = await fetch(uploadUrl, init)
        if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
        const out = await res.json().catch(() => ({})) as any
        // Prefer nip94_event.tags url if provided, else try generic url
        const nip94 = out?.nip94_event
        if (nip94 && Array.isArray(nip94.tags)) {
          const urlTag = nip94.tags.find((t: any) => Array.isArray(t) && t[0] === 'url')
          if (urlTag && typeof urlTag[1] === 'string') return urlTag[1]
        }
        if (typeof out.url === 'string') return out.url
        // As a last resort, construct standard NIP-96 download path from hash if present
        const oxTag = nip94?.tags?.find((t: any) => Array.isArray(t) && t[0] === 'ox')
        const mTag = nip94?.tags?.find((t: any) => Array.isArray(t) && t[0] === 'm')
        if (oxTag && typeof oxTag[1] === 'string') {
          const ext = guessExtFromMime(mTag?.[1] || mime)
          return `${uploadUrl.replace(/\/$/, '')}/${oxTag[1]}${ext ? '.'+ext : ''}`
        }
        throw new Error('Upload response missing url')
      } else {
        const url = `${BASE_URL.replace(/\/$/, '')}/upload`
        const res = await fetch(url, withAuth({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, mime, data: base64Data })
        }, url))
        if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
        const out = await res.json().catch(() => ({})) as any
        if (typeof out.url === 'string') return out.url
        // fallback: predictable path
        return `${BASE_URL.replace(/\/$/, '')}/o/${encodeURIComponent(key)}`
      }
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
      const init: RequestInit = {}
      if (AUTH_MODE === 'nip98' && BASE_URL) {
        const auth = await makeNip98Header(keyOrUrl, 'GET')
        if (auth) {
          const h = init.headers instanceof Headers ? init.headers : new Headers(init.headers as any)
          h.set('Authorization', auth)
          init.headers = h
        }
      } else {
        Object.assign(init, withAuth(init, keyOrUrl))
      }
      const res = await fetch(keyOrUrl, init)
      if (!res.ok) throw new Error(`Get failed: ${res.status}`)
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        const out = await res.json().catch(() => ({})) as any
        if (out && typeof out.data === 'string') return { mime: out.mime || 'application/octet-stream', base64Data: out.data }
      }
      // Fallback: treat as binary and convert to base64
      const buf = await res.arrayBuffer()
      const b64 = arrayBufferToBase64(buf)
      const mime = ct || 'application/octet-stream'
      return { mime, base64Data: b64 }
    } catch (e) {
      log(`Absolute download failed: ${(e as any)?.message || e}`, 'warn')
    }
  } else if (BASE_URL && !parseMemUrl(keyOrUrl)) {
    // GET from backend using configured base URL: /o/:key -> { mime, data }
    try {
      log(`Download <- ${keyOrUrl} (backend)`)
      const url = `${BASE_URL.replace(/\/$/, '')}/o/${encodeURIComponent(keyOrUrl)}`
      const init: RequestInit = {}
      if (AUTH_MODE === 'nip98') {
        const auth = await makeNip98Header(url, 'GET')
        if (auth) {
          const h = init.headers instanceof Headers ? init.headers : new Headers(init.headers as any)
          h.set('Authorization', auth)
          init.headers = h
        }
      } else {
        Object.assign(init, withAuth(init, url))
      }
      const res = await fetch(url, init)
      if (!res.ok) throw new Error(`Get failed: ${res.status}`)
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        const out = await res.json().catch(() => ({})) as any
        if (out && typeof out.data === 'string') return { mime: out.mime || 'application/octet-stream', base64Data: out.data }
      }
      const buf = await res.arrayBuffer()
      const b64 = arrayBufferToBase64(buf)
      const mime = ct || 'application/octet-stream'
      return { mime, base64Data: b64 }
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

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function guessExtFromMime(m: string): string {
  const map: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/webm': 'webm', 'video/mp4': 'mp4', 'audio/webm': 'webm', 'audio/mpeg': 'mp3',
    'application/pdf': 'pdf'
  }
  return map[m] || ''
}

async function makeNip98Header(url: string, method: string, payloadHex?: string): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const unsigned: EventTemplate = {
      kind: 27235 as any,
      created_at: now,
      content: '',
      tags: [ ['u', url], ['method', method.toUpperCase()] ]
    }
    if (payloadHex) unsigned.tags!.push(['payload', payloadHex])

    // Prefer local secret if present; else try NIP-07 (window.nostr)
    const sk = localStorage.getItem('nostr_sk')
    let signed: any | null = null
    if (sk) {
      signed = finalizeEvent(unsigned, hexToBytes(sk))
    } else if (typeof (globalThis as any).window !== 'undefined' && (window as any).nostr?.signEvent) {
      try { signed = await (window as any).nostr.signEvent(unsigned) } catch {}
    }
    if (!signed) return null
    const json = JSON.stringify(signed)
    const b64 = btoa(unescape(encodeURIComponent(json)))
    return `Nostr ${b64}`
  } catch {
    return null
  }
}
