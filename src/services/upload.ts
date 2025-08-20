// Upload service: prefers HTTP backend when configured, falls back to in-memory store.
// The encryption stays the same; only the storage transport changes.

import { log } from '../ui/logger'
import { emitToast } from '../ui/Toast'
import { base64ToBytes, sha256Hex } from '../nostr/utils'
import { finalizeEvent, type EventTemplate } from 'nostr-tools'
import { hexToBytes } from '../nostr/utils'
import { CONFIG } from '../config'

const store = new Map<string, { mime: string; data: string }>() // fallback store (dev/demo)
let BASE_URL = CONFIG.USE_HARDCODED ? CONFIG.UPLOAD_BASE_URL : (import.meta as any).env?.VITE_UPLOAD_BASE_URL as string | undefined
const AUTH_TOKEN = CONFIG.USE_HARDCODED ? (CONFIG.UPLOAD_AUTH_TOKEN || undefined) : (import.meta as any).env?.VITE_UPLOAD_AUTH_TOKEN as string | undefined
const PUBLIC_BASE_URL = CONFIG.USE_HARDCODED ? CONFIG.UPLOAD_PUBLIC_BASE_URL : (import.meta as any).env?.VITE_UPLOAD_PUBLIC_BASE_URL as string | undefined

// Guard: if running on a non-localhost origin (e.g., GitHub Pages) and BASE_URL points to localhost,
// disable backend usage to avoid connection refused in production and fall back to mem://.
try {
  const isPageLocal = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname)
  if (!isPageLocal && BASE_URL && /^https?:\/\/localhost(?::\d+)?/i.test(BASE_URL)) {
    log(`Upload backend disabled: app origin=${location.origin}, BASE_URL=${BASE_URL}. Falling back to mem:// in production.`, 'warn')
    emitToast('Uploads disabled on this host (localhost backend). Configure a public upload server.', 'error')
    BASE_URL = undefined
  }
} catch {}

type Nip96Config = { api_url: string; download_url?: string }
let nip96Cache: Nip96Config | null = null

async function discoverNip96(): Promise<Nip96Config | null> {
  try {
    // If explicit public base is provided, prefer it for download_url inference later
    const base = BASE_URL ? new URL(BASE_URL) : null
    const origin = base ? `${base.protocol}//${base.host}` : null
    if (!origin) return null
    const res = await fetch(`${origin}/.well-known/nostr/nip96.json`, { method: 'GET', cache: 'no-cache' })
    if (!res.ok) return null
    const json = await res.json().catch(() => null) as any
    if (!json || typeof json.api_url !== 'string') return null
    const cfg: Nip96Config = { api_url: json.api_url, download_url: json.download_url }
    nip96Cache = cfg
    return cfg
  } catch {
    return null
  }
}

