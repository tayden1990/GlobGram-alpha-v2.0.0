import { getPublicKey, nip04, nip19, finalizeEvent, type Event, type EventTemplate } from 'nostr-tools'
import { getRelayPool, resetRelayPool, trackListener } from './pool'
import { hexToBytes, bytesToHex, bytesToBase64 } from './utils'
import { encryptDataURL, type EncryptedMedia } from './media'
import { putObject, getObject, parseMemUrl } from '../services/upload'
import { useChatStore, type ChatMessage } from '../state/chatStore'
import { useRelayStore } from '../state/relayStore'
import { useRoomStore } from '../state/roomStore'
import { useSettingsStore } from '../ui/settingsStore'
import { log } from '../ui/logger'
import { emitToast } from '../ui/Toast'
import { tGlobal } from '../i18n'
import { CONFIG } from '../config'

// Helper to generate filename from data URL MIME
function dataUrlToFilename(durl: string): string {
  try {
    const m = /^data:([^;]+);/.exec(durl)
    const mime = (m?.[1] || '').toLowerCase()
    const extMap: Record<string, string> = {
      'application/pdf': 'pdf',
      'application/zip': 'zip', 'application/x-zip-compressed': 'zip',
      'application/x-7z-compressed': '7z',
      'application/x-rar-compressed': 'rar', 'application/vnd.rar': 'rar',
      'application/json': 'json', 'text/plain': 'txt', 'text/csv': 'csv', 'text/markdown': 'md', 'text/html': 'html',
      'application/xml': 'xml', 'text/xml': 'xml', 'application/rtf': 'rtf',
      'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'application/vnd.android.package-archive': 'apk', 'application/x-msdownload': 'exe',
      'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif',
      'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/aac': 'aac', 'audio/flac': 'flac',
      'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/3gpp': '3gp'
    }
    const ext = extMap[mime] || 'bin'
    return `download.${ext}`
  } catch {
    return 'download.bin'
  }
}

// Stable per-session room subscription id and per-relay active state to prevent duplicate REQs
let ROOM_SUB_ID: string | null = null
const activeRoomSubs = new Map<string, { roomId: string | null, subId: string }>() // key: relay url

function getOrCreateRoomSubId(pk: string) {
  if (!ROOM_SUB_ID) ROOM_SUB_ID = `roomCur:${pk.slice(0, 8)}:${Math.random().toString(36).slice(2, 8)}`
  return ROOM_SUB_ID
}

// Normalize data URL mime using simple signature sniffing when provided mime is generic/missing
function normalizeDataUrlMime(dataUrl: string): string {
  try {
    if (!dataUrl.startsWith('data:')) return dataUrl
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl)
    if (!m) return dataUrl
    const mime = (m[1] || '').toLowerCase()
    const isB64 = (m[2] || '').toLowerCase().includes('base64')
    const payload = m[3] || ''
    const bytes = (() => {
      if (isB64) {
        const bin = atob(payload)
        const u = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
        return u
      }
      const dec = decodeURIComponent(payload)
      const enc = new TextEncoder()
      return enc.encode(dec)
    })()
    const asStr = (start: number, len: number) => Array.from(bytes.slice(start, start + len)).map(c => String.fromCharCode(c)).join('')
    let sniff: string | null = null
    if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) sniff = 'image/jpeg'
    else if (bytes.length > 8 && bytes[0] === 0x89 && asStr(1,3) === 'PNG') sniff = 'image/png'
    else if (bytes.length > 6 && (asStr(0,6) === 'GIF87a' || asStr(0,6) === 'GIF89a')) sniff = 'image/gif'
    else if (bytes.length > 12 && asStr(0,4) === 'RIFF' && asStr(8,4) === 'WEBP') sniff = 'image/webp'
    else if (bytes.length > 5 && asStr(0,5) === '%PDF-') sniff = 'application/pdf'
    else if (bytes.length > 5) {
      const head = asStr(0, Math.min(128, bytes.length)).trim().toLowerCase()
      if (head.startsWith('<?xml') || head.includes('<svg')) sniff = 'image/svg+xml'
    }
    else if (bytes.length > 12 && asStr(4,4) === 'ftyp') sniff = 'video/mp4'
    else if (bytes.length > 4 && bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) sniff = 'video/webm'
    else if (bytes.length > 4 && asStr(0,4) === 'OggS') sniff = 'audio/ogg'
    else if (bytes.length > 12 && asStr(0,4) === 'RIFF' && asStr(8,4) === 'WAVE') sniff = 'audio/wav'
    else if (bytes.length > 3 && asStr(0,3) === 'ID3') sniff = 'audio/mpeg'
    else if (bytes.length > 2 && bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) sniff = 'audio/mpeg'
    const finalMime = sniff || mime || 'application/octet-stream'
    // Rebuild data URL with corrected mime if changed
    if (finalMime === mime || !finalMime) return dataUrl
    const prefix = `data:${finalMime}${isB64 ? ';base64' : ''},`
    return prefix + payload
  } catch {
    return dataUrl
  }
}

