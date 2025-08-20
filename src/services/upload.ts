// Upload service: prefers HTTP backend when configured, falls back to in-memory store.
// The encryption stays the same; only the storage transport changes.

import { log } from '../ui/logger'
import { emitToast } from '../ui/Toast'
import { base64ToBytes, sha256Hex } from '../nostr/utils'
import { finalizeEvent, type EventTemplate, nip19 } from 'nostr-tools'
import { hexToBytes } from '../nostr/utils'
import { CONFIG } from '../config'
import { buildFromServerNip94, buildNip94Template, publishNip94 } from '../nostr/nip94'

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

async function getNip96Endpoints(): Promise<{ apiUrl: string; downloadBase: string; canonicalApiUrl: string; canonicalDownloadBase: string } | null> {
  if (MODE !== 'nip96') return null
  if (!BASE_URL) return null
  // Clear cache to ensure fresh discovery
  nip96Cache = null
  // Try cache, then discovery, fallback to provided BASE_URL
  const cfg = nip96Cache || await discoverNip96()
  console.log('[DEBUG] NIP-96 discovery result:', cfg)
  console.log('[DEBUG] BASE_URL from config:', BASE_URL)
  console.log('[DEBUG] PUBLIC_BASE_URL from config:', PUBLIC_BASE_URL)
  // Canonical (remote) endpoints used for NIP-98 'u' tag
  let canonicalApiUrl = (cfg?.api_url || BASE_URL).replace(/\/$/, '')
  let canonicalDownloadBase = (cfg?.download_url || cfg?.api_url || PUBLIC_BASE_URL || BASE_URL).replace(/\/$/, '')
  // Proxied endpoints used for actual fetches in dev
  let apiUrl = canonicalApiUrl
  let downloadBase = canonicalDownloadBase
  // In dev, rewrite to same-origin proxy to avoid CORS
  try {
    const dev = (import.meta as any).env?.DEV || (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname))
    if (dev) {
      const toProxy = (u: string) => {
        const url = new URL(u)
        return `/_relay${url.pathname}`.replace(/\/$/, '')
      }
      apiUrl = toProxy(apiUrl)
      downloadBase = toProxy(downloadBase)
    }
  } catch {}
  console.log('[DEBUG] NIP-96 endpoints - apiUrl:', apiUrl, 'downloadBase:', downloadBase)
  return { apiUrl, downloadBase, canonicalApiUrl, canonicalDownloadBase }
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

