import { getPublicKey, nip04, finalizeEvent, type Event, type EventTemplate } from 'nostr-tools'
import { getRelayPool, resetRelayPool } from './pool'
import { hexToBytes } from './utils'
import { encryptDataURL, type EncryptedMedia } from './media'
import { putObject, getObject, parseMemUrl } from '../services/upload'
import { useChatStore, type ChatMessage } from '../state/chatStore'
import { useRelayStore } from '../state/relayStore'
import { useRoomStore } from '../state/roomStore'

export function startNostrEngine(sk: string) {
  const pk = getPublicKey(hexToBytes(sk))
  const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
  const pool = getRelayPool(urls)
  const seen = new Set<string>()
  // react to relay changes at runtime
  const attachHandlers = (ws: WebSocket) => {
    ws.onopen = () => {
      ws.send(sub)
      ws.send(sub2)
  ws.send(subTyping)
  ws.send(subRooms)
      ws.send(subReceipts)
    }
    ws.onmessage = async (ev) => {
      try {
        const data = JSON.parse(ev.data as string)
  if (Array.isArray(data) && data[0] === 'EVENT') {
          const evt = data[2] as Event
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
            } catch {}
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
            } catch {}
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
              useRoomStore.getState().addRoom({ id: roomId })
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
        ws.send(sub)
        ws.send(sub2)
        ws.send(subTyping)
        ws.send(subRooms)
        ws.send(subReceipts)
      } catch {}
    }
  }
  useRelayStore.subscribe((s) => {
    const next = s.relays.filter(r => r.enabled).map(r => r.url)
    resetRelayPool(next)
    const pool2 = getRelayPool(next)
    for (const ws of pool2.values()) {
      attachHandlers(ws)
    }
  })

  const sub = JSON.stringify(["REQ", "inbox", { kinds: [4], authors: [pk] }])
  const sub2 = JSON.stringify(["REQ", "inbox2", { kinds: [4], '#p': [pk] }])
  const subTyping = JSON.stringify(["REQ", "typing", { kinds: [20000], '#p': [pk] }])
  const subRooms = JSON.stringify(["REQ", "rooms", { kinds: [40,41,42] }])
  const subReceipts = JSON.stringify(["REQ", "receipts", { kinds: [10001 as any], '#p': [pk] }])

  for (const ws of pool.values()) {
    attachHandlers(ws)
  }
}

// Lightweight data refresh: re-send subscription REQs to all connected relays
export function refreshSubscriptions() {
  try {
    const sk = localStorage.getItem('nostr_sk')
    if (!sk) return
    const pk = getPublicKey(hexToBytes(sk))
    const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
    const pool = getRelayPool(urls)
    const sub = JSON.stringify(["REQ", "inbox", { kinds: [4], authors: [pk] }])
    const sub2 = JSON.stringify(["REQ", "inbox2", { kinds: [4], '#p': [pk] }])
    const subTyping = JSON.stringify(["REQ", "typing", { kinds: [20000], '#p': [pk] }])
    const subRooms = JSON.stringify(["REQ", "rooms", { kinds: [40,41,42] }])
  const subReceipts = JSON.stringify(["REQ", "receipts", { kinds: [10001 as any], '#p': [pk] }])
    for (const ws of pool.values()) {
      if (ws.readyState === ws.OPEN) {
        try {
      ws.send(sub); ws.send(sub2); ws.send(subTyping); ws.send(subRooms); ws.send(subReceipts)
        } catch {}
      }
    }
  } catch {}
}