export function startNostrEngine(sk: string) {
  // DEBUG: Validate private key before starting
  try {
    const testBytes = hexToBytes(sk)
    const testPk = getPublicKey(testBytes)
    log(`🔍 Engine starting with PK: ${testPk.slice(0,12)}...`)
    
    // Test event creation capability
    const testTemplate: EventTemplate = { kind: 1, created_at: Math.floor(Date.now()/1000), content: 'test', tags: [] }
    const testEvt = finalizeEvent(testTemplate, testBytes)
    log(`🔍 Test event validation: ID=${testEvt.id?.slice(0,12)}..., PK_match=${testEvt.pubkey === testPk}`)
    
    if (!testEvt.id || !testEvt.pubkey || !testEvt.sig) {
      log(`❌ Critical: Cannot create valid events with current key`, 'error')
      throw new Error('Invalid key - cannot create events')
    }
  } catch (error) {
    log(`❌ Engine startup validation failed: ${error}`, 'error')
    throw error
  }
  
  const pk = getPublicKey(hexToBytes(sk))
  const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
  const pool = getRelayPool(urls)
  const seen = new Set<string>()
  log(`Engine start for ${pk.slice(0,8)}…, relays: ${urls.length}`)
  // Generate stable-but-unique REQ ids per session to avoid collisions across tabs
  const mkSubId = (name: string) => `${name}:${pk.slice(0, 8)}:${Math.random().toString(36).slice(2, 8)}`
  const SUBS = {
    inbox: mkSubId('inbox'),
    inbox2: mkSubId('inbox2'),
    typing: mkSubId('typing'),
    roomsMeta: mkSubId('roomsMeta'),
    roomCur: mkSubId('roomCur'),
    receipts: mkSubId('receipts'),
  }
  const sub = JSON.stringify(["REQ", SUBS.inbox, { kinds: [4], authors: [pk] }])
  const sub2 = JSON.stringify(["REQ", SUBS.inbox2, { kinds: [4], '#p': [pk] }])
  const subTyping = JSON.stringify(["REQ", SUBS.typing, { kinds: [20000], '#p': [pk] }])
  // Only subscribe globally to channel metadata (40/41); avoid flooding all messages (42)
  const subRoomsMeta = JSON.stringify(["REQ", SUBS.roomsMeta, { kinds: [40,41] }])
  const subReceipts = JSON.stringify(["REQ", SUBS.receipts, { kinds: [10001 as any], '#p': [pk] }])
  // Maintain a focused subscription for currently selected room messages, deduped per relay
  const updateCurrentRoomSub = (roomId: string | null) => {
    try {
      const subId = getOrCreateRoomSubId(pk)
      for (const [url, ws] of pool.entries()) {
        const active = activeRoomSubs.get(url)
        // If already subscribed to same room with same sub id, skip
        if (active && active.subId === subId && active.roomId === roomId) {
          log(`Skip roomCur (active) @ ${url} room=${roomId ? roomId.slice(0,8)+'…' : 'null'}`)
          continue
        }
        // Close previous sub id on this relay if present
        try {
          const prev = active?.subId || subId
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(["CLOSE", prev]))
          }
        } catch {}
        // If no room selected, just record cleared state and continue
        if (!roomId) {
          activeRoomSubs.set(url, { roomId: null, subId })
          continue
        }
        const since = Math.floor(Date.now()/1000) - 7*24*60*60 // last 7 days
        const req = JSON.stringify(["REQ", subId, { kinds: [42], '#e': [roomId], since }])
        if (ws.readyState === ws.OPEN) {
          try { ws.send(req); log(`Subscribe roomCur -> ${url} room=${roomId.slice(0,8)}… id=${subId}`) } catch {}
        } else if (ws.readyState === ws.CONNECTING) {
          try { ws.addEventListener('open', () => { try { ws.send(req); log(`Subscribe roomCur (onopen) -> ${url} room=${roomId.slice(0,8)}… id=${subId}`) } catch {} }, { once: true } as any) } catch {}
        }
        activeRoomSubs.set(url, { roomId, subId })
      }
    } catch {}
  }
  // Keep room subscription updated when UI selection changes
  try {
    let prevSel: string | null = null
    const unsubSel = useRoomStore.subscribe((s) => {
      const cur: string | null = s.selectedRoom || null
      if (cur !== prevSel) {
        prevSel = cur
        try { updateCurrentRoomSub(cur) } catch {}
      }
    })
    ;(window as any).__globgram_unsubSel = unsubSel
  } catch {}
  // react to relay changes at runtime
  const attachHandlers = (url: string, ws: WebSocket) => {
    ws.onopen = () => {
  log(`Subscribe -> ${url} (inbox/typing/roomsMeta/receipts/roomCur)`)    
      ws.send(sub)
      ws.send(sub2)
      ws.send(subTyping)
      ws.send(subRoomsMeta)
      ws.send(subReceipts)
      // also (re)apply focused current room subscription
      try { updateCurrentRoomSub(useRoomStore.getState().selectedRoom) } catch {}
    }
    ws.onmessage = async (ev) => {
      try {
        const data = JSON.parse(ev.data as string)
        if (Array.isArray(data) && data[0] === 'NOTICE') {
          const msg = String(data[1] ?? '')
          log(`NOTICE @ ${url}: ${msg}`, 'warn')
          return
        }
        if (Array.isArray(data) && data[0] === 'EOSE') {
          const sid = String(data[1] ?? '')
          if (sid) log(`EOSE @ ${url}: ${sid}`)
          return
        }
        if (Array.isArray(data) && data[0] === 'EVENT') {
          const evt = data[2] as Event
      // debug small sample of events
      if (Math.random() < 0.01) log(`EVENT kind=${evt.kind} id=${evt.id.slice(0,8)}…`)
          // delivery receipts (custom kind 10001)
          if (evt.kind === (10001 as any)) {
            const refId = evt.tags.find(t => t[0] === 'e')?.[1]
            const pTo = evt.tags.find(t => t[0] === 'p')?.[1]
            // Only accept receipts targeted to us and for a message we sent
            if (pTo === pk && refId) {
              // find peer from our conversations where this id exists and we are the sender
              try {
                const convs = useChatStore.getState().conversations
                for (const [peer, list] of Object.entries(convs)) {
                  const msg = list.find(m => m.id === refId)
                  if (msg && msg.from === pk) {
                    useChatStore.getState().updateMessageStatus(peer, refId, 'delivered')
                    break
                  }
                }
              } catch {}
            }
            return
          }
          if (evt.kind === 4 && !seen.has(evt.id)) {
            seen.add(evt.id)
            const pTag = evt.tags.find(t => t[0] === 'p')?.[1] || ''
            const peerPk = evt.pubkey === pk ? pTag : evt.pubkey
            log(`DM @ ${url} from ${evt.pubkey.slice(0,8)}… -> ${peerPk.slice(0,8)}… id=${evt.id.slice(0,8)}…`)
            const txt = await nip04.decrypt(sk, peerPk, evt.content)
            // If this DM is a receipt envelope { r: <eventId> }, mark delivered and skip adding a message
            try {
              const maybeReceipt = JSON.parse(txt)
              if (maybeReceipt && typeof maybeReceipt.r === 'string') {
                const refId = maybeReceipt.r as string
                try {
                  const convs = useChatStore.getState().conversations
                  for (const [peer, list] of Object.entries(convs)) {
                    const msg = list.find(m => m.id === refId)
                    if (msg && msg.from === pk) {
                      useChatStore.getState().updateMessageStatus(peer, refId, 'delivered')
                      break
                    }
                  }
                } catch {}
                return
              }
            } catch {}
            let text: string | undefined
            let attachment: string | undefined
            let attachments: string[] | undefined
            // Respect user's auto-load setting for plain mem/http pointers
            const shouldAutoResolveDM = (() => {
              try {
                const s = localStorage.getItem('autoResolveMedia')
                if (s === '0' || s === '1') return s === '1'
              } catch {}
              return CONFIG.AUTO_RESOLVE_MEDIA_DEFAULT
            })()
      try {
              const obj = JSON.parse(txt)
              if (obj && (obj.t || obj.a || obj.as)) {
                text = obj.t
                attachment = obj.a
                attachments = Array.isArray(obj.as) ? obj.as : undefined
        const pass: string = typeof obj.p === 'string' ? obj.p : ''
                // lazy decode if entries are encrypted references
        const resolve = async (ref: any): Promise<string | null> => {
                  try {
                    if (typeof ref === 'string' && ref.startsWith('data:')) return ref
                    if (ref && ref.url && ref.enc) {
                      let b64: string | null = null
                      if (typeof ref.url === 'string') {
                        const key = parseMemUrl(ref.url)
                        if (key) {
                          const obj = await getObject(key)
                          if (obj) b64 = obj.base64Data
                        } else {
                          const obj = await getObject(ref.url)
                          if (obj) b64 = obj.base64Data
                        }
                      }
          // Inline ciphertext fallback
          if (!b64 && typeof ref.ctInline === 'string') b64 = ref.ctInline
          if (!b64) return null
                      const bin = atob(b64)
                      const bytes = new Uint8Array(bin.length)
                      for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i)
                      const iv = Uint8Array.from(ref.enc.iv as number[])
                      const salt = Uint8Array.from(ref.enc.keySalt as number[])
                      const enc = new TextEncoder()
            const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pass || ''), 'PBKDF2', false, ['deriveKey'])
                      const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
                      const ab = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, bytes.buffer)
                      const u8 = new Uint8Array(ab)
                      const b64out = btoa(Array.from(u8).map(c => String.fromCharCode(c)).join(''))
                      return `data:${ref.enc.mime};base64,${b64out}`
                    }
                  } catch {}
                  return null
                }
                // Resolve encrypted refs always (needed to decrypt), but only auto-fetch plain mem/http if enabled
                if (typeof attachment === 'string' && (attachment.startsWith('mem://') || attachment.startsWith('http'))) {
                  if (shouldAutoResolveDM) {
                    try {
                      const key = parseMemUrl(attachment) ?? attachment
                      const obj = await getObject(key)
                      if (obj) attachment = normalizeDataUrlMime(`data:${obj.mime};base64,${obj.base64Data}`)
                    } catch {}
                  }
                } else if (typeof attachment === 'object' && attachment) {
                  const r = await resolve(attachment)
                  attachment = r ? normalizeDataUrlMime(r) : undefined
                }
                if (attachments) {
                  const out: string[] = []
                  for (const a of attachments) {
                    if (typeof a === 'string') {
                      if (a.startsWith('mem://') || a.startsWith('http')) {
                        if (shouldAutoResolveDM) {
                          try {
                            const key = parseMemUrl(a) ?? a
                            const obj = await getObject(key)
                            if (obj) out.push(normalizeDataUrlMime(`data:${obj.mime};base64,${obj.base64Data}`))
                            else out.push(a)
                          } catch { out.push(a) }
                        } else {
                          out.push(a)
                        }
                      } else {
                        out.push(a)
                      }
                    } else {
                      const r = await resolve(a)
                      if (r) out.push(normalizeDataUrlMime(r))
                    }
                  }
                  attachments = out.length ? out : undefined
                }
              } else {
                text = txt
              }
            } catch {
              text = txt
            }
            const { addMessage } = useChatStore.getState()
            const isBlocked = !!useChatStore.getState().blocked[peerPk]
            
            // Generate filenames for resolved data URLs
            let name: string | undefined
            let names: string[] | undefined
            
            if (typeof attachment === 'string' && attachment.startsWith('data:')) {
              name = dataUrlToFilename(attachment)
              // Debug log to see what MIME we detected
              try {
                const mimeMatch = /^data:([^;]+);/.exec(attachment)
                const detectedMime = mimeMatch?.[1] || 'unknown'
                log(`DM attachment resolved: MIME=${detectedMime}, filename=${name}`)
              } catch {}
            }
            
            if (attachments && attachments.length > 0) {
              names = attachments.map((a, i) => {
                if (typeof a === 'string' && a.startsWith('data:')) {
                  const filename = dataUrlToFilename(a)
                  // Debug log to see what MIME we detected
                  try {
                    const mimeMatch = /^data:([^;]+);/.exec(a)
                    const detectedMime = mimeMatch?.[1] || 'unknown'
                    log(`DM attachment[${i}] resolved: MIME=${detectedMime}, filename=${filename}`)
                  } catch {}
                  return filename
                }
                return 'download.bin'
              })
            }
            
            const message: ChatMessage = {
              id: evt.id,
              from: evt.pubkey,
              to: peerPk === evt.pubkey ? pk : peerPk,
              ts: evt.created_at ?? Math.floor(Date.now() / 1000),
              text,
              attachment,
              attachments,
              name,
              names,
            }
            if (!isBlocked) addMessage(peerPk, message)
            else log(`Message from blocked peer ${peerPk.slice(0,8)}… ignored`, 'warn')
            // Also send an encrypted DM receipt back ({ r: evt.id }) so relays that drop custom kinds still allow delivery acks
            try {
              if (evt.pubkey !== pk) {
                const receiptBody = JSON.stringify({ r: evt.id })
                const ct = await nip04.encrypt(sk, evt.pubkey, receiptBody)
                const receiptTemplate: EventTemplate = { kind: 4, created_at: Math.floor(Date.now()/1000), content: ct, tags: [["p", evt.pubkey]] }
                const rEvt = finalizeEvent(receiptTemplate, hexToBytes(sk))
                const pub = JSON.stringify(["EVENT", rEvt])
                const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
                const pool2 = getRelayPool(urls)
                for (const ws2 of pool2.values()) {
                  if (ws2.readyState === ws2.OPEN) ws2.send(pub)
                  else if (ws2.readyState === ws2.CONNECTING) {
                    try { ws2.addEventListener('open', () => ws2.send(pub), { once: true } as any) } catch {}
                  }
                }
              }
            } catch { log(`Failed to send DM receipt (kind 4) @ ${url}`, 'warn') }
            // send a delivery receipt back to sender (kind 10001) with tag e:evt.id and p:sender
            try {
              if (evt.pubkey !== pk) {
                const receipt: EventTemplate = { kind: 10001 as any, created_at: Math.floor(Date.now()/1000), content: 'delivered', tags: [["e", evt.id], ["p", evt.pubkey]] }
                const rEvt = finalizeEvent(receipt, hexToBytes(sk))
                const pub = JSON.stringify(["EVENT", rEvt])
                const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
                const pool2 = getRelayPool(urls)
                for (const ws2 of pool2.values()) {
                  if (ws2.readyState === ws2.OPEN) ws2.send(pub)
                  else if (ws2.readyState === ws2.CONNECTING) {
                    try { ws2.addEventListener('open', () => ws2.send(pub), { once: true } as any) } catch {}
                  }
                }
              }
            } catch { log(`Failed to send delivery receipt (kind 10001) @ ${url}`, 'warn') }
          } else if (evt.kind === 20000) {
            if (evt.pubkey !== pk) {
              const setTyping = useChatStore.getState().setTyping
              setTyping(evt.pubkey, true)
              setTimeout(() => setTyping(evt.pubkey, false), 2000)
            }
          } else if (evt.kind === 40) { // Channel creation (NIP-28)
            const id = evt.id
            const name = evt.tags.find(t => t[0]==='name')?.[1]
            const about = evt.tags.find(t => t[0]==='about')?.[1]
            const picture = evt.tags.find(t => t[0]==='picture')?.[1]
            useRoomStore.getState().addRoom({ id, name, about, picture })
            useRoomStore.getState().setOwner(id, evt.pubkey)
          } else if (evt.kind === 41) { // Channel metadata/update
            const ref = evt.tags.find(t => t[0] === 'e')?.[1]
            if (ref) {
              const name = evt.tags.find(t => t[0]==='name')?.[1]
              const about = evt.tags.find(t => t[0]==='about')?.[1]
              const picture = evt.tags.find(t => t[0]==='picture')?.[1]
              if (name || about || picture) useRoomStore.getState().setRoomMeta(ref, { name, about, picture })
              const members = evt.tags.filter(t => t[0]==='p').map(t => t[1]).filter(Boolean)
              if (members.length) {
                const createdAt = evt.created_at || Math.floor(Date.now()/1000)
                useRoomStore.getState().setMembersIfNewer(ref, members, createdAt)
                // If current user is in the new members list, ensure room exists locally
                try {
                  const me = pk
                  if (members.includes(me)) {
                    if (!useRoomStore.getState().rooms[ref]) useRoomStore.getState().addRoom({ id: ref })
                  }
                } catch {}
              }
            }
      } else if (evt.kind === 42) { // NIP-28 Channel Message (with attachments envelope)
            const roomId = evt.tags.find(t => t[0] === 'e')?.[1]
            if (roomId) {
        // Avoid redundant room add noise; only add if unknown
        try { if (!useRoomStore.getState().rooms[roomId]) useRoomStore.getState().addRoom({ id: roomId }) } catch {}
              // membership/owner gate: if we know membership and we're not a member, ignore.
              // If membership unknown yet, accept to avoid dropping messages before metadata arrives.
              const owner = useRoomStore.getState().owners[roomId]
              const mem = useRoomStore.getState().members[roomId]
              const know = !!owner || !!(mem && Object.keys(mem).length)
              const isMember = owner === pk || !!(mem && mem[pk])
              if (know && !isMember) return
              let text: string | undefined
              let attachment: string | undefined
              let attachments: string[] | undefined
              let pass = ''
              const shouldAutoResolveRoom = (() => {
                try {
                  const s = localStorage.getItem('autoResolveMedia')
                  if (s === '0' || s === '1') return s === '1'
                } catch {}
                return CONFIG.AUTO_RESOLVE_MEDIA_DEFAULT
              })()
              try {
                const obj = JSON.parse(evt.content)
                if (obj && (obj.t || obj.a || obj.as)) {
                  text = obj.t
                  attachment = obj.a
                  attachments = Array.isArray(obj.as) ? obj.as : undefined
                  pass = typeof obj.p === 'string' ? obj.p : ''
                  // attempt lazy decrypt for attachment refs
      const resolve = async (ref: any): Promise<string | null> => {
                    try {
                      if (typeof ref === 'string' && ref.startsWith('data:')) return ref
                      if (ref && ref.enc && (ref.url || ref.ctInline)) {
                        let b64: string | null = null
                        if (typeof ref.url === 'string') {
                          const memKey = parseMemUrl(ref.url)
                          if (memKey) {
                            const obj = await getObject(memKey)
                            if (obj) b64 = obj.base64Data
                          } else {
                            const obj = await getObject(ref.url)
                            if (obj) b64 = obj.base64Data
                          }
                        }
        if (!b64 && typeof ref.ctInline === 'string') b64 = ref.ctInline
        if (!b64) return null
                        const bin = atob(b64)
                        const bytes = new Uint8Array(bin.length)
                        for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i)
                        const iv = Uint8Array.from(ref.enc.iv as number[])
                        const salt = Uint8Array.from(ref.enc.keySalt as number[])
                        const enc = new TextEncoder()
                        const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pass || ''), 'PBKDF2', false, ['deriveKey'])
                        const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
                        const ab = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, bytes.buffer)
                        const u8 = new Uint8Array(ab)
                        const b64out = btoa(Array.from(u8).map(c => String.fromCharCode(c)).join(''))
                        return `data:${ref.enc.mime};base64,${b64out}`
                      }
                    } catch {}
                    return null
                  }
                  // Resolve encrypted refs always (needed to decrypt), but only auto-fetch plain mem/http if enabled
                  if (typeof attachment === 'string' && (attachment.startsWith('mem://') || attachment.startsWith('http'))) {
                    if (shouldAutoResolveRoom) {
                      try {
                        const key = parseMemUrl(attachment) ?? attachment
                        const obj = await getObject(key)
                        if (obj) attachment = normalizeDataUrlMime(`data:${obj.mime};base64,${obj.base64Data}`)
                      } catch {}
                    }
                  } else if (typeof attachment === 'object' && attachment) {
                    const r = await resolve(attachment)
                    attachment = r ? normalizeDataUrlMime(r) : undefined
                  }
                  if (attachments) {
                    const out: string[] = []
                    for (const a of attachments) {
                      if (typeof a === 'string') {
                        if (a.startsWith('mem://') || a.startsWith('http')) {
                          if (shouldAutoResolveRoom) {
                            try {
                              const key = parseMemUrl(a) ?? a
                              const obj = await getObject(key)
                              if (obj) out.push(normalizeDataUrlMime(`data:${obj.mime};base64,${obj.base64Data}`))
                              else out.push(a)
                            } catch { out.push(a) }
                          } else {
                            out.push(a)
                          }
                        } else {
                          out.push(a)
                        }
                      } else {
                        const r = await resolve(a)
                        if (r) out.push(normalizeDataUrlMime(r))
                      }
                    }
                    attachments = out.length ? out : undefined
                  }
                } else {
                  text = evt.content
                }
              } catch {
                text = evt.content
              }
              
              // Generate filenames for resolved data URLs in room messages
              let name: string | undefined
              let names: string[] | undefined
              
              if (typeof attachment === 'string' && attachment.startsWith('data:')) {
                name = dataUrlToFilename(attachment)
                // Debug log to see what MIME we detected
                try {
                  const mimeMatch = /^data:([^;]+);/.exec(attachment)
                  const detectedMime = mimeMatch?.[1] || 'unknown'
                  log(`Room attachment resolved: MIME=${detectedMime}, filename=${name}`)
                } catch {}
              }
              
              if (attachments && attachments.length > 0) {
                names = attachments.map((a, i) => {
                  if (typeof a === 'string' && a.startsWith('data:')) {
                    const filename = dataUrlToFilename(a)
                    // Debug log to see what MIME we detected
                    try {
                      const mimeMatch = /^data:([^;]+);/.exec(a)
                      const detectedMime = mimeMatch?.[1] || 'unknown'
                      log(`Room attachment[${i}] resolved: MIME=${detectedMime}, filename=${filename}`)
                    } catch {}
                    return filename
                  }
                  return 'download.bin'
                })
              }
              
              useRoomStore.getState().addRoomMessage(roomId, { 
                id: evt.id, 
                roomId, 
                from: evt.pubkey, 
                ts: evt.created_at ?? Math.floor(Date.now()/1000), 
                text, 
                attachment, 
                attachments,
                name,
                names
              })
            }
          }
        }
      } catch {}
    }
  if (ws.readyState === ws.OPEN) {
      try {
    log(`Subscribe (immediate) -> ${url}`)
        ws.send(sub)
        ws.send(sub2)
        ws.send(subTyping)
    ws.send(subRoomsMeta)
        ws.send(subReceipts)
    try { updateCurrentRoomSub(useRoomStore.getState().selectedRoom) } catch {}
      } catch {}
    }
  }
  useRelayStore.subscribe((s) => {
    const next = s.relays.filter(r => r.enabled).map(r => r.url)
    resetRelayPool(next)
    const pool2 = getRelayPool(next)
    for (const [url, ws] of pool2.entries()) {
      attachHandlers(url, ws)
    }
  })

  for (const [url, ws] of pool.entries()) {
    attachHandlers(url, ws)
  }
  log('Engine subscriptions attached to current pool')

  // React to selected room changes by updating focused room subscription
  try {
    let lastRoom: string | null = null
    useRoomStore.subscribe((s) => {
      const cur = s.selectedRoom as string | null
      if (cur !== lastRoom) {
        lastRoom = cur
        updateCurrentRoomSub(cur)
      }
      return s
    })
    // also seed initial
    updateCurrentRoomSub(useRoomStore.getState().selectedRoom)
  } catch {}

  // After subscriptions are attached, sweep pendings: RESEND instead of fail-only
  try {
    const now = Math.floor(Date.now() / 1000)
    const convs = useChatStore.getState().conversations
    const pendings: Array<{ peer: string, m: ChatMessage }> = []
    for (const [peer, msgs] of Object.entries(convs)) {
      for (const m of msgs) {
        // resend if pending and older than 20s (avoid racing just-sent)
        if (m.status === 'pending' && (now - (m.ts || now)) > 20) {
          pendings.push({ peer, m })
        }
      }
    }

    // Stagger resends to avoid burst
    pendings.forEach((item, idx) => {
      setTimeout(async () => {
        try {
          log(`Resend.pending -> ${item.peer.slice(0,8)}… id=${item.m.id.slice(0,8)}…`)
          // Update UI hint
          try { useChatStore.getState().updateMessageStatus(item.peer, item.m.id, 'pending', 'Resending…') } catch {}
          // Reuse the same bubble id
          const { acked } = await sendDM(
            sk,
            item.peer,
            { t: item.m.text, a: item.m.attachment, as: item.m.attachments },
            { reuseId: item.m.id }
          )
          // Optionally observe ack result (no-op here; sendDM updates status on OK)
          acked.then(ok => {
            if (!ok) {
              // If still no OK after our internal timeout, keep pending for later manual retry
              // or mark failed if you prefer:
              // useChatStore.getState().updateMessageStatus(item.peer, item.m.id, 'failed', 'No relay acknowledgement')
            }
          }).catch(() => {})
        } catch (e) {
          try { useChatStore.getState().updateMessageStatus(item.peer, item.m.id, 'failed', (e as Error)?.message || 'Resend failed') } catch {}
        }
      }, 200 * idx)
    })
  } catch {}
}

