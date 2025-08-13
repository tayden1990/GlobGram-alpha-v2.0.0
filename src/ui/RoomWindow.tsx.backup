import { useMemo, useRef, useState } from 'react'
import { useRoomStore } from '../state/roomStore'
import { useChatStore } from '../state/chatStore'
import { sendRoom } from '../nostr/engine'
import { useContactStore } from '../state/contactStore'
import { blobToDataURL, dataURLSize } from '../nostr/utils'

export function RoomWindow() {
  const selected = useRoomStore(s => s.selectedRoom)
  const rooms = useRoomStore(s => s.rooms)
  const messages = useRoomStore(s => s.messages)
  const addMsg = useRoomStore(s => s.addRoomMessage)
  const my = useChatStore(s => s.myPubkey)
  const aliases = useContactStore(s => s.aliases)
  const owners = useRoomStore(s => s.owners)
  const members = useRoomStore(s => s.members)
  const [encOn, setEncOn] = useState(false)
  const [encPass, setEncPass] = useState('')
  const [text, setText] = useState('')
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [attachment, setAttachment] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<string[]>([])
  const [recording, setRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const msgs = useMemo(() => selected ? (messages[selected] || []) : [], [messages, selected])
  const canAccess = useMemo(() => {
    if (!selected || !my) return false
    if (owners[selected] === my) return true
    return !!(members[selected] && members[selected][my])
  }, [selected, my, owners, members])

  if (!selected) return <section style={{ flex: 1, padding: 16 }}>Select a room</section>

  return (
    <section style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontFamily: 'monospace' }}>Room {selected.slice(0,12)}…</div>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }} title="Encrypt media attachments with a passphrase">
          <input type="checkbox" checked={encOn} onChange={(e) => setEncOn(e.target.checked)} /> Encrypt media
        </label>
        {encOn && <input type="password" placeholder="media passphrase" value={encPass} onChange={(e) => setEncPass(e.target.value)} style={{ width: 160 }} />}
      </header>
      <div ref={scrollerRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'grid', gap: 8 }} onDragOver={(e) => { e.preventDefault(); }} onDrop={async (e) => {
        e.preventDefault()
        const f = e.dataTransfer?.files?.[0]
        if (!f) return
        if (!/(image|video)\//.test(f.type)) return
        if (f.size > 2 * 1024 * 1024) return alert('File too large (>2MB)')
        const url = await blobToDataURL(f)
        if (dataURLSize(url) > 2 * 1024 * 1024) return alert('Encoded file too large')
        setAttachment(url)
      }}>
        {!canAccess && (
          <div style={{ color: '#666' }}>You are not a member of this room. Ask the owner to add you.</div>
        )}
        {canAccess && msgs.map(m => {
          const sender = m.from === my ? 'You' : (aliases[m.from] || `${m.from.slice(0,8)}…`)
          return (
          <div key={m.id} style={{ justifySelf: m.from === my ? 'end' : 'start', maxWidth: 520 }}>
            <div style={{ fontSize: 11, color: '#555', marginLeft: 4, marginBottom: 2 }}>{sender}</div>
            {m.text && <div style={{ background: '#f2f2f2', borderRadius: 12, padding: '8px 10px' }}>{m.text}</div>}
            {m.attachment?.startsWith('data:image/') && (
              <img src={m.attachment} alt="image" style={{ maxWidth: '100%', borderRadius: 8 }} />
            )}
            {m.attachment?.startsWith('data:audio/') && (
              <audio controls src={m.attachment} />
            )}
            {m.attachment?.startsWith('data:video/') && (
              <video controls src={m.attachment} style={{ maxWidth: '100%', borderRadius: 8 }} />
            )}
            {m.attachments?.map((a, i) => (
              a.startsWith('data:image/') ? <img key={i} src={a} alt="image" style={{ maxWidth: '100%', borderRadius: 8 }} />
              : a.startsWith('data:video/') ? <video key={i} controls src={a} style={{ maxWidth: '100%', borderRadius: 8 }} />
              : a.startsWith('data:audio/') ? <audio key={i} controls src={a} />
              : null
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <div style={{ fontSize: 10, color: '#777' }}>{new Date(m.ts * 1000).toLocaleTimeString()}</div>
            </div>
          </div>
        )})}
      </div>
      <footer style={{ borderTop: '1px solid #eee', padding: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
  <input placeholder="message to room" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1 }} disabled={!canAccess} />
  <input type="file" accept="image/*,video/*,audio/*" multiple disabled={!canAccess} onChange={async (e) => {
          const files = Array.from(e.target.files || [])
          const urls: string[] = []
          for (const file of files) {
            if (!/(image|video|audio)\//.test(file.type)) continue
            if (file.size > 2 * 1024 * 1024) { alert('File too large (>2MB)'); continue }
            const url = await blobToDataURL(file)
            if (dataURLSize(url) > 2 * 1024 * 1024) { alert('Encoded file too large'); continue }
            urls.push(url)
          }
          if (urls.length === 1) setAttachment(urls[0])
          if (urls.length > 1) setAttachments(urls)
        }} />
        {!recording ? (
          <button title="Record voice" onClick={async () => {
            if (!canAccess) return
            try {
              if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') return alert('Recording unsupported')
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
              const mr = new MediaRecorder(stream)
              mediaRecorderRef.current = mr
              chunksRef.current = []
              mr.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data) }
              mr.onstart = () => setRecording(true)
              mr.onstop = async () => {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
                if (blob.size > 1024 * 1024) { setRecording(false); return alert('Voice note too large (>1MB)') }
                const url = await blobToDataURL(blob)
                if (dataURLSize(url) > 1024 * 1024) { setRecording(false); return alert('Encoded audio too large') }
                setAttachment(url)
                setRecording(false)
              }
              // give immediate feedback even if onstart is delayed
              setRecording(true)
              mr.start()
            } catch (err) {
              setRecording(false)
              alert('Microphone permission denied or unavailable')
            }
          }}>🎙️</button>
          ) : ( 
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#d00' }}>
              <span>Recording…</span>
              <button title="Stop recording" onClick={() => {
                const mr = mediaRecorderRef.current
                if (mr && mr.state !== 'inactive') mr.stop()
                if (mr) mr.stream.getTracks().forEach(t => t.stop())
              }}>⏹️</button>
            </span>
        )}
        {attachment && <span style={{ fontSize: 12 }}>attachment ready</span>}
        {attachments.length > 0 && <span style={{ fontSize: 12 }}>{attachments.length} files ready</span>}
  <button disabled={recording} onClick={async () => {
          if (!canAccess) { alert('You are not a member of this room'); return }
          if (!selected || !my) return
          if (!text.trim() && !attachment && attachments.length === 0) return
          const sk = localStorage.getItem('nostr_sk')
          if (!sk) return
          // optimistic add
          const id = Math.random().toString(36).slice(2)
          addMsg(selected, { id, roomId: selected, from: my, ts: Math.floor(Date.now()/1000), text, attachment: attachment || undefined, attachments: attachments.length ? attachments : undefined })
          const p = (encOn && (attachment || attachments.length)) ? encPass : undefined
          if (encOn && (attachment || attachments.length) && !p) { alert('Enter a media passphrase'); return }
          try { await sendRoom(sk, selected, text, { a: attachment || undefined, as: attachments.length ? attachments : undefined, p }) } catch {}
          setText('')
          setAttachment(null)
          setAttachments([])
        }}>Send</button>
      </footer>
    </section>
  )
}