async function getNip96Endpoints(): Promise<{ apiUrl: string; downloadBase: string } | null> {
  if (MODE !== 'nip96') return null
  if (!BASE_URL) return null
  // Try cache, then discovery, fallback to provided BASE_URL
  const cfg = nip96Cache || await discoverNip96()
  const apiUrl = (cfg?.api_url || BASE_URL).replace(/\/$/, '')
  const downloadBase = (PUBLIC_BASE_URL || cfg?.download_url || cfg?.api_url || BASE_URL).replace(/\/$/, '')
  return { apiUrl, downloadBase }
}
const MODE = (CONFIG.USE_HARDCODED ? CONFIG.UPLOAD_MODE : (((import.meta as any).env?.VITE_UPLOAD_MODE as string | undefined)?.toLowerCase() as any)) || 'simple'
const AUTH_MODE = (CONFIG.USE_HARDCODED ? CONFIG.UPLOAD_AUTH_MODE : (((import.meta as any).env?.VITE_UPLOAD_AUTH_MODE as string | undefined)?.toLowerCase() as any)) || (AUTH_TOKEN ? 'token' : 'none')

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
        const endpoints = await getNip96Endpoints()
        const apiUrl = (endpoints?.apiUrl || BASE_URL).replace(/\/$/, '')
        const downloadBase = (endpoints?.downloadBase || BASE_URL).replace(/\/$/, '')
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
        const uploadUrl = apiUrl
        // Build attempt list: no-auth → NIP-98 (no payload tag) → Bearer
        const attempts: Array<{ init: RequestInit; label: string }> = []
        // No-auth first (bypasses CORS preflight on some servers)
        attempts.push({ init: { method: 'POST', body: form }, label: 'no-auth' })
        // NIP-98 attempt (omit payload tag for multipart to avoid hash mismatch)
        if (AUTH_MODE === 'nip98') {
          const auth = await makeNip98Header(uploadUrl, 'POST')
          if (auth) {
            const h = new Headers()
            h.set('Authorization', auth)
            attempts.push({ init: { method: 'POST', body: form, headers: h }, label: 'nip-98' })
          } else {
            emitToast('Cannot sign NIP-98 auth. Import a key or enable a NIP-07 extension.', 'error')
          }
        }
        // Bearer token attempt last
        if (AUTH_TOKEN) {
          const h = new Headers()
          h.set('Authorization', `Bearer ${AUTH_TOKEN}`)
          attempts.push({ init: { method: 'POST', body: form, headers: h }, label: 'token' })
        }

        let res: Response | null = null
        let lastErr: any = null
        const attemptLogs: string[] = []
        for (const { init, label } of attempts) {
          try {
            res = await fetch(uploadUrl, init)
            if (res.ok) { attemptLogs.push(`[${label}] OK ${res.status}`); break }
            const text = await res.text().catch(() => '')
            attemptLogs.push(`[${label}] HTTP ${res.status} ${res.statusText}${text ? ` - ${truncate(text)}` : ''}`)
            lastErr = new Error(`HTTP ${res.status}`)
          } catch (e: any) {
            attemptLogs.push(`[${label}] ${e?.name || 'Error'}: ${e?.message || e}`)
            lastErr = e
          }
        }
        if (!res || !res.ok) {
          const endpointsInfo = (() => {
            try { return `api=${apiUrl}, downloadBase=${downloadBase}` } catch { return '' }
          })()
          const modeInfo = `mode=${MODE}, auth=${AUTH_MODE}${AUTH_TOKEN ? '+token' : ''}`
          const baseInfo = `BASE_URL=${BASE_URL || 'unset'}, PUBLIC_BASE_URL=${PUBLIC_BASE_URL || 'unset'}`
          emitToast(
            `Upload failed; falling back to mem://. ${lastErr?.message || ''}\n${modeInfo}\n${endpointsInfo}\n${baseInfo}\nAttempts:\n- ${attemptLogs.join('\n- ')}`,
            'error'
          )
          throw (lastErr || new Error('Upload failed'))
        }
        const out = await res.json().catch(() => ({})) as any
        // Prefer nip94_event.tags url if provided, else try generic url
        const nip94 = out?.nip94_event
        if (nip94 && Array.isArray(nip94.tags)) {
          const urlTag = nip94.tags.find((t: any) => Array.isArray(t) && t[0] === 'url')
          if (urlTag && typeof urlTag[1] === 'string') return urlTag[1]
        }
        if (typeof out.url === 'string') return out.url
        // Compat: some servers return just a "key"; construct predictable path /o/:key under apiUrl
        if (typeof out.key === 'string') {
          return `${apiUrl.replace(/\/$/, '')}/o/${encodeURIComponent(out.key)}`
        }
        // As a last resort, construct standard NIP-96 download path from hash if present
        const oxTag = nip94?.tags?.find((t: any) => Array.isArray(t) && t[0] === 'ox')
        const mTag = nip94?.tags?.find((t: any) => Array.isArray(t) && t[0] === 'm')
        if (oxTag && typeof oxTag[1] === 'string') {
          const ext = guessExtFromMime(mTag?.[1] || mime)
          // Per NIP-96, standard download path is $api_url/<hash>(.ext) unless download_url is provided
          const base = downloadBase
          return `${base}/${oxTag[1]}${ext ? '.'+ext : ''}`
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

export async function getObject(keyOrUrl: string, opts?: { verbose?: boolean }): Promise<{ mime: string; base64Data: string } | null> {
  // If we received a full HTTP(S) URL, fetch it directly regardless of BASE_URL
  if (/^https?:\/\//i.test(keyOrUrl)) {
    try {
      log(`Download <- ${keyOrUrl} (absolute)`)
      // Prevent futile attempts to fetch localhost resources when the page isn't running on localhost
      try {
        const urlObj = new URL(keyOrUrl)
        const isTargetLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(urlObj.hostname)
        const isPageLocal = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname)
        if (isTargetLocal && !isPageLocal) {
          const msg = `Blocked fetch to ${keyOrUrl} from non-local origin. Configure a public upload server.`
          log(msg, 'warn')
          if (opts?.verbose) emitToast(msg, 'error')
          return null
        }
      } catch {}
        // Try unauthenticated first, then NIP-98, then Bearer
        const attempts: Array<{ init: RequestInit; label: string }> = []
        attempts.push({ init: {}, label: 'no-auth' }) // unauthenticated
        if (AUTH_MODE === 'nip98') {
          const init98: RequestInit = {}
          const auth = await makeNip98Header(keyOrUrl, 'GET')
          if (auth) {
            const h = new Headers()
            h.set('Authorization', auth)
            init98.headers = h
            attempts.push({ init: init98, label: 'nip-98' })
          }
        }
        if (AUTH_TOKEN) attempts.push({ init: withAuth({}, keyOrUrl), label: 'token' })

      let res: Response | null = null
      let lastErr: any = null
      const attemptLogs: string[] = []
      for (const { init, label } of attempts) {
        try {
          res = await fetch(keyOrUrl, init)
          if (res.ok) { attemptLogs.push(`[${label}] OK ${res.status}`); break }
          const text = await res.text().catch(() => '')
          attemptLogs.push(`[${label}] HTTP ${res.status} ${res.statusText}${text ? ` - ${truncate(text)}` : ''}`)
          lastErr = new Error(`HTTP ${res.status}`)
        } catch (e) { lastErr = e; attemptLogs.push(`[${label}] ${(e as any)?.message || e}`) }
      }
      if (!res || !res.ok) {
        if (opts?.verbose) emitToast(`Download failed for ${keyOrUrl}. Attempts:\n- ${attemptLogs.join('\n- ')}`, 'error')
        throw lastErr || new Error('Get failed')
      }
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        const out = await res.json().catch(() => ({})) as any
        if (out && typeof out.data === 'string') return { mime: out.mime || 'application/octet-stream', base64Data: out.data }
      }
      // Fallback: treat as binary and convert to base64; sniff MIME if missing
      const buf = await res.arrayBuffer()
      const u8 = new Uint8Array(buf)
      const b64 = arrayBufferToBase64(buf)
      const mime = ct || sniffMimeFromBytes(u8, 'application/octet-stream')
      // Debug: log what we detected for absolute URLs
      log(`Absolute URL download: content-type="${ct}", sniffed="${ct ? 'n/a' : sniffMimeFromBytes(u8, 'application/octet-stream')}", final="${mime}", size=${u8.length}`)
      return { mime, base64Data: b64 }
    } catch (e) {
      log(`Absolute download failed: ${(e as any)?.message || e}`, 'warn')
    }
  } else if (BASE_URL && !parseMemUrl(keyOrUrl) && MODE !== 'nip96') {
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
  const u8 = new Uint8Array(buf)
  const b64 = arrayBufferToBase64(buf)
  const mime = ct || sniffMimeFromBytes(u8, 'application/octet-stream')
  // Debug: log what we detected for simple mode
  log(`Simple mode download: content-type="${ct}", sniffed="${ct ? 'n/a' : sniffMimeFromBytes(u8, 'application/octet-stream')}", final="${mime}", size=${u8.length}`)
  return { mime, base64Data: b64 }
    } catch (e) {
      log(`Download backend failed, trying memory: ${(e as any)?.message || e}`, 'warn')
      // soft-fail to mem
    }
  } else if (MODE === 'nip96' && BASE_URL && !parseMemUrl(keyOrUrl)) {
    // In NIP-96 mode, if we received a key (hash) instead of absolute URL, build the download URL from endpoints
    try {
      const endpoints = await getNip96Endpoints()
      if (!endpoints) throw new Error('NIP-96 discovery failed')
      // Detect if keyOrUrl is a NIP-96 ox hash (64 hex, optional .ext), else treat as server key requiring /o/:key
      const isHash = /^[0-9a-f]{64}(?:\.[a-z0-9]+)?$/i.test(keyOrUrl)
      const candidates: string[] = []
      if (isHash) {
        candidates.push(`${endpoints.downloadBase.replace(/\/$/, '')}/${encodeURIComponent(keyOrUrl)}`)
      } else {
        // Try /o/:key on multiple bases to handle BASE_URL with subpaths (e.g., /upload)
        const baseTrimmed = BASE_URL.replace(/\/$/, '')
        const pubTrimmed = (PUBLIC_BASE_URL || '').replace(/\/$/, '')
        candidates.push(`${baseTrimmed}/o/${encodeURIComponent(keyOrUrl)}`)
        if (pubTrimmed) candidates.push(`${pubTrimmed}/o/${encodeURIComponent(keyOrUrl)}`)
        try {
          const origin = new URL(BASE_URL)
          const root = `${origin.protocol}//${origin.host}`
          candidates.push(`${root}/o/${encodeURIComponent(keyOrUrl)}`)
        } catch {}
      }
      const attemptLogs: string[] = []
      let lastErr: any
      for (const url of candidates) {
        log(`Download <- ${keyOrUrl} (nip96 try ${url})`)
        const attempts: Array<{ init: RequestInit; label: string }> = [{ init: {}, label: 'no-auth' }]
        if (AUTH_MODE === 'nip98') {
          const auth = await makeNip98Header(url, 'GET')
          if (auth) attempts.push({ init: { headers: { Authorization: auth } }, label: 'nip-98' })
        }
        if (AUTH_TOKEN) attempts.push({ init: { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }, label: 'token' })
        for (const { init, label } of attempts) {
          try {
            const res = await fetch(url, init)
            if (!res.ok) {
              const text = await res.text().catch(() => '')
              attemptLogs.push(`${url} -> [${label}] HTTP ${res.status} ${res.statusText}${text ? ` - ${truncate(text)}` : ''}`)
              lastErr = new Error(`HTTP ${res.status}`)
              continue
            }
            attemptLogs.push(`${url} -> [${label}] OK 200`)
            const ct = res.headers.get('content-type') || ''
            if (ct.includes('application/json')) {
              const out = await res.json().catch(() => ({})) as any
              if (out && typeof out.data === 'string') return { mime: out.mime || 'application/octet-stream', base64Data: out.data }
            }
            const buf = await res.arrayBuffer()
            const u8 = new Uint8Array(buf)
            const b64 = arrayBufferToBase64(buf)
            const mime = ct || sniffMimeFromBytes(u8, 'application/octet-stream')
            // Debug: log what we detected
            log(`NIP-96 download: content-type="${ct}", sniffed="${ct ? 'n/a' : sniffMimeFromBytes(u8, 'application/octet-stream')}", final="${mime}", size=${u8.length}`)
            return { mime, base64Data: b64 }
          } catch (e) {
            lastErr = e
            attemptLogs.push(`${url} -> [${label}] ${(e as any)?.message || e}`)
          }
        }
      }
      if (opts?.verbose) emitToast(`Download failed for key ${keyOrUrl}. Attempts:\n- ${attemptLogs.join('\n- ')}`, 'error')
      throw lastErr || new Error('Fetch failed')
    } catch (e) {
      log(`NIP-96 key download failed: ${(e as any)?.message || e}`, 'warn')
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

function truncate(s: string, n = 240): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '…' : s
}

function guessExtFromMime(m: string): string {
  const map: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
  'video/webm': 'webm', 'video/mp4': 'mp4',
  'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg',
  'application/pdf': 'pdf'
  }
  return map[m] || ''
}