// Lightweight data refresh: re-send subscription REQs to all connected relays
export function refreshSubscriptions() {
  try {
    const sk = localStorage.getItem('nostr_sk')
    if (!sk) return
    const pk = getPublicKey(hexToBytes(sk))
  log('Refreshing subscriptions')
    const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
    const pool = getRelayPool(urls)
    // Create fresh REQ IDs on refresh to ensure relays re-evaluate
    const mkSubId = (name: string) => `${name}:${pk.slice(0, 8)}:${Math.random().toString(36).slice(2, 8)}`
    const sub = JSON.stringify(["REQ", mkSubId('inbox'), { kinds: [4], authors: [pk] }])
    const sub2 = JSON.stringify(["REQ", mkSubId('inbox2'), { kinds: [4], '#p': [pk] }])
    const subTyping = JSON.stringify(["REQ", mkSubId('typing'), { kinds: [20000], '#p': [pk] }])
  const subRoomsMeta = JSON.stringify(["REQ", mkSubId('roomsMeta'), { kinds: [40,41] }])
    const subReceipts = JSON.stringify(["REQ", mkSubId('receipts'), { kinds: [10001 as any], '#p': [pk] }])
    for (const [url, ws] of pool.entries()) {
      if (ws.readyState === ws.OPEN) {
        try {
          log(`Refresh subscribe -> ${url}`)
          ws.send(sub); ws.send(sub2); ws.send(subTyping); ws.send(subRoomsMeta); ws.send(subReceipts)
          // re-apply current room subscription on refresh using stable sub id and dedupe
          const subId = getOrCreateRoomSubId(pk)
          try { ws.send(JSON.stringify(["CLOSE", subId])) } catch {}
          try {
            const rid = useRoomStore.getState().selectedRoom
            if (rid) {
              const since = Math.floor(Date.now()/1000) - 7*24*60*60
              const req = JSON.stringify(["REQ", subId, { kinds: [42], '#e': [rid], since }])
              ws.send(req)
              activeRoomSubs.set(url, { roomId: rid, subId })
              log(`Refresh roomCur -> ${url} room=${rid.slice(0,8)}… id=${subId}`)
            } else {
              activeRoomSubs.set(url, { roomId: null, subId })
            }
          } catch {}
        } catch {}
      }
    }
  } catch {}
}

