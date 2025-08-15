import { getPublicKey, nip04, finalizeEvent, type Event, type EventTemplate } from 'nostr-tools'
import { getRelayPool, resetRelayPool, trackListener } from './pool'
import { hexToBytes } from './utils'
import { encryptDataURL, type EncryptedMedia } from './media'
import { putObject, getObject, parseMemUrl } from '../services/upload'
import { useChatStore, type ChatMessage } from '../state/chatStore'
import { useRelayStore } from '../state/relayStore'
import { useRoomStore } from '../state/roomStore'
import { useSettingsStore } from '../ui/settingsStore'
import { log } from '../ui/logger'
import { emitToast } from '../ui/Toast'

export function startNostrEngine(sk: string) {
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
  // Maintain a focused subscription for currently selected room messages
  const updateCurrentRoomSub = (roomId: string | null) => {
    try {
      for (const [url, ws] of pool.entries()) {
        try { ws.send(JSON.stringify(["CLOSE", SUBS.roomCur])) } catch {}
        if (!roomId) continue
        const since = Math.floor(Date.now()/1000) - 7*24*60*60 // last 7 days
        const req = JSON.stringify(["REQ", SUBS.roomCur, { kinds: [42], '#e': [roomId], since }])
        try { ws.send(req); log(`Subscribe roomCur -> ${url} room=${roomId.slice(0,8)}…`) } catch {}
      }
    } catch {}
  }
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
                        }
                      }
                      if (!b64 && typeof ref.ctInline === 'string') {
                        b64 = ref.ctInline
                      }
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
                if (typeof attachment === 'object' && attachment) {
                  const r = await resolve(attachment)
                  attachment = r || undefined
                }
                if (attachments) {
                  const out: string[] = []
                  for (const a of attachments) {
                    if (typeof a === 'string') out.push(a)
                    else {
                      const r = await resolve(a)
                      if (r) out.push(r)
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
            const message: ChatMessage = {
              id: evt.id,
              from: evt.pubkey,
              to: peerPk === evt.pubkey ? pk : peerPk,
              ts: evt.created_at ?? Math.floor(Date.now() / 1000),
              text,
              attachment,
              attachments,
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
              if (members.length) useRoomStore.getState().setMembers(ref, members)
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
                  if (typeof attachment === 'object' && attachment) {
                    const r = await resolve(attachment)
                    attachment = r || undefined
                  }
                  if (attachments) {
                    const out: string[] = []
                    for (const a of attachments) {
                      if (typeof a === 'string') out.push(a)
                      else {
                        const r = await resolve(a)
                        if (r) out.push(r)
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
              useRoomStore.getState().addRoomMessage(roomId, { id: evt.id, roomId, from: evt.pubkey, ts: evt.created_at ?? Math.floor(Date.now()/1000), text, attachment, attachments })
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
          // re-apply current room subscription on refresh
          try { ws.send(JSON.stringify(["CLOSE", 'roomCur'])) } catch {}
          try {
            const rid = useRoomStore.getState().selectedRoom
            if (rid) {
              const since = Math.floor(Date.now()/1000) - 7*24*60*60
              const req = JSON.stringify(["REQ", 'roomCur', { kinds: [42], '#e': [rid], since }])
              ws.send(req)
            }
          } catch {}
        } catch {}
      }
    }
  } catch {}
}

export async function sendDM(sk: string, to: string, payload: { t?: string; a?: any; as?: any[]; p?: string }) {
  log(`sendDM -> ${to.slice(0,8)}… t=${payload.t ? (payload.t.slice(0,24)+(payload.t.length>24?'…':'')) : ''} a=${payload.a?'y':'n'} as=${payload.as?.length||0}`)
  const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
  const pool = getRelayPool(urls)
  const now = Math.floor(Date.now() / 1000)
  // If attachments exist and are data URLs, optionally encrypt and upload
  const processOne = async (d: any): Promise<any> => {
    if (typeof d === 'string' && d.startsWith('data:') && payload.p) {
      // encrypt and upload
      const enc = await encryptDataURL(d, payload.p)
      const key = `${to}:${evtIdSeed}:${Math.random().toString(36).slice(2)}`
      const url = await putObject(key, enc.mime, enc.ct)
  return { url, enc: { iv: Array.from(atob(enc.iv).split('').map(c=>c.charCodeAt(0))), keySalt: Array.from(atob(enc.keySalt).split('').map(c=>c.charCodeAt(0))), mime: enc.mime, sha256: enc.sha256 }, ctInline: enc.ct }
    }
    return d
  }
  const evtIdSeed = Math.floor(Math.random() * 1e9)
  let outA = payload.a ? await processOne(payload.a) : undefined
  let outAs = payload.as ? await Promise.all(payload.as.map(processOne)) : undefined
  const body = JSON.stringify({ t: payload.t, a: outA, as: outAs, p: payload.p })
  const ciphertext = await nip04.encrypt(sk, to, body)
  const template: EventTemplate = { kind: 4, created_at: now, content: ciphertext, tags: [["p", to]] }
  let evt: any = finalizeEvent(template, hexToBytes(sk))
  const pub = JSON.stringify(["EVENT", evt])
  // add pending message immediately to avoid race with fast OK acks
  const me = getPublicKey(hexToBytes(sk))
  const addMessage = useChatStore.getState().addMessage
  addMessage(to, { id: evt.id, from: me, to, ts: now, text: payload.t, attachment: payload.a, attachments: payload.as, status: 'pending' })
  let acked = false
  let ackCount = 0
  let lastReason: string | undefined
  let powBitsRequired: number | null = null
  const handlers: Array<{ ws: WebSocket, fn: (ev: MessageEvent) => void }> = []
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
              if (acked) return
              acked = true
              useChatStore.getState().updateMessageStatus(to, evt.id, 'sent')
              ws.removeEventListener('message', handler as any)
              try { for (const h of handlers) h.ws.removeEventListener('message', h.fn as any) } catch {}
              log(`OK @ ${url} (count=${ackCount}) id=${evt.id.slice(0,8)}…`)
            } else {
              const reason = typeof data[3] === 'string' ? data[3] : undefined
              if (reason) {
                lastReason = reason
                // detect NIP-13 PoW requirement in reason, e.g., "pow: 28 bits needed"
                const m = /(pow)\s*:\s*(\d+)\s*bits/i.exec(reason)
                if (m) {
                  powBitsRequired = parseInt(m[2], 10)
                  log(`PoW required @ ${url}: ${powBitsRequired} bits`,'warn')
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
  // If relay requested PoW, try to re-mine with a nonce tag and resend
  if (!acked && powBitsRequired && powBitsRequired > 0) {
    const miningEnabled = (() => { try { return useSettingsStore.getState().powMining } catch { return true } })()
    if (!miningEnabled) {
      const reason = `PoW required (${powBitsRequired} bits) but disabled in Settings`
      try { useChatStore.getState().updateMessageStatus(to, evt.id, 'failed', reason) } catch {}
      // Surface a toast with an action hint
      emitToast('PoW required by relay. Enable PoW mining in Settings to send.', 'error')
      // prevent further retries/timeouts and cleanup listeners
      acked = true
      try { for (const h of handlers) h.ws.removeEventListener('message', h.fn as any) } catch {}
  log('PoW disabled; not mining and marking failed','warn')
      return
    }
    try {
      // Update status to show we're working
      useChatStore.getState().updateMessageStatus(to, evt.id, 'pending', `Mining ${powBitsRequired} bits…`)
  log(`Mining start: ${powBitsRequired} bits for id=${evt.id.slice(0,8)}…`)
      const { newEvt } = await mineEventWithPow(evt, powBitsRequired)
      const oldId = evt.id
      evt = newEvt
  log(`Mining success: new id=${evt.id.slice(0,8)}… old=${oldId.slice(0,8)}…`)
      // Update local message id so receipts/acks match
      try { useChatStore.getState().updateMessageId(to, oldId, evt.id) } catch {}
      const pub2 = JSON.stringify(["EVENT", evt])
      for (const [url, ws] of pool.entries()) {
        if (ws.readyState === ws.OPEN) { ws.send(pub2); log(`EVENT (mined) -> ${url} id=${evt.id.slice(0,8)}…`) }
        else if (ws.readyState === ws.CONNECTING) {
          try { ws.addEventListener('open', () => ws.send(pub2), { once: true } as any) } catch {}
          log(`EVENT (mined) queued -> ${url} id=${evt.id.slice(0,8)}…`)
        }
      }
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
        const conv = useChatStore.getState().conversations[to] || []
        const found = conv.find(m => m.id === evt.id)
        if (found && found.status === 'pending') {
          const reason = lastReason || (powBitsRequired ? `PoW required (${powBitsRequired} bits)` : (ackCount > 0 ? `Partial acks: ${ackCount}` : 'No relay acknowledgement'))
          useChatStore.getState().updateMessageStatus(to, evt.id, 'failed', reason)
        }
        try { for (const h of handlers) h.ws.removeEventListener('message', h.fn as any) } catch {}
      } catch {}
  }, 20000)
  // if we do get an ack later, clear timer
  if (acked) try { clearTimeout(failTimer) } catch {}
  } catch {}
  // message already added above
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
export async function sendRoom(sk: string, roomId: string, text?: string, opts?: { a?: string; as?: string[]; p?: string }) {
  // membership/owner gate: only allow sending if caller is owner or member
  const me = getPublicKey(hexToBytes(sk))
  const owner = useRoomStore.getState().owners[roomId]
  const mem = useRoomStore.getState().members[roomId]
  if (!(owner === me || !!(mem && mem[me]))) {
    throw new Error('Not a member of this room')
  }
  const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
  const pool = getRelayPool(urls)
  const now = Math.floor(Date.now() / 1000)
  const evtIdSeed = Math.floor(Math.random() * 1e9)
  const processOne = async (d: any): Promise<any> => {
  if (typeof d === 'string' && d.startsWith('data:') && opts?.p) {
      const enc = await encryptDataURL(d, opts.p)
      const key = `${roomId}:${evtIdSeed}:${Math.random().toString(36).slice(2)}`
      const url = await putObject(key, enc.mime, enc.ct)
      return { url, enc: { iv: Array.from(atob(enc.iv).split('').map(c=>c.charCodeAt(0))), keySalt: Array.from(atob(enc.keySalt).split('').map(c=>c.charCodeAt(0))), mime: enc.mime, sha256: enc.sha256 }, ctInline: enc.ct }
    }
    return d
  }
  const outA = opts?.a ? await processOne(opts.a) : undefined
  const outAs = opts?.as ? await Promise.all(opts.as.map(processOne)) : undefined
  const body = JSON.stringify({ t: text, a: outA, as: outAs, p: opts?.p })
  const template: EventTemplate = { kind: 42, created_at: now, content: body, tags: [["e", roomId]] }
  const evt = finalizeEvent(template, hexToBytes(sk))
  const pub = JSON.stringify(["EVENT", evt])
  log(`sendRoom room=${roomId.slice(0,8)}… text=${text ? (text.slice(0,24)+(text.length>24?'…':'')) : ''} a=${opts?.a?'y':'n'} as=${opts?.as?.length||0}`)
  for (const [url, ws] of pool.entries()) {
    if (ws.readyState === ws.OPEN) { ws.send(pub); log(`ROOM EVENT -> ${url} id=${evt.id.slice(0,8)}…`) }
    else if (ws.readyState === ws.CONNECTING) {
      try { ws.addEventListener('open', () => ws.send(pub), { once: true } as any) } catch {}
      log(`ROOM EVENT queued -> ${url} id=${evt.id.slice(0,8)}…`)
    }
  }
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