export async function putObject(key: string, mime: string, base64Data: string, opts?: { onUploadProgress?: (sent: number, total: number) => void }): Promise<string> {
  // Helper: upload with progress using XMLHttpRequest
  async function uploadWithProgress(form: FormData, url: string, headers?: Headers) {
    return new Promise<Response>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', url)
      if (headers) headers.forEach((v, k) => xhr.setRequestHeader(k, v))
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && opts?.onUploadProgress) opts.onUploadProgress(e.loaded, e.total)
      }
      xhr.onload = () => {
        // Parse raw header string to object
        const rawHeaders = xhr.getAllResponseHeaders()
        const headerObj: Record<string, string> = {}
        rawHeaders.split(/\r?\n/).forEach(line => {
          const idx = line.indexOf(':')
          if (idx > 0) {
            const key = line.slice(0, idx).trim()
            const val = line.slice(idx + 1).trim()
            if (key) headerObj[key] = val
          }
        })
        const res = new Response(xhr.response, { status: xhr.status, statusText: xhr.statusText, headers: headerObj })
        resolve(res)
      }
      xhr.onerror = () => reject(new Error('Upload failed'))
      xhr.responseType = 'arraybuffer'
      xhr.send(form)
    })
  }
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
  const canonicalApiUrl = (endpoints?.canonicalApiUrl || BASE_URL).replace(/\/$/, '')
        console.log('[DEBUG] Final upload URL will be:', apiUrl)
        const bytes = base64ToBytes(base64Data)
  // Copy into a plain ArrayBuffer to avoid SharedArrayBuffer typing issues
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  const file = new Blob([ab], { type: mime })
  const makeForm = () => {
          const f = new FormData()
          // Provide a stable filename; servers may ignore but it helps some setups
          const inferredExt = guessExtFromMime(mime) || 'bin'
          f.set('file', file, `upload.${inferredExt}`)
          // Keep ONLY the required 'file' field. Some servers reject unknown fields.
          return f
        }
    const buildManualMultipart = () => {
          const inferredExt = guessExtFromMime(mime) || 'bin'
          const filename = `upload.${inferredExt}`
          const boundary = '----GlobGramBoundary' + Math.random().toString(16).slice(2)
          const crlf = '\r\n'
          const head = `--${boundary}${crlf}`
            + `Content-Disposition: form-data; name="file"; filename="${filename}"${crlf}`
      + `Content-Type: ${mime || 'application/octet-stream'}${crlf}`
      + `Content-Transfer-Encoding: binary${crlf}${crlf}`
          const tail = `${crlf}--${boundary}--${crlf}`
          const enc = new TextEncoder()
          const headBytes = enc.encode(head)
          const tailBytes = enc.encode(tail)
          const bodyBytes = new Uint8Array(headBytes.length + bytes.length + tailBytes.length)
          bodyBytes.set(headBytes, 0)
          bodyBytes.set(bytes, headBytes.length)
          bodyBytes.set(tailBytes, headBytes.length + bytes.length)
          const contentType = `multipart/form-data; boundary=${boundary}`
          return { bodyBytes, contentType, filename }
        }
        // Optional extras (caption/alt) could be set by callers later
        const uploadUrl = apiUrl
        // Build attempt list with optional NIP-98 challenge from a probing 401
        let res: Response | null = null
        let lastErr: any = null
        const attemptLogs: string[] = []
        let challenge: string | undefined
        // Probe first without auth to extract WWW-Authenticate challenge (if any)
        const probeOnce = async (method: 'HEAD' | 'GET' | 'POST') => {
          try {
            const init: RequestInit = { method }
            if (method === 'POST') init.body = makeForm()
            init.headers = { 'Accept': 'application/json' }
            const resp = await fetch(uploadUrl, init)
            if (resp.status === 401) {
              const www = resp.headers.get('www-authenticate') || resp.headers.get('WWW-Authenticate') || ''
              attemptLogs.push(`[probe ${method}] HTTP ${resp.status} ${resp.statusText}${www ? ` - WWW-Authenticate: ${www}` : ''}`)
              const parsed = parseWwwAuthenticate(www)
              if (parsed?.scheme?.toLowerCase() === 'nostr') challenge = parsed.params['challenge']
              if (challenge) console.log('[DEBUG] NIP-98 challenge received (', method, '):', challenge)
            } else if (!resp.ok) {
              const text = await resp.text().catch(() => '')
              attemptLogs.push(`[probe ${method}] HTTP ${resp.status} ${resp.statusText}${text ? ` - ${truncate(text)}` : ''}`)
            } else {
              res = resp
              attemptLogs.push(`[probe ${method}] OK ${resp.status}`)
            }
          } catch (e: any) {
            attemptLogs.push(`[probe ${method}] ${e?.name || 'Error'}: ${e?.message || e}`)
          }
        }
  // Run fewer probes when not verbose to reduce console noise in dev
  const verbose = !!CONFIG.NIP98_VERBOSE
  if (!res) await probeOnce('HEAD')
  if (verbose && !res && !challenge) await probeOnce('GET')
  if (!res && !challenge) await probeOnce('POST')

  if (!res) {
          // Priority attempt: strict/minimal NIP-98 some servers require
          // Shape: base64url, content holds challenge, tags only [u:pathOnly, method:POST], no payload
          if (AUTH_MODE === 'nip98') {
            try {
              const urlObj = new URL(canonicalApiUrl)
              const pathOnly = urlObj.pathname.replace(/\/$/, '') || '/'
              const buildPriorityAuth = async (chal?: string) => await makeNip98HeaderCustom(
                pathOnly,
                'POST',
                undefined,
                undefined,
                chal || '',
                true, // base64url
                'upper'
              )
              const tryPriority = async (label: string, chal?: string) => {
                const auth = await buildPriorityAuth(chal)
                if (!auth) return
                const h = new Headers({ 'Authorization': auth, 'Accept': 'application/json' })
                // Also set X-Authorization for quirky proxies/servers
                h.set('X-Authorization', auth)
                // Debug decode tags
                try {
                  const raw = auth.replace(/^Nostr\s+/, '')
                  let t = raw.replace(/-/g, '+').replace(/_/g, '/')
                  while (t.length % 4) t += '='
                  const json = atob(t)
                  const obj = JSON.parse(json)
                  console.debug('[DEBUG] NIP-98 priority header tags', obj?.tags)
                } catch {}
                let r0: Response
                if (opts?.onUploadProgress) {
                  r0 = await uploadWithProgress(makeForm(), uploadUrl, h)
                } else {
                  r0 = await fetch(uploadUrl, { method: 'POST', body: makeForm(), headers: h })
                }
                if (r0.ok) { res = r0; attemptLogs.push(`[${label}] OK ${r0.status}`); return }
                const www0 = r0.headers.get('www-authenticate') || r0.headers.get('WWW-Authenticate') || ''
                const text0 = await r0.text().catch(() => '')
                attemptLogs.push(`[${label}] HTTP ${r0.status} ${r0.statusText}${www0 ? ` - WWW-Authenticate: ${www0}` : ''}${text0 ? ` - ${truncate(text0)}` : ''}`)
                // Retry once if server supplies a new challenge
                if (r0.status === 401 && www0) {
                  const parsed0 = parseWwwAuthenticate(www0)
                  const newChal0 = parsed0?.scheme?.toLowerCase() === 'nostr' ? parsed0.params['challenge'] : undefined
                  if (newChal0 && newChal0 !== challenge) {
                    const auth1 = await buildPriorityAuth(newChal0)
                    if (auth1) {
                      const h1 = new Headers({ 'Authorization': auth1, 'Accept': 'application/json' })
                      let r1: Response
                      if (opts?.onUploadProgress) {
                        r1 = await uploadWithProgress(makeForm(), uploadUrl, h1)
                      } else {
                        r1 = await fetch(uploadUrl, { method: 'POST', body: makeForm(), headers: h1 })
                      }
                      if (r1.ok) { res = r1; attemptLogs.push(`[${label} RETRY] OK ${r1.status}`) }
                      else {
                        const t1 = await r1.text().catch(() => '')
                        const www1 = r1.headers.get('www-authenticate') || r1.headers.get('WWW-Authenticate') || ''
                        attemptLogs.push(`[${label} RETRY] HTTP ${r1.status} ${r1.statusText}${www1 ? ` - WWW-Authenticate: ${www1}` : ''}${t1 ? ` - ${truncate(t1)}` : ''}`)
                      }
                    }
                  }
                }
              }
              // Always try once without challenge as well
              await tryPriority('nip-98-priority-nochal')
              if (!res && challenge) await tryPriority('nip-98-priority', challenge)

              // Non-conforming servers: try raw JSON (not base64) as Authorization
              if (!res) {
                try {
                  const now = Math.floor(Date.now() / 1000)
                  const unsigned: EventTemplate = { kind: 27235 as any, created_at: now, content: '', tags: [['u', pathOnly], ['method', 'POST']] }
                  const sk = getLocalSKBytes()
                  let signed: any | null = null
                  if (sk) signed = finalizeEvent(unsigned, sk)
                  else if ((window as any)?.nostr?.signEvent) { try { signed = await (window as any).nostr.signEvent(unsigned) } catch {} }
                  if (signed) {
                    const raw = `Nostr ${JSON.stringify(signed)}`
                    const h2 = new Headers({ 'Authorization': raw, 'Accept': 'application/json' })
                    h2.set('X-Authorization', raw)
                    let r2: Response
                    if (opts?.onUploadProgress) {
                      r2 = await uploadWithProgress(makeForm(), uploadUrl, h2)
                    } else {
                      r2 = await fetch(uploadUrl, { method: 'POST', body: makeForm(), headers: h2 })
                    }
                    if (r2.ok) { res = r2; attemptLogs.push(`[nip-98-rawjson] OK ${r2.status}`) }
                    else {
                      const www2 = r2.headers.get('www-authenticate') || r2.headers.get('WWW-Authenticate') || ''
                      const text2 = await r2.text().catch(() => '')
                      attemptLogs.push(`[nip-98-rawjson] HTTP ${r2.status} ${r2.statusText}${www2 ? ` - WWW-Authenticate: ${www2}` : ''}${text2 ? ` - ${truncate(text2)}` : ''}`)
                    }
                  }
                } catch (e: any) {
                  attemptLogs.push(`[nip-98-rawjson] ${e?.message || e}`)
                }
              }
            } catch (e: any) {
              attemptLogs.push(`[nip-98-priority] ${e?.message || e}`)
            }
          }

          const attempts: Array<{ init: RequestInit; label: string }> = []
          // Predeclare variables so we can reuse in retry logic
          let fileHashHex: string | undefined
          let fileHashB64: string | null = null
          let bodyHashHex: string | undefined
          let bodyHashB64: string | null = null
          let bodyB64: string | null = null
          let bodyB64url: string | null = null
          let multipartBytes: Uint8Array | undefined
          let multipartCT: string | undefined
          if (AUTH_MODE === 'nip98') {
            console.log('[DEBUG] Attempting NIP-98 auth for URL:', uploadUrl)
            // Compute hashes of both file bytes and a manual multipart body to satisfy different servers
            fileHashHex = await sha256Hex(bytes)
            let payloadHashB64: string | null = null
            try {
              const payloadBytes = hexToBytes(fileHashHex)
              let s = ''
              for (let i = 0; i < payloadBytes.length; i++) s += String.fromCharCode(payloadBytes[i])
              payloadHashB64 = btoa(s)
            } catch {}
            fileHashB64 = payloadHashB64
            const manualBuilt = buildManualMultipart()
            multipartBytes = manualBuilt.bodyBytes
            multipartCT = manualBuilt.contentType
            bodyHashHex = await sha256Hex(multipartBytes)
            let bodyHashB64Local: string | null = null
            try {
              const payloadBytes = hexToBytes(bodyHashHex)
              let s = ''
              for (let i = 0; i < payloadBytes.length; i++) s += String.fromCharCode(payloadBytes[i])
              bodyHashB64Local = btoa(s)
            } catch {}
            bodyHashB64 = bodyHashB64Local
            // Also compute base64 of entire multipart body (not just the hash) for servers expecting raw body in payload
            try {
              const mb = multipartBytes
              let s = ''
              for (let i = 0; i < mb.length; i++) s += String.fromCharCode(mb[i])
              bodyB64 = btoa(s)
              bodyB64url = bodyB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
            } catch {}
            const addAttempt = async (label: string, payload?: string, withChallenge = false) => {
              const extraTags: Array<[string, string]> = []
              if (withChallenge && challenge) extraTags.push(['challenge', challenge])
              const auth = await makeNip98HeaderWithTags(canonicalApiUrl, 'POST', payload, extraTags)
              if (auth) {
                const h = new Headers()
                h.set('Authorization', auth)
                // If payload corresponds to body hash, use the manual multipart bytes; otherwise use FormData
                const useManual = payload === bodyHashHex || payload === bodyHashB64
                if (useManual) {
                  if (multipartCT) h.set('Content-Type', multipartCT)
                  h.set('Accept', 'application/json')
                  h.set('X-Manual-Multipart', '1')
                  const mb = multipartBytes!
                  const ab = new ArrayBuffer(mb.byteLength)
                  new Uint8Array(ab).set(mb)
                  attempts.push({ init: { method: 'POST', body: new Blob([ab], { type: multipartCT || '' }), headers: h }, label })
                } else {
                  h.set('Accept', 'application/json')
                  attempts.push({ init: { method: 'POST', body: makeForm(), headers: h }, label })
                }
              }
            }
            // Minimal set unless verbose
            await addAttempt('nip-98-challenge-no-payload', undefined, true)
            if (verbose) {
              // Body-hash payload (exact request bytes)
              await addAttempt('nip-98-challenge-with-body-hash', bodyHashHex, true)
              if (bodyHashB64) await addAttempt('nip-98-challenge-with-body-hash-b64', bodyHashB64, true)
              // File-hash payload variants
              await addAttempt('nip-98-challenge-with-file-hash', fileHashHex, true)
              if (payloadHashB64) await addAttempt('nip-98-challenge-with-file-hash-b64', payloadHashB64, true)
              // Legacy attempts without challenge
              await addAttempt('nip-98-no-payload')
              await addAttempt('nip-98-with-body-hash', bodyHashHex)
              if (bodyHashB64) await addAttempt('nip-98-with-body-hash-b64', bodyHashB64)
              await addAttempt('nip-98-with-file-hash', fileHashHex)
              if (payloadHashB64) await addAttempt('nip-98-with-file-hash-b64', payloadHashB64)
            }
            if (attempts.length === 0) emitToast('Cannot sign NIP-98 auth. Import a key or enable a NIP-07 extension.', 'error')
          }
      // Bearer token attempt last
          if (AUTH_TOKEN) {
            const h = new Headers()
            h.set('Authorization', `Bearer ${AUTH_TOKEN}`)
            h.set('Accept', 'application/json')
            attempts.push({ init: { method: 'POST', body: makeForm(), headers: h }, label: 'token' })
          }
          for (const { init, label } of attempts) {
            try {
              let r: Response
              if (opts?.onUploadProgress && init.method === 'POST' && init.body instanceof FormData) {
                r = await uploadWithProgress(init.body, uploadUrl, init.headers instanceof Headers ? init.headers : undefined)
              } else {
                r = await fetch(uploadUrl, init)
              }
              if (r.ok) { res = r; attemptLogs.push(`[${label}] OK ${r.status}`); break }
              // If 401 and server provided a fresh challenge, retry once with that challenge
              if (r.status === 401) {
                const www = r.headers.get('www-authenticate') || r.headers.get('WWW-Authenticate') || ''
                const parsed = parseWwwAuthenticate(www)
                const newChallenge = parsed?.scheme?.toLowerCase() === 'nostr' ? parsed.params['challenge'] : undefined
                if (newChallenge && newChallenge !== challenge) {
                  const h = new Headers(init.headers || {})
          // Detect if this attempt used manual body via our marker header
          const usedManual = h.get('X-Manual-Multipart') === '1'
          const payload = usedManual ? bodyHashHex : fileHashHex
          const payloadB64 = usedManual ? bodyHashB64 : fileHashB64
                  const extraTags: Array<[string, string]> = [['challenge', newChallenge]]
                  const authRetry = await makeNip98HeaderWithTags(canonicalApiUrl, 'POST', payload || undefined, extraTags)
                  if (authRetry) {
                    h.set('Authorization', authRetry)
                    const retryInit: RequestInit = { method: 'POST', headers: h }
                    if (usedManual) {
                      h.set('Accept', 'application/json')
                      {
                        const mb2 = multipartBytes!
                        const ab2 = new ArrayBuffer(mb2.byteLength)
                        new Uint8Array(ab2).set(mb2)
                        retryInit.body = new Blob([ab2], { type: h.get('Content-Type') || '' })
                      }
                    } else {
                      retryInit.body = makeForm()
                    }
                    let r2: Response
                    if (opts?.onUploadProgress && retryInit.method === 'POST' && retryInit.body instanceof FormData) {
                      r2 = await uploadWithProgress(retryInit.body, uploadUrl, retryInit.headers instanceof Headers ? retryInit.headers : undefined)
                    } else {
                      r2 = await fetch(uploadUrl, retryInit)
                    }
                    if (r2.ok) { res = r2; attemptLogs.push(`[${label} RETRY challenge] OK ${r2.status}`); break }
                    const t2 = await r2.text().catch(() => '')
                    attemptLogs.push(`[${label} RETRY challenge] HTTP ${r2.status} ${r2.statusText}${t2 ? ` - ${truncate(t2)}` : ''}`)
                  }
                }
              }
              const www = r.headers.get('www-authenticate') || r.headers.get('WWW-Authenticate') || ''
              const text = await r.text().catch(() => '')
              attemptLogs.push(`[${label}] HTTP ${r.status} ${r.statusText}${www ? ` - WWW-Authenticate: ${www}` : ''}${text ? ` - ${truncate(text)}` : ''}`)
              lastErr = new Error(`HTTP ${r.status}`)
            } catch (e: any) {
              attemptLogs.push(`[${label}] ${e?.name || 'Error'}: ${e?.message || e}`)
              lastErr = e
            }
          }
          // If still no success and we have NIP-98, try alternative 'u' canonicalizations and header encodings
          if (!res && AUTH_MODE === 'nip98' && CONFIG.NIP98_VERBOSE) {
            try {
              const urlObj = new URL(canonicalApiUrl)
              const pathOnly = urlObj.pathname.replace(/\/$/, '') || '/'
              const httpVariant = urlObj.protocol === 'https:' ? `http://${urlObj.host}${pathOnly}` : canonicalApiUrl
              const uVariants = Array.from(new Set<string>([
                canonicalApiUrl,
                canonicalApiUrl + '/',
                httpVariant,
                httpVariant + '/',
                pathOnly,
                pathOnly + '/',
              ]))
              const secondAttempts: Array<{ init: RequestInit; label: string }> = []
              const toB64Url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
              const buildAuth = async (u: string, payload?: string, withChallenge?: boolean, encUrl?: boolean, challengeInContent?: boolean, methodCase: MethodCase = 'both') => {
                const extraTags: Array<[string, string]> = []
                const content = withChallenge && challengeInContent && challenge ? challenge : undefined
                if (withChallenge && challenge && !challengeInContent) extraTags.push(['challenge', challenge])
                return await makeNip98HeaderCustom(u, 'POST', payload, extraTags, content, !!encUrl, methodCase)
              }
              const pushAttempt = async (label: string, u: string, useManual: boolean, payload?: string, encUrl?: boolean, challengeInContent?: boolean, methodCase: MethodCase = 'both') => {
                const auth = await buildAuth(u, payload, true, encUrl, challengeInContent, methodCase)
                if (!auth) return
                const h = new Headers()
                h.set('Authorization', auth)
                // Some servers erroneously look at X-Authorization; set both
                h.set('X-Authorization', auth)
                h.set('Accept', 'application/json')
                // Debug decode of tags
                try {
                  const raw = auth.replace(/^Nostr\s+/, '')
                  const toStd = (s: string) => {
                    // convert base64url to standard base64 with padding
                    let t = s.replace(/-/g, '+').replace(/_/g, '/')
                    while (t.length % 4) t += '='
                    return t
                  }
                  const json = atob(toStd(raw))
                  const obj = JSON.parse(json)
                  console.debug('[DEBUG] NIP-98 header tags for', label, obj?.tags)
                } catch {}
                if (useManual) {
                  if (multipartCT) h.set('Content-Type', multipartCT)
                  const mb = multipartBytes!
                  const ab = new ArrayBuffer(mb.byteLength)
                  new Uint8Array(ab).set(mb)
                  secondAttempts.push({ init: { method: 'POST', body: new Blob([ab], { type: multipartCT || '' }), headers: h }, label })
                } else {
                  secondAttempts.push({ init: { method: 'POST', body: makeForm(), headers: h }, label })
                }
              }
              // Limit second wave to a focused matrix: {uVariants} x {std vs url b64} x {challenge-in-content true/false} for key payloads
              for (const u of uVariants) {
                for (const encUrl of [false, true]) {
                  for (const mCase of ['upper', 'lower'] as MethodCase[]) {
                  // no-payload variants (challenge in tag and in content)
                  await pushAttempt(`nip-98-v2-u:${u} enc:${encUrl} m:${mCase}-chalTag-noPayload`, u, false, undefined, encUrl, false, mCase)
                  await pushAttempt(`nip-98-v2-u:${u} enc:${encUrl} m:${mCase}-chalContent-noPayload`, u, false, undefined, encUrl, true, mCase)
                  // body-hash variants using manual multipart body
                  if (bodyHashHex) {
                    await pushAttempt(`nip-98-v2-u:${u} enc:${encUrl} m:${mCase}-chalTag-bodyHash`, u, true, bodyHashHex, encUrl, false, mCase)
                    await pushAttempt(`nip-98-v2-u:${u} enc:${encUrl} m:${mCase}-chalContent-bodyHash`, u, true, bodyHashHex, encUrl, true, mCase)
                    if (bodyHashB64) {
                      await pushAttempt(`nip-98-v2-u:${u} enc:${encUrl} m:${mCase}-chalTag-bodyHashB64`, u, true, bodyHashB64, encUrl, false, mCase)
                      await pushAttempt(`nip-98-v2-u:${u} enc:${encUrl} m:${mCase}-chalContent-bodyHashB64`, u, true, bodyHashB64, encUrl, true, mCase)
                      await pushAttempt(`nip-98-v2-u:${u} enc:${encUrl} m:${mCase}-chalTag-bodyHashB64url`, u, true, toB64Url(bodyHashB64), encUrl, false, mCase)
                      await pushAttempt(`nip-98-v2-u:${u} enc:${encUrl} m:${mCase}-chalContent-bodyHashB64url`, u, true, toB64Url(bodyHashB64), encUrl, true, mCase)
                    }
                    // raw-body payload (b64/b64url) variants
                    if (bodyB64) {
                      await pushAttempt(`nip-98-v2-u:${u} enc:${encUrl} m:${mCase}-chalTag-bodyB64`, u, true, bodyB64, encUrl, false, mCase)
                      await pushAttempt(`nip-98-v2-u:${u} enc:${encUrl} m:${mCase}-chalContent-bodyB64`, u, true, bodyB64, encUrl, true, mCase)
                    }
                    if (bodyB64url) {
                      await pushAttempt(`nip-98-v2-u:${u} enc:${encUrl} m:${mCase}-chalTag-bodyB64url`, u, true, bodyB64url, encUrl, false, mCase)
                      await pushAttempt(`nip-98-v2-u:${u} enc:${encUrl} m:${mCase}-chalContent-bodyB64url`, u, true, bodyB64url, encUrl, true, mCase)
                    }
                  }
                  // file-hash variant using FormData body
                  if (fileHashHex) {
                    await pushAttempt(`nip-98-v2-u:${u} enc:${encUrl} m:${mCase}-chalTag-fileHash`, u, false, fileHashHex, encUrl, false, mCase)
                    await pushAttempt(`nip-98-v2-u:${u} enc:${encUrl} m:${mCase}-chalContent-fileHash`, u, false, fileHashHex, encUrl, true, mCase)
                  }
                  }
                }
              }
              for (const { init, label } of secondAttempts) {
                try {
                  let r: Response
                  if (opts?.onUploadProgress && init.method === 'POST' && init.body instanceof FormData) {
                    r = await uploadWithProgress(init.body, uploadUrl, init.headers instanceof Headers ? init.headers : undefined)
                  } else {
                    r = await fetch(uploadUrl, init)
                  }
                  if (r.ok) { res = r; attemptLogs.push(`[${label}] OK ${r.status}`); break }
                  const www = r.headers.get('www-authenticate') || r.headers.get('WWW-Authenticate') || ''
                  const text = await r.text().catch(() => '')
                  attemptLogs.push(`[${label}] HTTP ${r.status} ${r.statusText}${www ? ` - WWW-Authenticate: ${www}` : ''}${text ? ` - ${truncate(text)}` : ''}`)
                } catch (e: any) {
                  attemptLogs.push(`[${label}] ${e?.name || 'Error'}: ${e?.message || e}`)
                }
              }
            } catch (e) {
              attemptLogs.push(`[nip-98 second-wave] ${(e as any)?.message || e}`)
            }
          }
        }
        if (!res || !res.ok) {
          try { console.error('[DEBUG] Upload attempts summary for', uploadUrl, '\n- ' + attemptLogs.join('\n- ')) } catch {}
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
          const urlFromTag = urlTag && typeof urlTag[1] === 'string' ? urlTag[1] : undefined
          // Auto-publish NIP-94 using server-provided nip94_event if configured
          try {
            if (CONFIG.AUTO_PUBLISH_NIP94) {
              const tmpl = buildFromServerNip94(nip94)
              if (tmpl) publishNip94(tmpl)
            }
          } catch {}
          if (urlFromTag) return urlFromTag
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
          const url = `${base}/${oxTag[1]}${ext ? '.'+ext : ''}`
          // If we didn't publish above, publish our own NIP-94 based on constructed url
          try {
            if (CONFIG.AUTO_PUBLISH_NIP94 && (!nip94 || !Array.isArray(nip94.tags))) {
              const tmpl = buildNip94Template({ url, mime: mTag?.[1] || mime, ox: oxTag[1], service: 'nip96' })
              publishNip94(tmpl)
            }
          } catch {}
          return url
        }
        throw new Error('Upload response missing url')
      } else {
        // Simple mode: POST JSON to /upload on the configured backend.
        // Be defensive to avoid double '/upload/upload' if BASE_URL already points to '/upload'.
        const baseTrimmed = BASE_URL.replace(/\/$/, '')
        const url = baseTrimmed.endsWith('/upload') ? baseTrimmed : `${baseTrimmed}/upload`
        let res: Response
        // No progress for JSON uploads; fallback to fetch
        res = await fetch(url, withAuth({
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

export async function getObject(keyOrUrl: string, opts?: { verbose?: boolean; onProgress?: (received: number, total?: number) => void }): Promise<{ mime: string; base64Data: string } | null> {
  function u8ToArrayBuffer(u8: Uint8Array): ArrayBuffer {
    const ab = new ArrayBuffer(u8.byteLength)
    new Uint8Array(ab).set(u8)
    return ab
  }
  async function readWithProgress(res: Response, onProgress?: (received: number, total?: number) => void): Promise<{ u8: Uint8Array; ct: string }> {
    const ct = res.headers.get('content-type') || ''
    if (!onProgress || !res.body) {
      const buf = await res.arrayBuffer()
      return { u8: new Uint8Array(buf), ct }
    }
    const total = Number(res.headers.get('content-length') || '') || undefined
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.byteLength
        try { onProgress(received, total) } catch {}
      }
    }
    const allLen = chunks.reduce((n, c) => n + c.byteLength, 0)
    const out = new Uint8Array(allLen)
    let offset = 0
    for (const c of chunks) { out.set(c, offset); offset += c.byteLength }
    return { u8: out, ct }
  }
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
  const { u8 } = await readWithProgress(res, opts?.onProgress)
  const b64 = arrayBufferToBase64(u8ToArrayBuffer(u8))
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
  const { u8 } = await readWithProgress(res, opts?.onProgress)
  const b64 = arrayBufferToBase64(u8ToArrayBuffer(u8))
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
        // Hash style resources live directly under downloadBase (prefer server-provided download_url)
        candidates.push(`${endpoints.downloadBase.replace(/\/$/, '')}/${encodeURIComponent(keyOrUrl)}`)
      } else {
        // If key looks like '<64hex>:...' (legacy/simple server key), derive the leading hash and try direct hash path
        const m = keyOrUrl.match(/^([0-9a-f]{64})(?::.+)$/i)
        if (m) {
          const hash = m[1]
          candidates.push(`${endpoints.downloadBase.replace(/\/$/, '')}/${hash}`)
        }
        // For server-generated keys, prefer the discovered downloadBase first
        const baseTrimmed = endpoints.apiUrl.replace(/\/$/, '')
        const pubTrimmed = (PUBLIC_BASE_URL || '').replace(/\/$/, '')
        const dlTrimmed = endpoints.downloadBase.replace(/\/$/, '')
        // Try download base '/o/:key' first (some servers expose key endpoints under download base)
        candidates.push(`${dlTrimmed}/o/${encodeURIComponent(keyOrUrl)}`)
        candidates.push(`${baseTrimmed}/o/${encodeURIComponent(keyOrUrl)}`)
        if (pubTrimmed && pubTrimmed !== baseTrimmed) candidates.push(`${pubTrimmed}/o/${encodeURIComponent(keyOrUrl)}`)
        try {
          const origin = new URL(BASE_URL)
          const root = `${origin.protocol}//${origin.host}`
          if (root !== baseTrimmed && root !== pubTrimmed) candidates.push(`${root}/o/${encodeURIComponent(keyOrUrl)}`)
        } catch {}
      }
      const attemptLogs: string[] = []
      let lastErr: any
  log(`NIP-96 download candidates for key ${keyOrUrl}:\n- ${candidates.join('\n- ')}`)
  for (const url of candidates) {
        log(`Download <- ${keyOrUrl} (nip96 try ${url})`)
        const attempts: Array<{ init: RequestInit; label: string }> = [{ init: {}, label: 'no-auth' }]
        if (AUTH_MODE === 'nip98') {
          // Map proxied URL back to canonical remote URL for NIP-98 'u'
          let canonicalUrl = url
          try {
            if (url.startsWith('/_relay')) {
              // Decide whether this is under upload (api) or media (download)
              if (url.startsWith('/_relay/upload')) {
                canonicalUrl = url.replace('/_relay/upload', endpoints.canonicalApiUrl)
              } else if (url.startsWith('/_relay/media')) {
                canonicalUrl = url.replace('/_relay/media', endpoints.canonicalDownloadBase)
              }
            }
          } catch {}
          const auth = await makeNip98Header(canonicalUrl, 'GET')
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
            const { u8 } = await readWithProgress(res, opts?.onProgress)
            const b64 = arrayBufferToBase64(u8ToArrayBuffer(u8))
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
    const skBytes = getLocalSKBytes()
    console.log('[DEBUG] NIP-98 auth - private key available:', !!skBytes)
    let signed: any | null = null
    if (skBytes) {
      signed = finalizeEvent(unsigned, skBytes)
      console.log('[DEBUG] NIP-98 auth - signed with local key, kind:', signed.kind)
    } else if (typeof (globalThis as any).window !== 'undefined' && (window as any).nostr?.signEvent) {
      try { 
        signed = await (window as any).nostr.signEvent(unsigned)
        console.log('[DEBUG] NIP-98 auth - signed with NIP-07, kind:', signed?.kind)
      } catch (e) {
        console.log('[DEBUG] NIP-98 auth - NIP-07 signing failed:', e)
      }
    }
    if (!signed) {
      console.log('[DEBUG] NIP-98 auth - no signing method available')
      return null
    }
    const json = JSON.stringify(signed)
    const b64 = btoa(unescape(encodeURIComponent(json)))
    console.log('[DEBUG] NIP-98 auth - header created, length:', b64.length)
    return `Nostr ${b64}`
  } catch (e) {
    console.log('[DEBUG] NIP-98 auth - error:', e)
    return null
  }
}

// Variant that allows injecting extra tags like ['challenge', '...']
async function makeNip98HeaderWithTags(url: string, method: string, payloadHex?: string, extraTags?: Array<[string, string]>): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const tags: Array<[string, string]> = [ ['u', url], ['method', method.toUpperCase()] ]
    if (payloadHex) tags.push(['payload', payloadHex])
    if (Array.isArray(extraTags)) {
      for (const t of extraTags) {
        if (Array.isArray(t) && typeof t[0] === 'string' && typeof t[1] === 'string') tags.push([t[0], t[1]])
      }
    }
    const unsigned: EventTemplate = { kind: 27235 as any, created_at: now, content: '', tags }
    const skBytes = getLocalSKBytes()
    console.log('[DEBUG] NIP-98 auth - private key available:', !!skBytes)
    let signed: any | null = null
    if (skBytes) {
      signed = finalizeEvent(unsigned, skBytes)
      console.log('[DEBUG] NIP-98 auth - signed with local key, kind:', signed.kind)
    } else if (typeof (globalThis as any).window !== 'undefined' && (window as any).nostr?.signEvent) {
      try { 
        signed = await (window as any).nostr.signEvent(unsigned)
        console.log('[DEBUG] NIP-98 auth - signed with NIP-07, kind:', signed?.kind)
      } catch (e) {
        console.log('[DEBUG] NIP-98 auth - NIP-07 signing failed:', e)
      }
    }
    if (!signed) {
      console.log('[DEBUG] NIP-98 auth - no signing method available')
      return null
    }
    const json = JSON.stringify(signed)
    const b64 = btoa(unescape(encodeURIComponent(json)))
    console.log('[DEBUG] NIP-98 auth - header created, length:', b64.length)
    return `Nostr ${b64}`
  } catch (e) {
    console.log('[DEBUG] NIP-98 auth - error:', e)
    return null
  }
}