export async function sendDM(
  sk: string,
  to: string,
  payload: { t?: string; a?: any; as?: any[]; p?: string },
  opts?: { reuseId?: string; onProgress?: (p: { stage: 'uploading' | 'publishing' | 'done'; uploaded?: number; totalUploads?: number; fileProgress?: { current: number; total: number; fileIndex: number } }) => void }
): Promise<{ id: string; acked: Promise<boolean> }> {
  const SMALL_INLINE_LIMIT = 128 * 1024 // 128 KB inline fallback for non-encrypted media
  const readableSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }
  // Normalize recipient
  const toHex = normalizeToHexPubkey(to)
  if (!toHex) {
    emitToast(tGlobal('errors.invalidPubkey'), 'error')
    const acked = Promise.resolve(false)
    return { id: 'invalid', acked }
  }

  const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
  const pool = getRelayPool(urls)
  const now = Math.floor(Date.now() / 1000)

  // If attachments exist and are data URLs, ALWAYS upload first.
  // When payload.p is provided, we encrypt+upload (existing behavior).
  // When payload.p is empty, we still upload the raw bytes and return a small mem: pointer (new).
  let requiresBackendForReceiver = false
  let requiresBackendBytes: number | null = null
  const processOne = async (d: any, fileIndex: number): Promise<any> => {
    if (typeof d === 'string' && d.startsWith('data:')) {
      const evtIdSeed = Math.floor(Math.random() * 1e9)
      if (payload.p) {
        const enc = await encryptDataURL(d, payload.p)
        const key = `${toHex}:${evtIdSeed}:${Math.random().toString(36).slice(2)}`
        const url = await putObject(key, enc.mime, enc.ct, {
          onUploadProgress: (current, total) => {
            try { opts?.onProgress?.({ stage: 'uploading', uploaded, totalUploads, fileProgress: { current, total, fileIndex } }) } catch {}
          }
        })
        // Prefer pointer, but if no backend (mem://) and ciphertext is small, include ctInline for immediate cross-device receive
        const out: any = { url, enc: { iv: Array.from(atob(enc.iv).split('').map(c=>c.charCodeAt(0))), keySalt: Array.from(atob(enc.keySalt).split('').map(c=>c.charCodeAt(0))), mime: enc.mime, sha256: enc.sha256 } }
        if (url.startsWith('mem://')) {
          const bytes = base64ByteLength(enc.ct)
          if (bytes <= SMALL_INLINE_LIMIT) out.ctInline = enc.ct
          else { requiresBackendForReceiver = true; requiresBackendBytes = bytes }
        }
        return out
      } else {
        // NEW: plain upload (no encryption), return a small mem: url
        const { mime, bytes } = dataURLToBytes(d)
        const key = `${toHex}:${evtIdSeed}:${Math.random().toString(36).slice(2)}`
        const b64 = bytesToBase64(bytes)
        const url = await putObject(key, mime, b64, {
          onUploadProgress: (current, total) => {
            try { opts?.onProgress?.({ stage: 'uploading', uploaded, totalUploads, fileProgress: { current, total, fileIndex } }) } catch {}
          }
        })
        // If no backend and storage fell back to mem://, receivers can't fetch it.
        // For small files, inline the original data URL so it works cross-device.
        if (url.startsWith('mem://') && bytes.length <= SMALL_INLINE_LIMIT) return d
        if (url.startsWith('mem://') && bytes.length > SMALL_INLINE_LIMIT) { requiresBackendForReceiver = true; requiresBackendBytes = bytes.length }
        return url // string (mem:// or http…)
      }
    }
    return d
  }

  // Build attachments (network payload) with simple progress across files
  const totalUploads = (
    (typeof payload.a === 'string' && payload.a.startsWith('data:') ? 1 : 0) +
    (Array.isArray(payload.as) ? payload.as.filter(a => typeof a === 'string' && a.startsWith('data:')).length : 0)
  )
  let uploaded = 0
  const notify = (stage: 'uploading' | 'publishing' | 'done') => {
    try { opts?.onProgress?.({ stage, uploaded, totalUploads }) } catch {}
  }
  let outA: any = undefined
  if (payload.a) {
    if (typeof payload.a === 'string' && payload.a.startsWith('data:')) notify('uploading')
    outA = await processOne(payload.a, 0)
    if (typeof payload.a === 'string' && payload.a.startsWith('data:')) { uploaded += 1; notify('uploading') }
  }
  let outAs: any[] | undefined = undefined
  if (Array.isArray(payload.as)) {
    outAs = []
    let fileIdx = (payload.a && typeof payload.a === 'string' && payload.a.startsWith('data:')) ? 1 : 0
    for (const a of payload.as) {
      if (typeof a === 'string' && a.startsWith('data:')) notify('uploading')
      const r = await processOne(a, fileIdx)
      outAs.push(r)
      if (typeof a === 'string' && a.startsWith('data:')) { uploaded += 1; notify('uploading') }
      fileIdx++
    }
  }

  // Derive local display attachments: prefer original data URLs for instant preview;
  // if we only have mem/http pointers, resolve from store/backend to data URLs.
  const resolvePlainToDataUrl = async (u: string): Promise<string | undefined> => {
    try {
      const key = parseMemUrl(u) ?? u
      const obj = await getObject(key)
      if (obj) return `data:${obj.mime};base64,${obj.base64Data}`
    } catch {}
    return undefined
  }
  const displayA = (typeof payload.a === 'string' && payload.a.startsWith('data:'))
    ? payload.a
    : (typeof outA === 'string' && (outA.startsWith('mem://') || outA.startsWith('http')))
      ? await resolvePlainToDataUrl(outA)
      : undefined
  const displayAs = Array.isArray(payload.as)
    ? await (async () => {
        const result: string[] = []
        for (let i = 0; i < payload.as!.length; i++) {
          const orig = payload.as![i]
          if (typeof orig === 'string' && orig.startsWith('data:')) { result.push(orig); continue }
          const net = outAs ? outAs[i] : undefined
          if (typeof net === 'string' && (net.startsWith('mem://') || net.startsWith('http'))) {
            const r = await resolvePlainToDataUrl(net)
            if (r) result.push(r)
          }
        }
        return result.length ? result : undefined
      })()
    : undefined

  // Hard guard: if a large attachment fell back to mem:// (no upload backend), block sending to avoid
  // emitting unresolvable pointers that receivers can never fetch. Ask user to configure an upload server.
  if (requiresBackendForReceiver) {
    try {
      const limitBytes = 128 * 1024
      const readable = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
      }
      const sz = requiresBackendBytes != null ? readable(requiresBackendBytes) : 'unknown'
      const limit = readable(limitBytes)
  emitToast(`Cannot send large media without an upload server (size ${sz} > inline limit ${limit}). Configure an upload server or send a smaller file.`, 'error')
      log('Blocked sending: upload backend missing and media exceeds inline limit', 'warn')
      // If this was a resend, mark the existing bubble failed
      if (opts?.reuseId) {
        try { useChatStore.getState().updateMessageStatus(toHex, opts.reuseId, 'failed', 'Upload server required for large media') } catch {}
      }
    } catch {}
    const acked = Promise.resolve(false)
    return { id: 'blocked', acked }
  }
  const body = JSON.stringify({ t: payload.t, a: outA, as: outAs, p: payload.p })
  const ciphertext = await nip04.encrypt(sk, toHex, body)

  const template: EventTemplate = { kind: 4, created_at: now, content: ciphertext, tags: [["p", toHex]] }
  let evt: any = finalizeEvent(template, hexToBytes(sk))
  
  // DEBUG: Log event details for debugging "invalid-event" issues
  log(`🔍 Event created: kind=${evt.kind}, id=${evt.id?.slice(0,12)}..., pubkey=${evt.pubkey?.slice(0,12)}..., sig_len=${evt.sig?.length}`)
  if (!evt.id || evt.id.length !== 64) {
    log(`❌ Invalid event ID: ${evt.id}`, 'error')
  }
  if (!evt.pubkey || evt.pubkey.length !== 64) {
    log(`❌ Invalid event pubkey: ${evt.pubkey}`, 'error')
  }
  if (!evt.sig || evt.sig.length !== 128) {
    log(`❌ Invalid event signature: length=${evt.sig?.length}`, 'error')
  }
  
  const pub = JSON.stringify(["EVENT", evt])
  // entering publish stage
  notify('publishing')

  // getPublicKey expects a Uint8Array in our nostr-tools version
  const me = getPublicKey(hexToBytes(sk))

  // Reuse existing pending bubble if provided; else add a new message
  if (opts?.reuseId) {
    try {
      // ensure the existing bubble carries the latest text/attachments and id
      useChatStore.getState().updateMessageId(toHex, opts.reuseId, evt.id)
      useChatStore.getState().updateMessageStatus(toHex, evt.id, 'pending', 'Resending…')
    } catch {}
  } else {
    useChatStore.getState().addMessage(toHex, {
      id: evt.id, from: me, to: toHex, ts: now,
      text: payload.t, attachment: displayA || undefined, attachments: displayAs || undefined, status: 'pending'
    })
  }

  // If we detected that a large attachment fell back to mem:// (no backend), warn the sender with details.
  try {
    if (requiresBackendForReceiver) {
      const base = CONFIG.UPLOAD_BASE_URL || 'unset'
      const mode = CONFIG.UPLOAD_MODE || 'simple'
      const auth = CONFIG.UPLOAD_AUTH_MODE || (CONFIG.UPLOAD_AUTH_TOKEN ? 'token' : 'none')
      const sz = requiresBackendBytes != null ? readableSize(requiresBackendBytes) : 'unknown'
      const limit = readableSize(SMALL_INLINE_LIMIT)
      const msg = `Media fell back to mem:// (size ${sz} > inline limit ${limit}). Receiver cannot fetch while you're offline. Configure an upload server.\nBASE_URL=${base}, MODE=${mode}, AUTH=${auth}`
      emitToast(msg, 'info')
      log('Large media requires upload backend for receiver to view (configure upload server)', 'warn')
    }
  } catch {}

  let acked = false
  let ackCount = 0
  let lastReason: string | undefined
  let powBitsRequired: number | null = null
  const handlers: Array<{ ws: WebSocket, fn: (ev: MessageEvent) => void }> = []
  let resolveAck: (v: boolean) => void = () => {}
  const ackedPromise = new Promise<boolean>(res => (resolveAck = res))
  const ACK_TIMEOUT_MS = 8000
  const ackTimeout = setTimeout(() => {
    try { for (const h of handlers) h.ws.removeEventListener('message', h.fn as any) } catch {}
    handlers.length = 0
    try { resolveAck(false) } catch {}
  }, ACK_TIMEOUT_MS)

  for (const [url, ws] of pool.entries()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(pub)
      log(`EVENT -> ${url} (OPEN) id=${evt.id.slice(0,8)}…`)
      const handler = (ev: MessageEvent) => {
        try {
          const data = JSON.parse((ev.data as string) || 'null')
          if (Array.isArray(data) && data[0] === 'NOTICE') {
            const msg = String(data[1] ?? '')
            log(`NOTICE @ ${url}: ${msg}`, 'warn')
          } else if (Array.isArray(data) && data[0] === 'OK' && data[1] === evt.id) {
            const ok = !!data[2]
            if (ok) {
              ackCount += 1
              if (!acked) {
                acked = true
                useChatStore.getState().updateMessageStatus(toHex, evt.id, 'sent')
                ws.removeEventListener('message', handler as any)
                try { for (const h of handlers) h.ws.removeEventListener('message', h.fn as any) } catch {}
                try { clearTimeout(ackTimeout) } catch {}
                try { resolveAck(true) } catch {}
              }
            } else {
              const reason = typeof data[3] === 'string' ? data[3] : undefined
              // DEBUG: Log detailed rejection info
              log(`❌ Event REJECTED by ${url}: ${reason || 'no reason given'}`, 'error')
              log(`🔍 Rejected event details: kind=${evt.kind}, id=${evt.id?.slice(0,12)}...`, 'warn')
              if (reason) {
                lastReason = reason
                const m = /(pow)\s*:\s*(\d+)\s*bits/i.exec(reason)
                if (m) { powBitsRequired = parseInt(m[2], 10); log(`PoW required @ ${url}: ${powBitsRequired} bits`,'warn') }
                // Check for specific "invalid" errors
                if (reason.toLowerCase().includes('invalid')) {
                  log(`🚨 INVALID-EVENT detected: ${reason}`, 'error')
                  console.error('Invalid event details:', {
                    event: evt,
                    reason: reason,
                    relay: url
                  })
                }
                log(`OK false @ ${url}: ${reason}`, 'warn')
              }
            }
          }
        } catch {}
      }
      try { ws.addEventListener('message', handler as any); trackListener(ws, 'message', handler as any); handlers.push({ ws, fn: handler }) } catch {}
    } else if (ws.readyState === ws.CONNECTING) {
      try { ws.addEventListener('open', () => ws.send(pub), { once: true } as any) } catch {}
      log(`EVENT queued -> ${url} (CONNECTING) id=${evt.id.slice(0,8)}…`)
    }
  }
  // initial send queued; mark progress done for UI
  notify('done')
  // If no relays are available, resolve immediately as false
  if (pool.size === 0) {
    try { clearTimeout(ackTimeout) } catch {}
    try { resolveAck(false) } catch {}
  }
  // If relay requested PoW, try to re-mine with a nonce tag and resend
  if (!acked && powBitsRequired && powBitsRequired > 0) {
    const miningEnabled = (() => { try { return useSettingsStore.getState().powMining } catch { return true } })()
    if (!miningEnabled) {
      const reason = `PoW required (${powBitsRequired} bits) but disabled in Settings`
      try { useChatStore.getState().updateMessageStatus(toHex, evt.id, 'failed', reason) } catch {}
      emitToast(tGlobal('errors.powRequiredEnable'), 'error')
      acked = true
      try { for (const h of handlers) h.ws.removeEventListener('message', h.fn as any) } catch {}
      try { clearTimeout(ackTimeout) } catch {}
      try { resolveAck(false) } catch {}
      log('PoW disabled; not mining and marking failed','warn')
      return { id: evt.id, acked: ackedPromise }
    }
    try {
      // Use toHex for peer key here as well
      useChatStore.getState().updateMessageStatus(toHex, evt.id, 'pending', `Mining ${powBitsRequired} bits…`)
      log(`Mining start: ${powBitsRequired} bits for id=${evt.id.slice(0,8)}…`)
      const { newEvt } = await mineEventWithPow(evt, powBitsRequired)
      const oldId = evt.id
      evt = newEvt
      log(`Mining success: new id=${evt.id.slice(0,8)}… old=${oldId.slice(0,8)}…`)
      try { useChatStore.getState().updateMessageId(toHex, oldId, evt.id) } catch {}
      const pub2 = JSON.stringify(["EVENT", evt])
      for (const [url, ws] of pool.entries()) {
        if (ws.readyState === ws.OPEN) {
          ws.send(pub2)
          log(`EVENT (mined) -> ${url} id=${evt.id.slice(0,8)}…`)
        } else if (ws.readyState === ws.CONNECTING) {
          try { ws.addEventListener('open', () => ws.send(pub2), { once: true } as any) } catch {}
          log(`EVENT (mined) queued -> ${url} id=${evt.id.slice(0,8)}…`)
        }
      }
      // Return immediately; callers may await acked if they need confirmation
      return { id: evt.id, acked: ackedPromise }
    } catch (e) {
      // If mining failed, keep lastReason as failure message
  log(`Mining failed: ${(e as any)?.message || e}`,'error')
      if (!lastReason) lastReason = (e as Error)?.message || 'PoW mining failed'
    }
  }
  // Exponential backoff retries: 2s, 4s, 8s (stop early on ack)
  const retryDelays = [2000, 4000, 8000]
  for (const d of retryDelays) {
    try {
      setTimeout(() => {
        try {
          if (acked) return
          for (const [url, ws] of pool.entries()) {
            if (ws.readyState === ws.OPEN) { ws.send(pub); log(`Retry -> ${url} id=${evt.id.slice(0,8)}…`) }
          }
          log(`Retry send after ${d}ms id=${evt.id.slice(0,8)}…`)
        } catch {}
      }, d)
    } catch {}
  }
  // fallback: if no relay OK after 15-20s, mark as failed
  try {
    const failTimer = setTimeout(() => {
      try {
        if (acked) return
        // Use toHex conversation key for lookup
        const conv = useChatStore.getState().conversations[toHex] || []
        const found = conv.find(m => m.id === evt.id)
        if (found && found.status === 'pending') {
          const reason = lastReason || (powBitsRequired ? `PoW required (${powBitsRequired} bits)` : (ackCount > 0 ? `Partial acks: ${ackCount}` : 'No relay acknowledgement'))
          useChatStore.getState().updateMessageStatus(toHex, evt.id, 'failed', reason)
        }
        try { for (const h of handlers) h.ws.removeEventListener('message', h.fn as any) } catch {}
      } catch {}
    }, 20000)
    if (acked) try { clearTimeout(failTimer) } catch {}
  } catch {}
  return { id: evt.id, acked: ackedPromise }
}

