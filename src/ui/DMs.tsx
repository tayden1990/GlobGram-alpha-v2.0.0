import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { finalizeEvent, getPublicKey, nip04, type Event, type EventTemplate } from 'nostr-tools'
import { DEFAULT_RELAYS } from '../nostr/relays'
import { hexToBytes, blobToDataURL, dataURLSize } from '../nostr/utils'

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
  const [sk, setSk] = useState<string | null>(null)
  const [peer, setPeer] = useState('')
  const [msg, setMsg] = useState('')
  const [inbox, setInbox] = useState<Event[]>([])
  const seenIdsRef = useRef<Set<string>>(new Set())
  const [attachment, setAttachment] = useState<string | null>(null) // data URL
  const [recording, setRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const sockets = useMemo(() => connectRelays(DEFAULT_RELAYS), [])

  useEffect(() => {
    const stored = localStorage.getItem('nostr_sk')
    if (stored) setSk(stored)
  }, [])

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

  const send = async () => {
    if (!sk || !peer || (!msg && !attachment)) return
    const now = Math.floor(Date.now() / 1000)
    const payload = JSON.stringify({ t: msg, a: attachment })
    const ciphertext = await nip04.encrypt(sk, peer, payload)
    const template: EventTemplate = {
      kind: 4,
      created_at: now,
      content: ciphertext,
      tags: [['p', peer]],
    }
    const evt = finalizeEvent(template, hexToBytes(sk))
    const pub = JSON.stringify(["EVENT", evt])
    for (const ws of sockets.values()) {
      if (ws.readyState === ws.OPEN) ws.send(pub)
    }
    setMsg('')
    setAttachment(null)
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
        if (obj && (obj.t || obj.a)) return obj
      } catch {}
      return { t: txt }
    } catch {
      return { t: '(failed to decrypt)' }
    }
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      alert('Only image files are supported currently')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      alert('Image too large (limit ~2MB for demo)')
      return
    }
    const url = await blobToDataURL(file)
    if (dataURLSize(url) > 2 * 1024 * 1024) {
      alert('Encoded image too large')
      return
    }
    setAttachment(url)
  }

  const startRecording = async () => {
    if (recording) return
    try {
      if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
        alert('Voice recording not supported in this browser')
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
          alert('Voice note too large (>1MB)')
          setRecording(false)
          return
        }
        const url = await blobToDataURL(blob)
        if (dataURLSize(url) > 1024 * 1024) {
          alert('Encoded audio too large')
          setRecording(false)
          return
        }
        setAttachment(url)
        setRecording(false)
      }
      mr.start()
      setRecording(true)
    } catch (e) {
      alert('Microphone permission denied')
    }
  }

  const stopRecording = () => {
    const mr = mediaRecorderRef.current
    if (!mr) return
    if (mr.state !== 'inactive') mr.stop()
    mr.stream.getTracks().forEach(t => t.stop())
  }

  return (
    <section style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
      <h2>Direct Messages</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
  <input placeholder="peer pubkey (hex)" value={peer} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPeer(e.target.value)} style={{ flex: 1, minWidth: 260 }} />
  <input placeholder="message" value={msg} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMsg(e.target.value)} style={{ flex: 2, minWidth: 260 }} />
        <input type="file" accept="image/*" onChange={onFile} />
        {!recording ? (
          <button onClick={startRecording} title="Record voice note">🎙️</button>
        ) : (
          <button onClick={stopRecording} title="Stop recording">⏹️</button>
        )}
        {attachment && (
          <span style={{ fontSize: 12, color: '#333' }}>attachment ready</span>
        )}
        <button onClick={send} disabled={!sk || !peer || (!msg && !attachment)}>Send</button>
      </div>
      {attachment && (
        <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
          <b>Preview:</b>
          {attachment.startsWith('data:image/') && (
            <img src={attachment} alt="attachment" style={{ maxWidth: 240, maxHeight: 160, borderRadius: 6 }} />
          )}
          {attachment.startsWith('data:audio/') && (
            <audio controls src={attachment} />
          )}
          <button onClick={() => setAttachment(null)}>Clear attachment</button>
        </div>
      )}
      <ul style={{ marginTop: 12, listStyle: 'none', padding: 0 }}>
  {inbox.map((e: Event) => (
          <li key={e.id} style={{ padding: 8, borderBottom: '1px solid #eee' }}>
            <div style={{ fontSize: 12, color: '#666' }}>
              <b>from</b> {e.pubkey.slice(0,8)}… <b>to</b> {e.tags.find(t=>t[0]==='p')?.[1]?.slice(0,8)}…
            </div>
            <MessageBody evt={e} decrypt={decrypt} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function MessageBody({ evt, decrypt }: { evt: Event, decrypt: (e: Event) => Promise<any> }) {
  const [content, setContent] = useState<{ t?: string; a?: string } | null>(null)
  useEffect(() => { decrypt(evt).then((v) => setContent(typeof v === 'string' ? { t: v } : v)) }, [evt, decrypt])
  if (!content) return <div>(decrypting…)</div>
  const { t, a } = content
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {t && <div>{t}</div>}
      {a && a.startsWith('data:image/') && (
        <img src={a} alt="image" style={{ maxWidth: '100%', borderRadius: 6 }} />
      )}
      {a && a.startsWith('data:audio/') && (
        <audio controls src={a} />
      )}
    </div>
  )
}
// Deprecated: legacy DMs panel removed. This file is intentionally left empty.
export {}