// Custom variant: supports base64url JSON encoding and putting challenge into content.
type MethodCase = 'both' | 'upper' | 'lower'
async function makeNip98HeaderCustom(url: string, method: string, payloadHex?: string, extraTags?: Array<[string, string]>, content?: string, base64Url?: boolean, methodCase: MethodCase = 'both'): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000)
  const tags: Array<[string, string]> = [ ['u', url] ]
  if (methodCase === 'both' || methodCase === 'upper') tags.push(['method', method.toUpperCase()])
  if (methodCase === 'both' || methodCase === 'lower') tags.push(['method', method.toLowerCase()])
    if (payloadHex) tags.push(['payload', payloadHex])
    if (Array.isArray(extraTags)) {
      for (const t of extraTags) {
        if (Array.isArray(t) && typeof t[0] === 'string' && typeof t[1] === 'string') tags.push([t[0], t[1]])
      }
    }
    const unsigned: EventTemplate = { kind: 27235 as any, created_at: now, content: content || '', tags }
    const skBytes = getLocalSKBytes()
    let signed: any | null = null
    if (skBytes) signed = finalizeEvent(unsigned, skBytes)
    else if (typeof (globalThis as any).window !== 'undefined' && (window as any).nostr?.signEvent) {
      try { signed = await (window as any).nostr.signEvent(unsigned) } catch {}
    }
    if (!signed) return null
    const json = JSON.stringify(signed)
    if (!base64Url) {
      const b64 = btoa(unescape(encodeURIComponent(json)))
      return `Nostr ${b64}`
    }
    // base64url without padding
    const b64std = btoa(unescape(encodeURIComponent(json)))
    const b64url = b64std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return `Nostr ${b64url}`
  } catch {
    return null
  }
}