// Simple NIP-13 PoW miner: adds/updates a nonce tag and created_at to meet difficulty
async function mineEventWithPow(evt: any, bits: number): Promise<{ newEvt: any }> {
  const prefix = '0'.repeat(Math.floor(bits / 4)) // hex nibble approximation
  const targetZeros = bits
  const baseTags = (evt.tags || []).filter((t: any[]) => t[0] !== 'nonce')
  let nonce = 0
  let newEvt: Event = evt
  const skStored = localStorage.getItem('nostr_sk')
  if (!skStored) throw new Error('No key for PoW')
  const skBytes = hexToBytes(skStored)
  const start = Date.now()
  // Limit mining to ~5 seconds to keep UI responsive
  while (Date.now() - start < 5000) {
    const created = Math.floor(Date.now() / 1000)
    const tags = [...baseTags, ['nonce', String(nonce), String(targetZeros)]]
    const template: EventTemplate = { kind: evt.kind, created_at: created, content: evt.content, tags }
    const candidate: Event = finalizeEvent(template, skBytes)
    // Quick check: number of leading zero bits via hex prefix check first, then exact if close
    if (candidate.id.startsWith(prefix)) {
      if (leadingZeroBits(candidate.id) >= targetZeros) {
        newEvt = candidate
        return { newEvt }
      }
    }
    nonce++
  }
  throw new Error('PoW time limit exceeded')
}

