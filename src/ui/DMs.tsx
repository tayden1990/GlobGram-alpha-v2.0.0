import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type React from 'react'
import { finalizeEvent, getPublicKey, nip04, type Event, type EventTemplate } from 'nostr-tools'
import { DEFAULT_RELAYS } from '../nostr/relays'
import { hexToBytes, blobToDataURL, dataURLSize } from '../nostr/utils'
import { useToast } from './Toast'
import { getObject, parseMemUrl } from '../services/upload'
import { sendDM as engineSendDM } from '../nostr/engine'
import { THUMB_SIZE, PRELOAD_ROOT_MARGIN } from './constants'

// simple relay pool using native WebSocket to avoid heavy deps
function connectRelays(urls: string[]) {
  const sockets = new Map<string, WebSocket>()
  for (const u of urls) {
    try {
      const ws = new WebSocket(u)
      sockets.set(u, ws)
    } catch {}
  }
  return sockets
}

export function DMs() {
  const { show } = useToast()
  const [sk, setSk] = useState<string | null>(null)
  const [peer, setPeer] = useState('')
  const [msg, setMsg] = useState('')
  const [inbox, setInbox] = useState<Event[]>([])
  const seenIdsRef = useRef<Set<string>>(new Set())
  const [attachment, setAttachment] = useState<string | null>(null) // data URL
  const [attachments, setAttachments] = useState<string[]>([])
  const [recording, setRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [visibleCount, setVisibleCount] = useState<number>(50)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const loadingMoreRef = useRef(false)
  const TOP_THRESHOLD = 64
  const BATCH = 50
  const [encOn, setEncOn] = useState(false)
  const [encPass, setEncPass] = useState('')
  const topSentinelRef = useRef<HTMLDivElement | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [isPreloading, setIsPreloading] = useState(false)
  const [lightbox, setLightbox] = useState<null | { type: 'image'|'video'|'audio'; src: string }>(null)
  // Close lightbox on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // helpers for generic files
  function readableSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }
  function guessExt(mime: string) {
    const map: Record<string, string> = {
      'application/pdf': 'pdf', 'application/zip': 'zip', 'application/json': 'json', 'text/plain': 'txt',
      'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    }
    return map[mime] || ''
  }
  function filenameForDataUrl(durl: string) {
    const m = /^data:([^;]+);/.exec(durl)
    const mime = m?.[1] || 'application/octet-stream'
    const ext = guessExt(mime)
    return ext ? `download.${ext}` : 'download'
  }

  const sockets = useMemo(() => connectRelays(DEFAULT_RELAYS), [])

  useEffect(() => {
    const stored = localStorage.getItem('nostr_sk')
    if (stored) setSk(stored)
  }, [])

  // render in chronological order for consistent UX (oldest -> newest)
  const orderedInbox = useMemo(() => {
    return [...inbox].sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
  }, [inbox])

  // virtualized slice (newest N of ordered)
  const items = useMemo(() => orderedInbox.slice(-visibleCount), [orderedInbox, visibleCount])
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => 100,
    overscan: 8,
  })

  useEffect(() => {
    // subscribe to kind 4 (DMs) to/from our pubkey
    if (!sk) return
    const pk = getPublicKey(hexToBytes(sk))
    const sub = JSON.stringify(["REQ", "inbox", { kinds: [4], authors: [pk] }])
    const sub2 = JSON.stringify(["REQ", "inbox2", { kinds: [4], '#p': [pk] }])
    for (const ws of sockets.values()) {
      ws.onopen = () => {
        ws.send(sub)
        ws.send(sub2)
      }
      ws.onmessage = (ev: MessageEvent<string>) => {
        try {
          const data = JSON.parse(ev.data)
          if (Array.isArray(data) && data[0] === 'EVENT') {
            const evt = data[2] as Event
            if (evt.kind === 4) {
              // dedupe across relays and overlapping filters by event id
              if (!seenIdsRef.current.has(evt.id)) {
                seenIdsRef.current.add(evt.id)
                setInbox((prev: Event[]) => [evt, ...prev])
              }
            }
          }
        } catch {}
      }
    }
    return () => {
      for (const ws of sockets.values()) {
        try { ws.close() } catch {}
      }
    }
  }, [sk, sockets])

  // keep view pinned to bottom when new messages arrive (initially and when we're already near bottom)
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    // if we're close to bottom (within 120px), auto-stick to bottom on new items
    const total = rowVirtualizer.getTotalSize ? rowVirtualizer.getTotalSize() : scroller.scrollHeight
    const distanceFromBottom = total - scroller.scrollTop - scroller.clientHeight
    if (distanceFromBottom < 120) {
      scroller.scrollTop = total
    }
  }, [inbox.length])

  // reset pagination if key changes
  useEffect(() => { setVisibleCount(BATCH) }, [sk])
  // IntersectionObserver: preload older when near top (virtualizer-aware)
  useEffect(() => {
    const root = scrollerRef.current
    const el = topSentinelRef.current
    if (!root || !el) return
    const obs = new IntersectionObserver((entries) => {
      const [entry] = entries
      if (entry && entry.isIntersecting && orderedInbox.length > visibleCount && !loadingMoreRef.current) {
        loadingMoreRef.current = true
        setIsPreloading(true)
        const prevTotal = rowVirtualizer.getTotalSize()
        const prevTop = root.scrollTop
        setVisibleCount(c => {
          const next = Math.min(c + BATCH, orderedInbox.length)
          setTimeout(() => {
            rowVirtualizer.measure()
            const newTotal = rowVirtualizer.getTotalSize()
            root.scrollTop = newTotal - prevTotal + prevTop
            loadingMoreRef.current = false
            setIsPreloading(false)
          }, 0)
          return next
        })
      }
  }, { root, threshold: 0.01, rootMargin: PRELOAD_ROOT_MARGIN })
    obs.observe(el)
    return () => obs.disconnect()
  }, [orderedInbox.length, visibleCount])

  const send = async () => {
    const hasMedia = !!attachment || attachments.length > 0
    if (!sk || !peer || (!msg && !hasMedia)) return
    try {
      const p = encOn && hasMedia ? encPass : undefined
      if (encOn && hasMedia && !p) { show('Enter a media passphrase', 'error'); return }
      await engineSendDM(sk, peer, { t: msg || undefined, a: attachment || undefined, as: attachments.length ? attachments : undefined, p })
      setMsg('')
      setAttachment(null)
      setAttachments([])
    } catch {
      show('Failed to send', 'error')
    }
  }

  const decrypt = async (evt: Event) => {
    if (!sk) return { t: '(no key)' }
    const p = evt.tags.find(t => t[0] === 'p')?.[1] || ''
    try {
      // if we authored it, peer is tag p; else author is sender
      const peerPub = evt.pubkey === getPublicKey(hexToBytes(sk)) ? p : evt.pubkey
      const txt = await nip04.decrypt(sk, peerPub, evt.content)
      try {
        const obj = JSON.parse(txt)
        if (obj && (obj.t || obj.a || obj.as)) {
          const pass: string = typeof obj.p === 'string' ? obj.p : ''
          const resolve = async (ref: any): Promise<string | null> => {
            try {
              if (typeof ref === 'string' && ref.startsWith('data:')) return ref
              if (ref && ref.enc && (ref.url || ref.ctInline)) {
                let b64: string | null = null
                if (typeof ref.url === 'string') {
                  const memKey = parseMemUrl(ref.url)
                  if (memKey) {
                    const o = await getObject(memKey)
                    if (o) b64 = o.base64Data
                  } else {
                    const o = await getObject(ref.url)
                    if (o) b64 = o.base64Data
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
          let a = obj.a
          if (a && typeof a === 'object') {
            const r = await resolve(a)
            a = r || undefined
          }
          let as: string[] | undefined = undefined
          if (Array.isArray(obj.as)) {
            const out: string[] = []
            for (const it of obj.as) {
              if (typeof it === 'string') out.push(it)
              else {
                const r = await resolve(it)
                if (r) out.push(r)
              }
            }
            as = out.length ? out : undefined
          }
          return { t: obj.t, a, as }
        }
      } catch {}
      return { t: txt }
    } catch {
      return { t: '(failed to decrypt)' }
    }
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const urls: string[] = []
    for (const file of files) {
      if (file.size > 2 * 1024 * 1024) { show('File too large (>2MB)', 'error'); continue }
      const url = await blobToDataURL(file)
      if (dataURLSize(url) > 2 * 1024 * 1024) { show('Encoded file too large', 'error'); continue }
      urls.push(url)
    }
    if (urls.length === 1) setAttachment(urls[0])
    if (urls.length > 1) setAttachments(urls)
  }

  const startRecording = async () => {
    if (recording) return
    try {
      if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
        show('Voice recording not supported in this browser', 'error')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      mediaRecorderRef.current = mr
      chunksRef.current = []
      mr.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data) }
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (blob.size > 1024 * 1024) {
          show('Voice note too large (>1MB)', 'error')
          setRecording(false)
          return
        }
        const url = await blobToDataURL(blob)
        if (dataURLSize(url) > 1024 * 1024) {
          show('Encoded audio too large', 'error')
          setRecording(false)
          return
        }
        setAttachment(url)
        setRecording(false)
      }
      mr.start()
      setRecording(true)
    } catch (e) {
      show('Microphone permission denied', 'error')
    }
  }

  const stopRecording = () => {
    const mr = mediaRecorderRef.current
    if (!mr) return
    if (mr.state !== 'inactive') mr.stop()
    mr.stream.getTracks().forEach(t => t.stop())
  }

  return (
  <section style={{ marginTop: 16, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card)', color: 'var(--fg)' }}>
      <h2>Direct Messages</h2>
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
  <input placeholder="peer pubkey (hex)" value={peer} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPeer(e.target.value)} style={{ flex: 1, minWidth: 260 }} />
  <input placeholder="message" value={msg} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMsg(e.target.value)} style={{ flex: 2, minWidth: 260 }} />
  <input type="file" multiple onChange={onFile} />
        {!recording ? (
          <button onClick={startRecording} title="Record voice note">🎙️</button>
        ) : (
          <button onClick={stopRecording} title="Stop recording">⏹️</button>
        )}
  {attachment && (<span style={{ fontSize: 12, color: 'var(--fg)' }}>attachment ready</span>)}
  {attachments.length > 0 && (<span style={{ fontSize: 12, color: 'var(--fg)' }}>{attachments.length} files ready</span>)}
        <label title="Encrypt media attachments with a passphrase" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <input type="checkbox" checked={encOn} onChange={(e) => setEncOn(e.target.checked)} /> Encrypt media
        </label>
        {encOn && (
          <input type="password" placeholder="media passphrase" value={encPass} onChange={(e) => setEncPass(e.target.value)} style={{ width: 160 }} />
        )}
        <button onClick={send} disabled={!sk || !peer || (!msg && !attachment && attachments.length===0)}>Send</button>
      </div>
      {(attachment || attachments.length>0) && (
        <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
          <b>Preview:</b>
          {attachment && attachment.startsWith('data:image/') && (
            <img src={attachment} alt="attachment" loading="lazy" decoding="async" style={{ maxWidth: 240, maxHeight: 160, borderRadius: 6 }} />
          )}
          {attachment && attachment.startsWith('data:audio/') && (
            <audio controls src={attachment} />
          )}
          {attachments.length>0 && (<span style={{ fontSize: 12 }}>{attachments.length} files</span>)}
          <button onClick={() => { setAttachment(null); setAttachments([]) }}>Clear</button>
        </div>
      )}
  <div
        ref={scrollerRef}
  style={{ marginTop: 12, maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, position: 'relative', background: 'var(--bg)' }}
        onDragOver={(e) => { e.preventDefault() }}
        onDrop={async (e) => {
          e.preventDefault()
          const files = Array.from(e.dataTransfer?.files || [])
          if (!files.length) return
          const urls: string[] = []
          for (const f of files) {
            if (f.size > 2 * 1024 * 1024) { show('File too large (>2MB)', 'error'); continue }
            const url = await blobToDataURL(f)
            if (dataURLSize(url) > 2 * 1024 * 1024) { show('Encoded file too large', 'error'); continue }
            urls.push(url)
          }
          if (urls.length === 1) setAttachment(urls[0])
          if (urls.length > 1) setAttachments(urls)
        }}
      >
        <div ref={topSentinelRef} style={{ height: 1 }} />
        <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((vr) => {
            const e = items[vr.index]
            return (
              <div key={vr.key} ref={rowVirtualizer.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vr.start}px)` }}>
                <div style={{ listStyle: 'none', padding: 8, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#e0e0e0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>
                      {e.pubkey.slice(0,2)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span><b>from</b> {e.pubkey.slice(0,8)}… <b>to</b> {e.tags.find(t=>t[0]==='p')?.[1]?.slice(0,8)}…</span>
                      <span style={{ color: '#999' }}>{new Date((e.created_at ?? Math.floor(Date.now()/1000)) * 1000).toLocaleTimeString()}</span>
                    </div>
                  </div>
                  <MessageBody evt={e} decrypt={decrypt} onOpen={(type, src) => setLightbox({ type, src })} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button style={{ fontSize: 12 }} onClick={async () => { try { await navigator.clipboard.writeText((await decrypt(e)).t || '') } catch {} }}>Copy</button>
                    <button style={{ fontSize: 12 }} onClick={() => setInbox(prev => prev.filter(x => x.id !== e.id))}>Delete</button>
                    <button style={{ fontSize: 12 }} onClick={async () => {
                      const c = await decrypt(e)
                      const text = (c.t || '').slice(0, 200)
                      setMsg(m => (m ? m + '\n' : '') + (text ? `> ${text}\n` : ''))
                    }}>Reply</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
  {(loadingMore || isPreloading) && <div style={{ padding: 6, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>Loading…</div>}
      </div>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh' }}>
            {lightbox.type === 'image' && (
              <img src={lightbox.src} alt="image" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', display: 'block' }} />
            )}
            {lightbox.type === 'video' && (
              <video controls autoPlay src={lightbox.src} style={{ maxWidth: '90vw', maxHeight: '90vh' }} />
            )}
            {lightbox.type === 'audio' && (
              <audio controls src={lightbox.src} style={{ width: '80vw' }} />
            )}
          </div>
          <button onClick={() => setLightbox(null)} style={{ position: 'fixed', top: 16, right: 16, fontSize: 18, background: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>✖</button>
        </div>
      )}
    </section>
  )
}

function MessageBody({ evt, decrypt, onOpen }: { evt: Event, decrypt: (e: Event) => Promise<any>, onOpen?: (type: 'image'|'video'|'audio', src: string) => void }) {
  const [content, setContent] = useState<{ t?: string; a?: string; as?: string[] } | null>(null)
  // local helper to avoid import cycles
  const filenameForDataUrlLocal = (durl: string) => {
    const m = /^data:([^;]+);/.exec(durl)
    const mime = m?.[1] || 'application/octet-stream'
    const map: Record<string, string> = {
      'application/pdf': 'pdf', 'application/zip': 'zip', 'application/json': 'json', 'text/plain': 'txt',
      'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    }
    const ext = map[mime] || ''
    return ext ? `download.${ext}` : 'download'
  }
  useEffect(() => { decrypt(evt).then((v) => setContent(typeof v === 'string' ? { t: v } : v)) }, [evt, decrypt])
  if (!content) return <div>(decrypting…)</div>
  const { t, a, as } = content
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {t && <div>{t}</div>}
      {a && a.startsWith('data:image/') && (
  <div title="Open image" onClick={() => onOpen?.('image', a)} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: 'var(--border)', cursor: 'pointer' }}>
          <img src={a} alt="image" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      )}
      {a && a.startsWith('data:video/') && (
  <div title="Play video" onClick={() => onOpen?.('video', a)} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: '#000', position: 'relative', cursor: 'pointer' }}>
          <video src={a} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 28, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>▶</div>
        </div>
      )}
      {a && a.startsWith('data:audio/') && (
  <button title="Play audio" onClick={() => onOpen?.('audio', a)} style={{ padding: '6px 10px', borderRadius: 16, background: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--border)', cursor: 'pointer', width: 'fit-content' }}>♫ Audio</button>
      )}
      {a && a.startsWith('data:') && !a.startsWith('data:image/') && !a.startsWith('data:audio/') && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a href={a} download={filenameForDataUrlLocal(a)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)' }}>
            📎 Download file
          </a>
          <button style={{ fontSize: 12 }} onClick={async () => {
            try { await navigator.clipboard.writeText(a) } catch {}
          }}>Copy link</button>
          <button style={{ fontSize: 12 }} onClick={async () => {
            try {
              const match = /^data:([^;]+);base64,(.*)$/.exec(a)
              if (!match) throw new Error('not data url')
              const mime = match[1]
              const b64 = match[2]
              const bin = atob(b64)
              const bytes = new Uint8Array(bin.length)
              for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i)
              const blob = new Blob([bytes], { type: mime })
              if ((window as any).ClipboardItem) {
                await navigator.clipboard.write([new (window as any).ClipboardItem({ [mime]: blob })])
              }
            } catch {}
          }}>Copy as file</button>
        </div>
      )}
      {Array.isArray(as) && as.map((x, i) => (
        x.startsWith('data:image/') ? (
          <div key={i} title="Open image" onClick={() => onOpen?.('image', x)} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: 'var(--border)', cursor: 'pointer' }}>
            <img src={x} alt="image" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
        ) : x.startsWith('data:video/') ? (
          <div key={i} title="Play video" onClick={() => onOpen?.('video', x)} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: '#000', position: 'relative', cursor: 'pointer' }}>
            <video src={x} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 28, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>▶</div>
          </div>
        ) : x.startsWith('data:audio/') ? (
          <button key={i} title="Play audio" onClick={() => onOpen?.('audio', x)} style={{ padding: '6px 10px', borderRadius: 16, background: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--border)', cursor: 'pointer', width: 'fit-content' }}>♫ Audio</button>
        ) : x.startsWith('data:') ? (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <a href={x} download={filenameForDataUrlLocal(x)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)' }}>
              📎 Download file
            </a>
            <button style={{ fontSize: 12 }} onClick={async () => {
              try { await navigator.clipboard.writeText(x) } catch {}
            }}>Copy link</button>
            <button style={{ fontSize: 12 }} onClick={async () => {
              try {
                const match = /^data:([^;]+);base64,(.*)$/.exec(x)
                if (!match) throw new Error('not data url')
                const mime = match[1]
                const b64 = match[2]
                const bin = atob(b64)
                const bytes = new Uint8Array(bin.length)
                for (let j=0;j<bin.length;j++) bytes[j] = bin.charCodeAt(j)
                const blob = new Blob([bytes], { type: mime })
                if ((window as any).ClipboardItem) {
                  await navigator.clipboard.write([new (window as any).ClipboardItem({ [mime]: blob })])
                }
              } catch {}
            }}>Copy as file</button>
          </div>
        ) : null
      ))}
    </div>
  )
}
// Deprecated: legacy DMs panel removed. This file is intentionally left empty.
export {}