function sniffMimeFromBytes(u8: Uint8Array, fallback = 'application/octet-stream'): string {
  try {
    const asStr = (start: number, len: number) => Array.from(u8.slice(start, start + len)).map(c => String.fromCharCode(c)).join('')
    // JPEG
    if (u8.length > 3 && u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) return 'image/jpeg'
    // PNG
    if (u8.length > 8 && u8[0] === 0x89 && asStr(1,3) === 'PNG') return 'image/png'
    // GIF87a / GIF89a
    if (u8.length > 6 && (asStr(0,6) === 'GIF87a' || asStr(0,6) === 'GIF89a')) return 'image/gif'
    // WEBP (RIFF....WEBP)
    if (u8.length > 12 && asStr(0,4) === 'RIFF' && asStr(8,4) === 'WEBP') return 'image/webp'
    // PDF
    if (u8.length > 5 && asStr(0,5) === '%PDF-') return 'application/pdf'
    // SVG (text XML/HTML-ish)
    if (u8.length > 5) {
      const head = asStr(0, Math.min(128, u8.length)).trim().toLowerCase()
      if (head.startsWith('<?xml') || head.includes('<svg')) return 'image/svg+xml'
    }
    // MP4 variants (ftyp at offset 4)
    if (u8.length > 12 && asStr(4,4) === 'ftyp') {
      const subtype = asStr(8,4)
      // Common MP4 subtypes
      if (['isom', 'mp41', 'mp42', 'avc1', 'iso2', 'iso4', 'iso5', 'iso6', 'dash', 'm4a ', 'm4v ', 'M4A ', 'M4V '].some(s => subtype === s)) {
        return 'video/mp4'
      }
      // Default to MP4 for any ftyp
      return 'video/mp4'
    }
    // WebM/Matroska (EBML header)
    if (u8.length > 4 && u8[0] === 0x1A && u8[1] === 0x45 && u8[2] === 0xDF && u8[3] === 0xA3) return 'video/webm'
    // Ogg
    if (u8.length > 4 && asStr(0,4) === 'OggS') return 'audio/ogg'
    // WAV (RIFF....WAVE)
    if (u8.length > 12 && asStr(0,4) === 'RIFF' && asStr(8,4) === 'WAVE') return 'audio/wav'
    // MP3 (ID3 tag or frame sync 0xFFFB)
    if (u8.length > 3 && asStr(0,3) === 'ID3') return 'audio/mpeg'
    if (u8.length > 2 && u8[0] === 0xFF && (u8[1] & 0xE0) === 0xE0) return 'audio/mpeg'
  } catch {}
  return fallback || 'application/octet-stream'
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