function leadingZeroBits(hexId: string): number {
  // Accurate leading-zero-bit counter using nibble lookup
  const hex = hexId.toLowerCase()
  const nibbleLZ: number[] = [4,3,2,2,1,1,1,1,0,0,0,0,0,0,0,0]
  // index is 0..15 representing nibble value; value is leading zero bits in that nibble
  let bits = 0
  for (let i = 0; i < hex.length; i++) {
    const ch = hex[i]
    const n = parseInt(ch, 16)
    if (Number.isNaN(n)) break
    const lz = nibbleLZ[n]
    bits += lz
    if (lz !== 4) break // stop at the first non-zero nibble
  }
  return bits
}

export async function sendTyping(sk: string, to: string) {
  const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
  const pool = getRelayPool(urls)
  const now = Math.floor(Date.now() / 1000)
  const template: EventTemplate = { kind: 20000, created_at: now, content: '1', tags: [["p", to]] }
  const evt = finalizeEvent(template, hexToBytes(sk))
  const pub = JSON.stringify(["EVENT", evt])
  for (const [url, ws] of pool.entries()) {
    if (ws.readyState === ws.OPEN) { ws.send(pub); log(`Typing -> ${url} to=${to.slice(0,8)}…`) }
    else if (ws.readyState === ws.CONNECTING) {
      try { ws.addEventListener('open', () => ws.send(pub), { once: true } as any) } catch {}
      log(`Typing queued -> ${url} to=${to.slice(0,8)}…`)
    }
  }
}

