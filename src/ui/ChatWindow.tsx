import { useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore } from '../state/chatStore'
import { sendDM, sendTyping } from '../nostr/engine'
import { blobToDataURL, dataURLSize } from '../nostr/utils'

export function ChatWindow() {
  const selectedPeer = useChatStore(s => s.selectedPeer)
  const conversations = useChatStore(s => s.conversations)
  const myPubkey = useChatStore(s => s.myPubkey)
  const removeMessage = useChatStore(s => s.removeMessage)
  const clearConversation = useChatStore(s => s.clearConversation)
  const blocked = useChatStore(s => s.blocked)
  const setBlocked = useChatStore(s => s.setBlocked)

  const msgs = useMemo(() => (selectedPeer ? conversations[selectedPeer] ?? [] : []), [conversations, selectedPeer])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<string[]>([])
  const [recording, setRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  // camera photo capture
  const [cameraOn, setCameraOn] = useState(false)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  // video recording
  const [videoRecording, setVideoRecording] = useState(false)
  const videoRecorderRef = useRef<MediaRecorder | null>(null)
  const videoChunksRef = useRef<Blob[]>([])
  const videoStreamRef = useRef<MediaStream | null>(null)
  // media encryption
  const [encOn, setEncOn] = useState(false)
  const [encPass, setEncPass] = useState('')

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
  }, [msgs.length])

  // mark read when viewing
  useEffect(() => {
    if (!selectedPeer) return
    const unsub = useChatStore.subscribe((s) => {
      if (s.selectedPeer === selectedPeer) {
        const msgs = s.conversations[selectedPeer] || []
        const ts = msgs.length ? msgs[msgs.length - 1].ts : 0
        const lr = { ...s.lastRead }
        if (lr[selectedPeer] !== ts) {
          // imperatively mark read via action to persist
          useChatStore.getState().markRead(selectedPeer)
        }
      }
    }) as unknown as () => void
    return () => { try { unsub() } catch {} }
  }, [selectedPeer])

  if (!selectedPeer) return <section style={{ flex: 1, padding: 16 }}>Select a chat</section>

  // cleanup on unmount
  useEffect(() => {
    return () => {
      try { cameraStreamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
      try { videoStreamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop()
      if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') videoRecorderRef.current.stop()
    }
  }, [])

  return (
    <section style={{ flex: 1, display: 'flex', flexDirection: 'column' }} onDragOver={(e) => { e.preventDefault(); }} onDrop={async (e) => {
      e.preventDefault()
      const f = e.dataTransfer?.files?.[0]
      if (!f) return
      if (f.type.startsWith('image/') && f.size <= 2 * 1024 * 1024) {
        const url = await blobToDataURL(f)
        if (dataURLSize(url) <= 2 * 1024 * 1024) setAttachment(url)
      } else if (f.type.startsWith('video/') && f.size <= 2 * 1024 * 1024) {
        const url = await blobToDataURL(f)
        if (dataURLSize(url) <= 2 * 1024 * 1024) setAttachment(url)
      }
    }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontFamily: 'monospace' }}>Chat with {selectedPeer.slice(0, 12)}…</div>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={!!blocked[selectedPeer]} onChange={(e) => setBlocked(selectedPeer, e.target.checked)} /> Block
        </label>
        <button onClick={() => { if (confirm('Clear entire conversation?')) clearConversation(selectedPeer) }}>Clear</button>
        <label title="Encrypt media attachments with a passphrase" style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={encOn} onChange={(e) => setEncOn(e.target.checked)} /> Encrypt media
        </label>
        {encOn && (
          <input type="password" placeholder="media passphrase" value={encPass} onChange={e => setEncPass(e.target.value)} style={{ width: 160 }} />
        )}
      </header>
  <div ref={scrollerRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'grid', gap: 8 }}>
        {msgs.map(m => (
          <div key={m.id} style={{ justifySelf: m.from === myPubkey ? 'end' : 'start', maxWidth: 520 }}>
            {m.text && (
              <div style={{ background: '#f2f2f2', borderRadius: 12, padding: '8px 10px' }}>{m.text}</div>
            )}
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
              {m.status && <span style={{ fontSize: 10, color: m.status==='failed'? '#d32f2f':'#777' }}>{m.status}</span>}
              <button style={{ fontSize: 10 }} onClick={() => {
                if (confirm('Delete this message locally?')) removeMessage(selectedPeer, m.id)
              }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      <footer style={{ borderTop: '1px solid #eee', padding: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input placeholder="type a message" value={text} onChange={async (e) => {
          setText(e.target.value)
          const sk = localStorage.getItem('nostr_sk')
          if (sk && e.target.value.trim()) {
            try { await sendTyping(sk, selectedPeer) } catch {}
          }
        }} style={{ flex: 1 }} />
        <input type="file" accept="image/*,video/*,audio/*" multiple onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
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
        {/* camera photo capture */}
        {!cameraOn ? (
          <button title="Take photo" onClick={async () => {
            if (!navigator.mediaDevices) return alert('Camera unsupported')
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
              cameraStreamRef.current = stream
              setCameraOn(true)
              setTimeout(() => {
                if (cameraVideoRef.current) cameraVideoRef.current.srcObject = stream
              }, 0)
            } catch {
              alert('Failed to access camera')
            }
          }}>📷</button>
        ) : (
          <>
            <video ref={cameraVideoRef} autoPlay muted style={{ width: 120, height: 72, background: '#000', borderRadius: 6 }} />
            <button title="Capture" onClick={async () => {
              const video = cameraVideoRef.current
              const stream = cameraStreamRef.current
              if (!video || !stream) return
              const w = video.videoWidth || 640
              const h = video.videoHeight || 360
              const canvas = document.createElement('canvas')
              canvas.width = w
              canvas.height = h
              const ctx = canvas.getContext('2d')
              if (ctx) {
                ctx.drawImage(video, 0, 0, w, h)
                const url = canvas.toDataURL('image/jpeg', 0.9)
                if (dataURLSize(url) > 2 * 1024 * 1024) { alert('Photo too large'); return }
                setAttachment(url)
              }
              stream.getTracks().forEach(t => t.stop())
              setCameraOn(false)
              cameraStreamRef.current = null
            }}>📸</button>
            <button title="Cancel" onClick={() => {
              const stream = cameraStreamRef.current
              if (stream) stream.getTracks().forEach(t => t.stop())
              setCameraOn(false)
              cameraStreamRef.current = null
            }}>✖️</button>
          </>
        )}
        {!recording ? (
          <button onClick={async () => {
            if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') return alert('Recording unsupported')
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const mr = new MediaRecorder(stream)
            mediaRecorderRef.current = mr
            chunksRef.current = []
            mr.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data) }
            mr.onstop = async () => {
              const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
              if (blob.size > 1024 * 1024) { setRecording(false); return alert('Voice note too large (>1MB)') }
              const url = await blobToDataURL(blob)
              if (dataURLSize(url) > 1024 * 1024) { setRecording(false); return alert('Encoded audio too large') }
              setAttachment(url)
              setRecording(false)
            }
            mr.start()
            setRecording(true)
          }}>🎙️</button>
        ) : (
          <button onClick={() => {
            const mr = mediaRecorderRef.current
            if (mr && mr.state !== 'inactive') mr.stop()
            if (mr) mr.stream.getTracks().forEach(t => t.stop())
          }}>⏹️</button>
        )}
        {/* video recording */}
        {!videoRecording ? (
          <button title="Record video" onClick={async () => {
            if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') return alert('Recording unsupported')
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
              videoStreamRef.current = stream
              const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm'
              const mr = new MediaRecorder(stream, { mimeType: mime })
              videoRecorderRef.current = mr
              videoChunksRef.current = []
              mr.ondataavailable = (ev) => { if (ev.data.size) videoChunksRef.current.push(ev.data) }
              mr.onstop = async () => {
                const blob = new Blob(videoChunksRef.current, { type: 'video/webm' })
                if (blob.size > 2 * 1024 * 1024) { setVideoRecording(false); stream.getTracks().forEach(t => t.stop()); return alert('Video too large (>2MB)') }
                const url = await blobToDataURL(blob)
                if (dataURLSize(url) > 2 * 1024 * 1024) { setVideoRecording(false); stream.getTracks().forEach(t => t.stop()); return alert('Encoded video too large') }
                setAttachment(url)
                setVideoRecording(false)
                stream.getTracks().forEach(t => t.stop())
                videoStreamRef.current = null
              }
              mr.start()
              setVideoRecording(true)
            } catch {
              alert('Failed to access camera')
            }
          }}>🎥</button>
        ) : (
          <button title="Stop video" onClick={() => {
            const mr = videoRecorderRef.current
            if (mr && mr.state !== 'inactive') mr.stop()
            const stream = videoStreamRef.current
            if (stream) stream.getTracks().forEach(t => t.stop())
          }}>⏹️</button>
        )}
        {attachment && <span style={{ fontSize: 12 }}>attachment ready</span>}
        {attachments.length > 0 && <span style={{ fontSize: 12 }}>{attachments.length} files ready</span>}
        <button onClick={async () => {
          const sk = localStorage.getItem('nostr_sk')
          if (!sk) return
          if (blocked[selectedPeer]) { alert('This contact is blocked'); return }
          const p = (encOn && (attachment || attachments.length)) ? encPass : undefined
          if (encOn && (attachment || attachments.length) && !p) { alert('Enter a media passphrase'); return }
          await sendDM(sk, selectedPeer, { t: text || undefined, a: attachment || undefined, as: attachments.length ? attachments : undefined, p })
          setText('')
          setAttachment(null)
          setAttachments([])
        }} disabled={!text && !attachment}>Send</button>
      </footer>
    </section>
  )
}