function getLocalSKBytes(): Uint8Array | null {
  try {
    const sk = localStorage.getItem('nostr_sk')
    if (!sk) return null
    if (/^[0-9a-fA-F]{64}$/.test(sk)) return hexToBytes(sk)
    if (sk.startsWith('nsec')) {
      try {
        const decoded = nip19.decode(sk)
        if (decoded?.type === 'nsec' && decoded.data instanceof Uint8Array) return decoded.data as Uint8Array
        if (decoded?.type === 'nsec' && Array.isArray(decoded.data)) return new Uint8Array(decoded.data as number[])
      } catch {}
    }
  } catch {}
  return null
}

// Minimal parser for WWW-Authenticate header. Returns auth scheme and key/value params.
function parseWwwAuthenticate(header: string): { scheme: string; params: Record<string, string> } | null {
  if (!header) return null
  const m = header.match(/^\s*([A-Za-z][A-Za-z0-9_-]*)\s*(.*)$/)
  if (!m) return null
  const scheme = m[1]
  let rest = m[2] || ''
  const params: Record<string, string> = {}
  // Split by commas not inside quotes
  const parts: string[] = []
  let buf = ''
  let q = false
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]
    if (c === '"') { q = !q; buf += c; continue }
    if (c === ',' && !q) { if (buf.trim()) parts.push(buf.trim()); buf = ''; continue }
    buf += c
  }
  if (buf.trim()) parts.push(buf.trim())
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq < 0) continue
    const k = p.slice(0, eq).trim()
    let v = p.slice(eq + 1).trim()
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    params[k] = v
  }
  return { scheme, params }
}