// Minimal room send (NIP-28 channel message). We use provided roomId as an event tag 'e'.
export async function sendRoom(
  sk: string,
  roomId: string,
  text?: string,
  opts?: { a?: string; as?: string[]; p?: string; onProgress?: (p: { stage: 'uploading' | 'publishing' | 'done'; uploaded?: number; totalUploads?: number; fileProgress?: { current: number; total: number; fileIndex: number } }) => void }
) {
  // membership/owner gate: only allow sending if caller is owner or member
  const me = getPublicKey(hexToBytes(sk))
  const owner = useRoomStore.getState().owners[roomId]
  const mem = useRoomStore.getState().members[roomId]
  const knowMembership = !!owner || !!(mem && Object.keys(mem).length)
  const isMember = (owner === me) || !!(mem && mem[me])
  if (knowMembership && !isMember) {
    throw new Error('Not a member of this room')
  }
  const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
  const pool = getRelayPool(urls)
  const now = Math.floor(Date.now() / 1000)
  const evtIdSeed = Math.floor(Math.random() * 1e9)
  const processOne = async (d: any, fileIndex: number): Promise<any> => {
    if (typeof d === 'string' && d.startsWith('data:')) {
      if (opts?.p) {
        const enc = await encryptDataURL(d, opts.p)
        const key = `${roomId}:${evtIdSeed}:${Math.random().toString(36).slice(2)}`
        const url = await putObject(key, enc.mime, enc.ct, {
          onUploadProgress: (current, total) => {
            try { opts?.onProgress?.({ stage: 'uploading', uploaded, totalUploads, fileProgress: { current, total, fileIndex } }) } catch {}
          }
        })
        return { url, enc: { iv: Array.from(atob(enc.iv).split('').map(c=>c.charCodeAt(0))), keySalt: Array.from(atob(enc.keySalt).split('').map(c=>c.charCodeAt(0))), mime: enc.mime, sha256: enc.sha256 } }
      } else {
        const { mime, bytes } = dataURLToBytes(d)
        const key = `${roomId}:${evtIdSeed}:${Math.random().toString(36).slice(2)}`
        const b64 = bytesToBase64(bytes)
        const url = await putObject(key, mime, b64, {
          onUploadProgress: (current, total) => {
            try { opts?.onProgress?.({ stage: 'uploading', uploaded, totalUploads, fileProgress: { current, total, fileIndex } }) } catch {}
          }
        })
        return url
      }
    }
    return d
  }
  // Progress tracking
  const totalUploads = (
    (typeof opts?.a === 'string' && opts.a.startsWith('data:') ? 1 : 0) +
    (Array.isArray(opts?.as) ? opts.as.filter(a => typeof a === 'string' && a.startsWith('data:')).length : 0)
  )
  let uploaded = 0
  const notify = (stage: 'uploading' | 'publishing' | 'done') => {
    try { opts?.onProgress?.({ stage, uploaded, totalUploads }) } catch {}
  }
  let outA: any = undefined
  if (opts?.a) {
    if (typeof opts.a === 'string' && opts.a.startsWith('data:')) notify('uploading')
    outA = await processOne(opts.a, 0)
    if (typeof opts.a === 'string' && opts.a.startsWith('data:')) { uploaded += 1; notify('uploading') }
  }
  let outAs: any[] | undefined = undefined
  if (Array.isArray(opts?.as)) {
    outAs = []
    let fileIdx = (opts.a && typeof opts.a === 'string' && opts.a.startsWith('data:')) ? 1 : 0
    for (const a of opts.as) {
      if (typeof a === 'string' && a.startsWith('data:')) notify('uploading')
      const r = await processOne(a, fileIdx)
      outAs.push(r)
      if (typeof a === 'string' && a.startsWith('data:')) { uploaded += 1; notify('uploading') }
      fileIdx++
    }
  }
  const body = JSON.stringify({ t: text, a: outA, as: outAs, p: opts?.p })
  const template: EventTemplate = { kind: 42, created_at: now, content: body, tags: [["e", roomId]] }
  const evt = finalizeEvent(template, hexToBytes(sk))
  const pub = JSON.stringify(["EVENT", evt])
  // Notify UI that uploads are complete and we're publishing the event
  notify('publishing')
  log(`sendRoom room=${roomId.slice(0,8)}… text=${text ? (text.slice(0,24)+(text.length>24?'…':'')) : ''} a=${opts?.a?'y':'n'} as=${opts?.as?.length||0}`)
  for (const [url, ws] of pool.entries()) {
    if (ws.readyState === ws.OPEN) { ws.send(pub); log(`ROOM EVENT -> ${url} id=${evt.id.slice(0,8)}…`) }
    else if (ws.readyState === ws.CONNECTING) {
      try { ws.addEventListener('open', () => ws.send(pub), { once: true } as any) } catch {}
      log(`ROOM EVENT queued -> ${url} id=${evt.id.slice(0,8)}…`)
    }
  }
  // Publishing queued to all relays; mark as done
  notify('done')
}