export async function sendDM(sk: string, to: string, payload: { t?: string; a?: any; as?: any[]; p?: string }) {
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
  const evt = finalizeEvent(template, hexToBytes(sk))
  const pub = JSON.stringify(["EVENT", evt])
  // add pending message immediately to avoid race with fast OK acks
  const me = getPublicKey(hexToBytes(sk))
  const addMessage = useChatStore.getState().addMessage
  addMessage(to, { id: evt.id, from: me, to, ts: now, text: payload.t, attachment: payload.a, attachments: payload.as, status: 'pending' })
  let acked = false
  let ackCount = 0
  let lastReason: string | undefined
  const handlers: Array<{ ws: WebSocket, fn: (ev: MessageEvent) => void }> = []
  for (const ws of pool.values()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(pub)
      const handler = (ev: MessageEvent) => {
        try {
          const data = JSON.parse((ev.data as string) || 'null')
          if (Array.isArray(data) && data[0] === 'OK' && data[1] === evt.id) {
            const ok = !!data[2]
            if (ok) {
              ackCount += 1
              if (acked) return
              acked = true
              useChatStore.getState().updateMessageStatus(to, evt.id, 'sent')
              ws.removeEventListener('message', handler as any)
              try { for (const h of handlers) h.ws.removeEventListener('message', h.fn as any) } catch {}
            } else {
              const reason = typeof data[3] === 'string' ? data[3] : undefined
              if (reason) lastReason = reason
            }
          }
        } catch {}
      }
      try { ws.addEventListener('message', handler as any); handlers.push({ ws, fn: handler }) } catch {}
    } else if (ws.readyState === ws.CONNECTING) {
      try { ws.addEventListener('open', () => ws.send(pub), { once: true } as any) } catch {}
    }
  }
  // If no relay ACK within 3s, retry once to all enabled relays
  try {
    setTimeout(() => {
      try {
        if (acked) return
        for (const ws of pool.values()) {
          if (ws.readyState === ws.OPEN) ws.send(pub)
        }
      } catch {}
    }, 3000)
  } catch {}
  // Second retry at 7s if still no ACK
  try {
    setTimeout(() => {
      try {
        if (acked) return
        for (const ws of pool.values()) {
          if (ws.readyState === ws.OPEN) ws.send(pub)
        }
      } catch {}
    }, 7000)
  } catch {}
  // fallback: if no relay OK after 15s, mark as failed
  try {
    setTimeout(() => {
      try {
        if (acked) return
        const conv = useChatStore.getState().conversations[to] || []
        const found = conv.find(m => m.id === evt.id)
        if (found && found.status === 'pending') {
      const reason = lastReason || (ackCount > 0 ? `Partial acks: ${ackCount}` : 'No relay acknowledgement')
      useChatStore.getState().updateMessageStatus(to, evt.id, 'failed', reason)
        }
        try { for (const h of handlers) h.ws.removeEventListener('message', h.fn as any) } catch {}
      } catch {}
    }, 20000)
  } catch {}
  // message already added above
}

export async function sendTyping(sk: string, to: string) {
  const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
  const pool = getRelayPool(urls)
  const now = Math.floor(Date.now() / 1000)
  const template: EventTemplate = { kind: 20000, created_at: now, content: '1', tags: [["p", to]] }
  const evt = finalizeEvent(template, hexToBytes(sk))
  const pub = JSON.stringify(["EVENT", evt])
  for (const ws of pool.values()) {
    if (ws.readyState === ws.OPEN) ws.send(pub)
    else if (ws.readyState === ws.CONNECTING) {
      try { ws.addEventListener('open', () => ws.send(pub), { once: true } as any) } catch {}
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
  for (const ws of pool.values()) {
    if (ws.readyState === ws.OPEN) ws.send(pub)
    else if (ws.readyState === ws.CONNECTING) {
      try { ws.addEventListener('open', () => ws.send(pub), { once: true } as any) } catch {}
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
  for (const ws of pool.values()) {
    if (ws.readyState === ws.OPEN) ws.send(pub)
    else if (ws.readyState === ws.CONNECTING) {
      try { ws.addEventListener('open', () => ws.send(pub), { once: true } as any) } catch {}
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
  for (const ws of pool.values()) {
    if (ws.readyState === ws.OPEN) ws.send(pub)
    else if (ws.readyState === ws.CONNECTING) {
      try { ws.addEventListener('open', () => ws.send(pub), { once: true } as any) } catch {}
    }
  }
  // local update
  if (meta && (meta.name || meta.about || meta.picture)) useRoomStore.getState().setRoomMeta(roomId, meta)
  useRoomStore.getState().setMembers(roomId, members)
}