// Create a new channel and return its id. Owner is the creator.
export async function createRoom(sk: string, meta?: { name?: string; about?: string; picture?: string; members?: string[] }) {
  const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
  const pool = getRelayPool(urls)
  const now = Math.floor(Date.now() / 1000)
  const tags: string[][] = []
  if (meta?.name) tags.push(['name', meta.name])
  if (meta?.about) tags.push(['about', meta.about])
  if (meta?.picture) tags.push(['picture', meta.picture])
  const template: EventTemplate = { kind: 40, created_at: now, content: '', tags }
  const evt = finalizeEvent(template, hexToBytes(sk))
  const pub = JSON.stringify(["EVENT", evt])
  log(`createRoom name=${meta?.name || ''}`)
  for (const [url, ws] of pool.entries()) {
    if (ws.readyState === ws.OPEN) { ws.send(pub); log(`CREATE ROOM -> ${url} id=${evt.id.slice(0,8)}…`) }
    else if (ws.readyState === ws.CONNECTING) {
      try { ws.addEventListener('open', () => ws.send(pub), { once: true } as any) } catch {}
      log(`CREATE ROOM queued -> ${url} id=${evt.id.slice(0,8)}…`)
    }
  }
  // update local stores optimistically
  useRoomStore.getState().addRoom({ id: evt.id, name: meta?.name, about: meta?.about, picture: meta?.picture })
  const me = getPublicKey(hexToBytes(sk))
  useRoomStore.getState().setOwner(evt.id, me)
  if (meta?.members?.length) useRoomStore.getState().setMembers(evt.id, meta.members)
  return evt.id
}

// Update channel members and/or metadata
export async function updateRoomMembers(sk: string, roomId: string, members: string[], meta?: { name?: string; about?: string; picture?: string }) {
  const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
  const pool = getRelayPool(urls)
  const now = Math.floor(Date.now() / 1000)
  const tags: string[][] = [["e", roomId]]
  if (meta?.name) tags.push(['name', meta.name])
  if (meta?.about) tags.push(['about', meta.about])
  if (meta?.picture) tags.push(['picture', meta.picture])
  for (const m of members) tags.push(['p', m])
  const template: EventTemplate = { kind: 41, created_at: now, content: '', tags }
  const evt = finalizeEvent(template, hexToBytes(sk))
  const pub = JSON.stringify(["EVENT", evt])
  log(`updateRoomMembers room=${roomId.slice(0,8)}… members=${members.length} meta=${meta? 'y':'n'}`)
  for (const [url, ws] of pool.entries()) {
    if (ws.readyState === ws.OPEN) { ws.send(pub); log(`UPDATE ROOM -> ${url} id=${evt.id.slice(0,8)}…`) }
    else if (ws.readyState === ws.CONNECTING) {
      try { ws.addEventListener('open', () => ws.send(pub), { once: true } as any) } catch {}
      log(`UPDATE ROOM queued -> ${url} id=${evt.id.slice(0,8)}…`)
    }
  }
  // local update
  if (meta && (meta.name || meta.about || meta.picture)) useRoomStore.getState().setRoomMeta(roomId, meta)
  useRoomStore.getState().setMembers(roomId, members)
}

// Normalize a recipient pubkey to 64-hex (accepts url/nostr:/npub/nprofile/hex)
function normalizeToHexPubkey(input: string): string | null {
  if (!input) return null
  let s = input.trim()
  try {
    const u = new URL(s)
    const q = u.searchParams
    const cand = q.get('invite') || q.get('npub') || q.get('pubkey') || ''
    if (cand) s = cand
  } catch {}
  s = s.replace(/^nostr:/i, '').replace(/^web\+nostr:/i, '')
  const m = s.match(/(npub1[02-9ac-hj-np-z]{6,}|nprofile1[02-9ac-hj-np-z]{6,}|[0-9a-fA-F]{64})/)
  if (!m) return null
  const tok = m[1]
  if (/^[0-9a-fA-F]{64}$/.test(tok)) return tok.toLowerCase()
  try {
    const dec = nip19.decode(tok)
    if (dec.type === 'npub') return String(dec.data)
    if (dec.type === 'nprofile') return String((dec.data as any)?.pubkey || '')
  } catch {}
  return null
}

function dataURLToBytes(u: string): { mime: string, bytes: Uint8Array } {
  // data:[<mime>][;base64],<data>
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(u)
  const mime = (m?.[1] || 'application/octet-stream').trim()
  const b64 = (m?.[2] || '').toLowerCase().includes('base64')
  const payload = m?.[3] || ''
  if (b64) {
    const bin = atob(payload)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return { mime, bytes: out }
  }
  // URI-encoded
  const txt = decodeURIComponent(payload)
  const enc = new TextEncoder()
  return { mime, bytes: enc.encode(txt) }
}

function base64ByteLength(b64: string): number {
  const padding = (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0)
  return Math.floor((b64.length * 3) / 4) - padding
}
