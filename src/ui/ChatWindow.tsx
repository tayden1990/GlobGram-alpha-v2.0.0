import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useChatStore } from '../state/chatStore'
import { sendDM, sendTyping } from '../nostr/engine'
import { getObject, parseMemUrl } from '../services/upload'
import { blobToDataURL, dataURLSize, MAX_ATTACHMENT_BYTES, prepareBlobForSend } from '../nostr/utils'
import { useToast } from './Toast'
import { THUMB_SIZE, PRELOAD_ROOT_MARGIN } from './constants'
import { log } from './logger'
import { useI18n } from '../i18n'
import { CONFIG } from '../config'
import { CallPanel } from './CallPanel'
import { useIsMobile } from './useIsMobile'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { bytesToHex } from '../nostr/utils'

export function ChatWindow() {
  const { t } = useI18n()
  const isMobile = useIsMobile(900)
  const selectedPeer = useChatStore(s => s.selectedPeer)
  const conversations = useChatStore(s => s.conversations)
  const myPubkey = useChatStore(s => s.myPubkey)
  const setMyPubkey = useChatStore(s => s.setMyPubkey)
  const removeMessage = useChatStore(s => s.removeMessage)
  const updateMessage = useChatStore(s => s.updateMessage)
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
  const { show } = useToast()
  const [visibleCount, setVisibleCount] = useState<number>(50)
  const loadingMoreRef = useRef(false)
  const topSentinelRef = useRef<HTMLDivElement | null>(null)
  const [isPreloading, setIsPreloading] = useState(false)
  const [lightbox, setLightbox] = useState<null | { type: 'image'|'video'|'audio'|'file'; src: string; name?: string }>(null)
  // footer height (desktop) to avoid overlap; mobile handled via CSS padding-bottom
  const footerRef = useRef<HTMLElement | null>(null)
  const [footerH, setFooterH] = useState<number>(180)
  // preparing/progress state for media conversion (dataURL encode)
  const [preparing, setPreparing] = useState(false)
  const [prepProgress, setPrepProgress] = useState(0)
  const [sending, setSending] = useState(false)
  type SendProg = { stage: 'idle'|'uploading'|'publishing'|'done'; uploaded: number; total: number; fileProgress?: { current: number; total: number; fileIndex: number } }
  const [sendProg, setSendProg] = useState<SendProg>({ stage: 'idle', uploaded: 0, total: 0, fileProgress: undefined })
  // Format bytes for progress display
  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }
  // Download progress per message/attachment key: `${msgId}:a` for single, `${msgId}:as:${i}` for multi
  const [dlProgress, setDlProgress] = useState<Record<string, { received: number; total?: number }>>({})
  // User setting: auto-resolve media (default from env, persisted in localStorage)
  const [autoResolveMedia, setAutoResolveMedia] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('autoResolveMedia')
      if (stored != null) return stored === '1'
    } catch {}
    try {
      const envDefault = String((import.meta as any).env?.VITE_AUTO_RESOLVE_MEDIA || '')
      if (envDefault) return envDefault !== '0'
    } catch {}
    return CONFIG.AUTO_RESOLVE_MEDIA_DEFAULT
  })
  useEffect(() => {
    try { localStorage.setItem('autoResolveMedia', autoResolveMedia ? '1' : '0') } catch {}
  }, [autoResolveMedia])
  // Upload backend hint banner
  const hasBackend = (() => {
    try { return Boolean((import.meta as any).env?.VITE_UPLOAD_BASE_URL) } catch {}
    return Boolean(CONFIG.UPLOAD_BASE_URL)
  })()
  const uploadBannerMsg = (() => {
    try {
      const cfg = ((import.meta as any).env?.VITE_UPLOAD_BASE_URL as string | undefined) ?? CONFIG.UPLOAD_BASE_URL
      const isPageLocal = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname)
      const cfgIsLocal = !!cfg && /^https?:\/\/localhost(?::\d+)?/i.test(cfg)
  if (!hasBackend) return 'Uploads not configured. Large media won’t be visible to others. Configure an upload server.'
      if (!isPageLocal && cfgIsLocal) return 'Upload server points to localhost and won’t work from this host. Configure a public upload server.'
    } catch {}
    return null as string | null
  })()
  
  // Grid layout ensures footer has its own row and never overlaps the scroller
  
  // Warn once when no upload backend is configured (mem:// fallback is not cross-device)
  useEffect(() => {
    try {
      const hasBackend = Boolean(((import.meta as any).env?.VITE_UPLOAD_BASE_URL) || CONFIG.UPLOAD_BASE_URL)
      const warnedKey = 'warn_upload_backend_v1'
      const warned = localStorage.getItem(warnedKey)
      if (!hasBackend && !warned) {
  show(t('chat.mediaUnavailable') || 'Media may be unavailable to others. Configure upload backend.', 'info')
        localStorage.setItem(warnedKey, '1')
      }
    } catch {}
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // LiveKit call state for 1:1 DMs
  const [callOpen, setCallOpen] = useState(false)
  const [incomingCall, setIncomingCall] = useState<null | { from: string; room: string; evtId: string }>(null)
  const dmRoomName = useMemo(() => {
    if (!selectedPeer || !myPubkey) return null
    const a = myPubkey.toLowerCase()
    const b = selectedPeer.toLowerCase()
    const [x, y] = a < b ? [a, b] : [b, a]
    return `dm-${x.slice(0, 12)}-${y.slice(0, 12)}`
  }, [selectedPeer, myPubkey])

  // Listen for incoming call events from engine
  useEffect(() => {
    const handler = (e: any) => {
      try {
        const d = e?.detail
        if (!d || !selectedPeer) return
        // only show banner for current DM convo
        if (d.from?.toLowerCase() === selectedPeer.toLowerCase()) {
          if (!dmRoomName || d.room === dmRoomName) {
            setIncomingCall({ from: d.from, room: d.room, evtId: d.evtId })
          }
        }
      } catch {}
    }
    window.addEventListener('incoming-call', handler as any)
    return () => window.removeEventListener('incoming-call', handler as any)
  }, [selectedPeer, dmRoomName])

  // Auto-dismiss incoming call after 45s
  useEffect(() => {
    if (!incomingCall) return
    const to = setTimeout(() => setIncomingCall(null), 45000)
    return () => clearTimeout(to)
  }, [incomingCall])

  // Track footer height (desktop) and update spacer to prevent overlap
  useEffect(() => {
    if (!footerRef.current) return
    const el = footerRef.current
    const update = () => setFooterH(el.offsetHeight || 180)
    update()
    let ro: ResizeObserver | null = null
    try {
      ro = new ResizeObserver(() => update())
      ro.observe(el as Element)
    } catch {}
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      try { ro && ro.disconnect() } catch {}
    }
  }, [])

  // virtualized items (newest N)
  const items = useMemo(() => msgs.slice(-visibleCount), [msgs, visibleCount])
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => 240,
    overscan: 8,
    // Ensure dynamic heights (images, wraps) are re-measured automatically
    measureElement: (el: Element) => (el as HTMLElement).getBoundingClientRect().height,
    getItemKey: (index) => {
      const it = items[index] as any
      return it?.id ?? it?.ts ?? index
    }
  })

  function readableSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }
  // Render URLs inside plain text as clickable links
  function renderTextWithLinks(text: string) {
    const parts: Array<{ t: string; href?: string }> = []
    const urlRe = /(https?:\/\/[^\s]+)/ig
    let lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = urlRe.exec(text)) !== null) {
      if (m.index > lastIndex) parts.push({ t: text.slice(lastIndex, m.index) })
      const href = m[1]
      parts.push({ t: href, href })
      lastIndex = m.index + href.length
    }
    if (lastIndex < text.length) parts.push({ t: text.slice(lastIndex) })
    return (
      <>
        {parts.map((p, i) => p.href
          ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{p.t}</a>
          : <span key={i}>{p.t}</span>
        )}
      </>
    )
  }
  // helper to detect whether a value is an unresolved pointer (mem/http)
  function isPointer(u?: string | null) {
    if (!u) return false
    return (u.startsWith('mem://') || (u.startsWith('http://') || u.startsWith('https://')))
  }
  // Resolve a pointer to a data URL and patch message
  function dataUrlToName(durl: string) {
    try {
      const m = /^data:([^;]+);/.exec(durl)
      const mime = m?.[1] || 'application/octet-stream'
      const ext = guessExt(mime)
      return `download.${ext}`
    } catch { return 'download.bin' }
  }
  async function resolvePointerToDataURL(ptr: string, progressKey?: string, verbose?: boolean): Promise<{ durl: string; name: string } | null> {
    try {
      const key = parseMemUrl(ptr) ?? ptr
      const obj = await getObject(key, {
        verbose,
        onProgress: (received, total) => {
          if (!progressKey) return
          setDlProgress(prev => ({ ...prev, [progressKey]: { received, total } }))
        }
      })
      if (obj) {
        const d = `data:${obj.mime};base64,${obj.base64Data}`
        if (progressKey) setDlProgress(prev => { const n = { ...prev }; delete n[progressKey]; return n })
        return { durl: d, name: dataUrlToName(d) }
      }
    } catch {}
    if (progressKey) setDlProgress(prev => { const n = { ...prev }; delete n[progressKey]; return n })
    return null
  }
  function guessExt(mime: string) {
    const map: Record<string, string> = {
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
    return map[mime] || 'bin'
  }
  function filenameForDataUrl(durl: string) {
    const m = /^data:([^;]+);/.exec(durl)
    const mime = m?.[1] || 'application/octet-stream'
    const ext = guessExt(mime)
    return `download.${ext}`
  }
  // Infer extension from a URL (best-effort, ignores query/hash)
  function inferExtFromUrl(u: string) {
    try {
      const pure = u.split('?')[0].split('#')[0]
      const last = pure.split('/').pop() || ''
      const dot = last.lastIndexOf('.')
      if (dot > 0 && dot < last.length - 1) return last.slice(dot + 1).toLowerCase()
    } catch {}
    return ''
  }

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
  }, [msgs.length])

  // Auto-resolve pointer attachments for visible items (best-effort, background)
  useEffect(() => {
  if (!autoResolveMedia) return
    let cancelled = false
    const run = async () => {
      const maxConcurrent = 3
      const tasks: Array<() => Promise<void>> = []
      const seen = new Set<string>()
      for (const m of items) {
        if (!m) continue
        if (typeof m.attachment === 'string' && isPointer(m.attachment) && !seen.has(m.id+':a')) {
          seen.add(m.id+':a')
          const ptr = m.attachment
          tasks.push(async () => {
            const r = await resolvePointerToDataURL(ptr, m.id+':a', false)
            if (!cancelled && r && selectedPeer) updateMessage(selectedPeer, m.id, { attachment: r.durl, name: r.name })
          })
        }
        if (Array.isArray(m.attachments)) {
          m.attachments.forEach((a: string, i: number) => {
            if (typeof a === 'string' && isPointer(a) && !seen.has(m.id+':as:'+i)) {
              seen.add(m.id+':as:'+i)
              const ptr = a
              tasks.push(async () => {
                const r = await resolvePointerToDataURL(ptr, m.id+':as:'+i, false)
                if (!cancelled && r && selectedPeer) {
                  const conv = useChatStore.getState().conversations[selectedPeer] || []
                  const found = conv.find((x: any) => x.id === m.id)
                  const base = (found?.attachments || m.attachments || []) as string[]
                  const next = [...base]
                  next[i] = r.durl
                  const names = (found?.names || m.names || []) as string[]
                  const nextNames = [...names]
                  nextNames[i] = r.name
                  updateMessage(selectedPeer, m.id, { attachments: next, names: nextNames })
                }
              })
            }
          })
        }
      }
      // run with limited concurrency
      const queue = tasks.slice()
      const workers: Promise<void>[] = []
      for (let i=0; i<Math.min(maxConcurrent, queue.length); i++) {
        workers.push((async function worker(){
          while (queue.length && !cancelled) {
            const job = queue.shift()!
            try { await job() } catch {}
          }
        })())
      }
      await Promise.all(workers)
    }
    run()
    return () => { cancelled = true }
  }, [items, selectedPeer, updateMessage, autoResolveMedia])

  // if user is near bottom when new messages arrive, keep pinned to bottom
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    if (distanceFromBottom < 120) {
      scroller.scrollTop = scroller.scrollHeight
    }
  }, [msgs.length])

  // reset pagination when switching chats
  useEffect(() => { setVisibleCount(50) }, [selectedPeer])

  // IntersectionObserver: preload older when near top (with virtualizer-aware scroll preservation)
  useEffect(() => {
    const root = scrollerRef.current
    const el = topSentinelRef.current
    if (!root || !el) return
  const obs = new IntersectionObserver((entries) => {
      const [entry] = entries
      if (entry && entry.isIntersecting && msgs.length > visibleCount && !loadingMoreRef.current) {
        loadingMoreRef.current = true
        setIsPreloading(true)
        const prevTotal = root.scrollHeight
        const prevTop = root.scrollTop
        setVisibleCount(c => {
          const next = Math.min(c + 50, msgs.length)
          setTimeout(() => {
            rowVirtualizer.measure()
            const newTotal = root.scrollHeight
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
  }, [msgs.length, visibleCount])

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

  // cleanup on unmount (keep hook order stable before any early returns)
  useEffect(() => {
    return () => {
      try { cameraStreamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
      try { videoStreamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop()
      if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') videoRecorderRef.current.stop()
    }
  }, [])

  // Signal to the app shell that the chat panel is mounted and ready after a selection change
  useEffect(() => {
    if (!selectedPeer) return
    try {
      const ev = new CustomEvent('panel-ready', { detail: { type: 'chat', id: selectedPeer, at: Date.now() } })
      window.dispatchEvent(ev)
    } catch {}
  }, [selectedPeer])

  if (!selectedPeer) return <section style={{ flex: 1, padding: 16, height: '100%' }}>{t('chat.selectPrompt')}</section>

  return (
  <section role="main" aria-label="Direct messages" style={{ 
    flex: 1, 
    minHeight: 0, 
    display: 'grid', 
    gridTemplateRows: '1fr auto',
    overflow: 'hidden'
  }} onDragOver={(e) => { e.preventDefault(); }} onDrop={async (e) => {
      e.preventDefault()
  const f = e.dataTransfer?.files?.[0]
      if (!f) return
  if (f.size > MAX_ATTACHMENT_BYTES) { show(t('errors.fileTooLarge')!, 'error'); return }
  setPreparing(true); setPrepProgress(0)
  const url = await prepareBlobForSend(f, { onProgress: (p) => setPrepProgress(p) })
  if (dataURLSize(url) > MAX_ATTACHMENT_BYTES) { show(t('errors.encodedFileTooLarge')!, 'error'); return }
  setAttachment(url)
  setPreparing(false); setPrepProgress(1)
  try { log(`ChatWindow.drop.attach size=${dataURLSize(url)}`) } catch {}
    }}>
  <div ref={scrollerRef} className="scroll-y" style={{ 
    minHeight: 0, 
    height: '100%',
    overflowY: 'auto', 
    padding: 16, 
  paddingBottom: 12, 
    position: 'relative', 
    background: 'var(--bg)', 
    color: 'var(--fg)' 
  }}>
        <div ref={topSentinelRef} style={{ height: 1 }} />
  <div style={{ height: Math.max(rowVirtualizer.getTotalSize(), scrollerRef.current?.clientHeight || 600), width: '100%', position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((vr) => {
            const m = items[vr.index]
            return (
              <div
                key={vr.key}
                ref={rowVirtualizer.measureElement}
                data-index={vr.index}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vr.start}px)`, paddingBottom: 8, boxSizing: 'border-box' }}
              >
                <div style={{ display: 'flex', justifyContent: m.from === myPubkey ? 'flex-end' : 'flex-start' }}>
                  <div className="msg-grid" style={{ maxWidth: 520, display: 'grid', gridTemplateColumns: '1fr', gridAutoFlow: 'row', gridAutoRows: 'max-content', rowGap: 12, alignItems: 'start' }}>
                    {m.text && !m.system && (
                      <div style={{ background: 'var(--bubble)', color: 'var(--bubble-fg)', borderRadius: 12, padding: '8px 10px' }}>
                        {renderTextWithLinks(m.text)}
                      </div>
                    )}
                    {m.text && m.system && (
                      <div style={{ alignSelf: 'center', justifySelf: 'center', maxWidth: 420, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
                        {m.text}
                      </div>
                    )}
                    {/* Render single legacy attachment */}
                    {m.attachment?.startsWith('data:image/') && (
                      <div title={t('chat.openImage')!} onClick={() => setLightbox({ type: 'image', src: m.attachment! })} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: 'var(--border)', cursor: 'pointer', justifySelf: 'start' }}>
            <img src={m.attachment} alt="image" loading="lazy" decoding="async" onLoad={() => rowVirtualizer.measure()} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      </div>
                    )}
                    {isPointer(m.attachment) && (
                      <div style={{ width: THUMB_SIZE, justifySelf: 'start', display: 'grid', gap: 6 }}>
                        {/* Placeholder thumbnail with inferred extension */}
                        {(() => {
                          const ext = inferExtFromUrl(String(m.attachment))
                          return (
                            <div style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', userSelect: 'none' }}>
                              {(ext || 'file').toUpperCase()}
                            </div>
                          )
                        })()}
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('chat.resolvingMedia') || 'Resolving media…'}</div>
                        {(() => {
                          const prog = dlProgress[m.id+':a']
                          if (!prog) return null
                          const pct = prog.total ? Math.min(100, Math.round((prog.received / prog.total) * 100)) : undefined
                          return (
                            <div style={{ display: 'grid', gap: 4 }}>
                              <div style={{ width: THUMB_SIZE, height: 6, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                                <span style={{ display: 'block', height: '100%', width: `${pct ?? 100}%`, background: 'var(--accent)', transition: 'width 150ms linear' }} />
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                {pct != null ? `${pct}%` : `Downloading ${readableSize(prog.received)}...`}
                              </div>
                            </div>
                          )
                        })()}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {/* If hosted non-locally and pointer targets localhost, avoid futile loads */}
                          {(() => {
                            try {
                              const isPageLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname)
                              const u = String(m.attachment || '')
                              const isLocalPtr = typeof u === 'string' && /^https?:\/\/localhost(?::\d+)?/i.test(u)
                              if (!isPageLocal && isLocalPtr) {
                                return (
                                  <span style={{ fontSize: 12, color: 'var(--muted)' }} title={t('chat.mediaUnavailable') || 'Media unavailable'}>
                                    Unavailable on this host (localhost upload)
                                  </span>
                                )
                              }
                            } catch {}
                            return (
                              <button style={{ fontSize: 12 }} onClick={async () => {
                            const r = await resolvePointerToDataURL(m.attachment!, m.id+':a', true)
                            if (r) updateMessage(selectedPeer, m.id, { attachment: r.durl, name: r.name })
                            else show(t('chat.mediaUnavailable')!, 'error')
                          }} disabled={Boolean(dlProgress[m.id+':a'])}>{t('chat.load') || 'Load'}</button>
                            )
                          })()}
                          {typeof m.attachment === 'string' && m.attachment.startsWith('http') && (
                            <a href={m.attachment} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }} title={t('chat.openInNewTab') || 'Open in new tab'}>
                              {(() => { const ext = inferExtFromUrl(String(m.attachment)); return (t('chat.open') || 'Open') + (ext ? ` (.${ext})` : '') })()}
                            </a>
                          )}
                        </div>
                      </div>
                    )}
          {m.attachment?.startsWith('data:video/') && (
                      <div title={t('chat.playVideo')!} onClick={() => setLightbox({ type: 'video', src: m.attachment! })} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: '#000', position: 'relative', cursor: 'pointer', justifySelf: 'start' }}>
            <video src={m.attachment} muted preload="metadata" onLoadedMetadata={() => rowVirtualizer.measure()} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 28, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>▶</div>
                      </div>
                    )}
                    {/* spacer to ensure separation from media above */}
                    <div style={{ height: 2 }} />
          {m.attachment?.startsWith('data:audio/') && (
                      <div style={{ width: THUMB_SIZE, justifySelf: 'start' }}>
            <button title={t('chat.playAudio')!} onClick={() => setLightbox({ type: 'audio', src: m.attachment! })} className="msg-audio" style={{ width: '100%', padding: '6px 10px', borderRadius: 16, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--fg)', cursor: 'pointer' }}>{t('chat.audio')}</button>
                      </div>
                    )}
                    {m.attachment && m.attachment.startsWith('data:') && !m.attachment.startsWith('data:image/') && !m.attachment.startsWith('data:video/') && !m.attachment.startsWith('data:audio/') && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <a href={m.attachment!} download={m.name || filenameForDataUrl(m.attachment!)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)' }} onClick={() => { try { log(`ChatWindow.download.file size=${dataURLSize(m.attachment!)}B`) } catch {} }}>
                          {(t('chat.download') || 'Download')} {(m.name || filenameForDataUrl(m.attachment!))} ({readableSize(dataURLSize(m.attachment))})
                        </a>
                        <button style={{ fontSize: 12 }} onClick={async () => {
                          try { await navigator.clipboard.writeText(m.attachment!); show(t('chat.linkCopied')!, 'success'); try { log(`ChatWindow.copy.link size=${dataURLSize(m.attachment!)}B`) } catch {} } catch { show(t('chat.copyFailed')!, 'error'); try { log('ChatWindow.copy.link.error') } catch {} }
                        }}>{t('chat.copyLink')}</button>
                        <button style={{ fontSize: 12 }} onClick={async () => {
                          try {
                            const match = /^data:([^;]+);base64,(.*)$/.exec(m.attachment!)
                            if (!match) throw new Error('not data url')
                            const mime = match[1]
                            const b64 = match[2]
                            const bin = atob(b64)
                            const bytes = new Uint8Array(bin.length)
                            for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i)
                            const blob = new Blob([bytes], { type: mime })
                            if ((window as any).ClipboardItem) {
                              await navigator.clipboard.write([new (window as any).ClipboardItem({ [mime]: blob })])
                              show(t('chat.linkCopied')!, 'success')
                              try { log(`ChatWindow.copy.file mime=${mime} size=${blob.size}B`) } catch {}
                            } else {
                              show(t('chat.clipboardUnsupported')!, 'error')
                            }
                          } catch (e) {
                            show(t('chat.copyFailed')!, 'error')
                            try { log('ChatWindow.copy.file.error') } catch {}
                          }
                        }}>{t('chat.copyAsFile')}</button>
                      </div>
                    )}
                    {/* Render multi-attachments */}
                    {m.attachments?.map((a, i) => (
                      a.startsWith('data:image/') ? (
                        <div key={i} title={t('chat.openImage')!} onClick={() => setLightbox({ type: 'image', src: a })} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: 'var(--border)', cursor: 'pointer', justifySelf: 'start' }}>
                          <img src={a} alt="image" loading="lazy" decoding="async" onLoad={() => rowVirtualizer.measure()} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        </div>
                      ) : a.startsWith('data:video/') ? (
                        <div key={i} title={t('chat.playVideo')!} onClick={() => setLightbox({ type: 'video', src: a })} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: '#000', position: 'relative', cursor: 'pointer', justifySelf: 'start' }}>
                          <video src={a} muted preload="metadata" onLoadedMetadata={() => rowVirtualizer.measure()} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 28, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>▶</div>
                        </div>
                      ) : a.startsWith('data:audio/') ? (
                        <>
                          <div style={{ height: 2 }} />
                          <div style={{ width: THUMB_SIZE, justifySelf: 'start' }}>
                            <button key={i} title={t('chat.playAudio')!} onClick={() => setLightbox({ type: 'audio', src: a })} className="msg-audio" style={{ width: '100%', padding: '6px 10px', borderRadius: 16, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--fg)', cursor: 'pointer' }}>{t('chat.audio')}</button>
                          </div>
                        </>
                      ) : a.startsWith('data:') ? (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <a href={a} download={(m.names && m.names[i]) || filenameForDataUrl(a)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)' }} onClick={() => { try { log(`ChatWindow.download.file size=${dataURLSize(a)}B`) } catch {} }}>
                            {(t('chat.download') || 'Download')} {(m.names && m.names[i]) || filenameForDataUrl(a)} ({readableSize(dataURLSize(a))})
                          </a>
                          <button style={{ fontSize: 12 }} onClick={async () => {
                            try { await navigator.clipboard.writeText(a); show(t('chat.linkCopied')!, 'success'); try { log(`ChatWindow.copy.link size=${dataURLSize(a)}B`) } catch {} } catch { show(t('chat.copyFailed')!, 'error'); try { log('ChatWindow.copy.link.error') } catch {} }
                          }}>{t('chat.copyLink')}</button>
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
                                show(t('chat.linkCopied')!, 'success')
                                try { log(`ChatWindow.copy.file mime=${mime} size=${blob.size}B`) } catch {}
                              } else {
                                show(t('chat.clipboardUnsupported')!, 'error')
                              }
                            } catch (e) {
                              show(t('chat.copyFailed')!, 'error')
                              try { log('ChatWindow.copy.file.error') } catch {}
                            }
                          }}>{t('chat.copyAsFile')}</button>
                        </div>
                      ) : isPointer(a) ? (
                        <div key={i} style={{ width: THUMB_SIZE, justifySelf: 'start', display: 'grid', gap: 6 }}>
                          {/* Placeholder thumbnail with inferred extension */}
                          {(() => {
                            const ext = inferExtFromUrl(String(a))
                            return (
                              <div style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', userSelect: 'none' }}>
                                {(ext || 'file').toUpperCase()}
                              </div>
                            )
                          })()}
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('chat.resolvingMedia') || 'Resolving media…'}</div>
                          {(() => {
                            const prog = dlProgress[m.id+':as:'+i]
                            if (!prog) return null
                            const pct = prog.total ? Math.min(100, Math.round((prog.received / prog.total) * 100)) : undefined
                            return (
                              <div style={{ display: 'grid', gap: 4 }}>
                                <div style={{ width: THUMB_SIZE, height: 6, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                                  <span style={{ display: 'block', height: '100%', width: `${pct ?? 100}%`, background: 'var(--accent)', transition: 'width 150ms linear' }} />
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                  {pct != null ? `${pct}%` : `Downloading ${readableSize(prog.received)}...`}
                                </div>
                              </div>
                            )
                          })()}
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            {(() => {
                              try {
                                const isPageLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname)
                                const u = String(a || '')
                                const isLocalPtr = typeof u === 'string' && /^https?:\/\/localhost(?::\d+)?/i.test(u)
                                if (!isPageLocal && isLocalPtr) {
                                  return (
                                    <span style={{ fontSize: 12, color: 'var(--muted)' }} title={t('chat.mediaUnavailable') || 'Media unavailable'}>
                                      Unavailable on this host (localhost upload)
                                    </span>
                                  )
                                }
                              } catch {}
                              return (
                                <button style={{ fontSize: 12 }} onClick={async () => {
                              const r = await resolvePointerToDataURL(a, m.id+':as:'+i, true)
                              if (r) {
                                const next = [...(m.attachments || [])]
                                next[i] = r.durl
                                const names = [...(m.names || [])]
                                names[i] = r.name
                                updateMessage(selectedPeer, m.id, { attachments: next, names })
                              } else {
                                show(t('chat.mediaUnavailable')!, 'error')
                              }
                            }} disabled={Boolean(dlProgress[m.id+':as:'+i])}>{t('chat.load') || 'Load'}</button>
                              )
                            })()}
                            {typeof a === 'string' && a.startsWith('http') && (
                              <a href={a} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }} title={t('chat.openInNewTab') || 'Open in new tab'}>
                                {(() => { const ext = inferExtFromUrl(String(a)); return (t('chat.open') || 'Open') + (ext ? ` (.${ext})` : '') })()}
                              </a>
                            )}
                          </div>
                        </div>
                      ) : null
                    ))}
                    <div className="msg-meta" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(m.ts * 1000).toLocaleTimeString()}</div>
            {m.status && (
                        <span style={{ fontSize: 10, color: m.status==='failed'? '#d32f2f':'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {m.status === 'pending' && <span title={t('status.sending')!}>⏳</span>}
              {m.status === 'sent' && <span title={t('status.sent')!}>✓</span>}
              {m.status === 'delivered' && <span title={t('status.delivered')!}>✓✓</span>}
              {m.status === 'failed' && <span title={t('status.failed')!}>⚠</span>}
              <span>{m.status === 'pending' ? t('status.sending') : m.status === 'sent' ? t('status.sent') : m.status === 'delivered' ? t('status.delivered') : t('status.failed')}</span>
                          {m.status === 'failed' && m.error && (
                            <span style={{ color: '#d32f2f' }}>({m.error})</span>
                          )}
                        </span>
                      )}
                      {m.status === 'failed' && (
                        <button
                          style={{ fontSize: 10 }}
                          onClick={async () => {
                            const sk = localStorage.getItem('nostr_sk')
                            if (!sk) return
                            if (blocked[selectedPeer]) { show(t('errors.contactBlocked')!, 'error'); return }
                            const hasMedia = !!m.attachment || (m.attachments && m.attachments.length > 0)
                            const p = (encOn && hasMedia) ? encPass : undefined
                            if (encOn && hasMedia && !p) { show(t('errors.enterMediaPassphrase')!, 'error'); return }
                            // Replace the failed message with a fresh send
                            removeMessage(selectedPeer, m.id)
                            await sendDM(sk, selectedPeer, { t: m.text || undefined, a: m.attachment || undefined, as: (m.attachments && m.attachments.length ? m.attachments : undefined), p })
                          }}
                          title={m.error ? t('chat.retryWithReason', { reason: m.error }) : t('chat.retry')}
                        >{t('chat.retry')}</button>
                      )}
                      <button style={{ fontSize: 10 }} onClick={() => {
                        if (confirm(t('chat.deleteConfirm')!)) removeMessage(selectedPeer, m.id)
                      }}>{t('chat.delete')}</button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
    {/* Spacer to ensure last message (e.g., images) isn't hidden behind footer on desktop */}
    {!isMobile && <div aria-hidden style={{ height: footerH }} />}
  {isPreloading && <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', padding: 6 }}>{t('loading.more')}</div>}
      </div>
  <footer ref={footerRef as any} className="sticky-footer">
        <div style={{ width: '100%' }}>
          <textarea rows={5} placeholder={t('input.placeholder')!} value={text} onChange={async (e) => {
            setText(e.target.value)
            const sk = localStorage.getItem('nostr_sk')
            if (sk && e.target.value.trim()) {
              try { await sendTyping(sk, selectedPeer) } catch {}
            }
          }} onKeyDown={async (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              const sk = localStorage.getItem('nostr_sk')
              if (!sk) return
              if (blocked[selectedPeer]) { show(t('errors.contactBlocked')!, 'error'); return }
              const hasMedia = !!attachment || attachments.length > 0
              const p = (encOn && hasMedia) ? encPass : undefined
              if (encOn && hasMedia && !p) { show(t('errors.enterMediaPassphrase')!, 'error'); return }
              if (!text && !attachment && attachments.length === 0) return
              if (navigator.vibrate) try { navigator.vibrate(15) } catch {}
              await sendDM(sk, selectedPeer, { t: text || undefined, a: attachment || undefined, as: attachments.length ? attachments : undefined, p })
              setText('')
              setAttachment(null)
              setAttachments([])
            }
          }} style={{ width: '100%', resize: 'none', overflowY: 'auto', fontSize: 16, lineHeight: 1.35, background: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
          <input id="cw-file" type="file" multiple style={{ display: 'none' }} onChange={async (e) => {
            const files = Array.from(e.target.files || [])
            const urls: string[] = []
            for (const file of files) {
              if (file.size > MAX_ATTACHMENT_BYTES) { show(t('errors.fileTooLarge')!, 'error'); continue }
              setPreparing(true); setPrepProgress(0)
              const url = await prepareBlobForSend(file, { onProgress: (p) => setPrepProgress(p) })
              if (dataURLSize(url) > MAX_ATTACHMENT_BYTES) { show(t('errors.encodedFileTooLarge')!, 'error'); continue }
              urls.push(url)
            }
            if (urls.length === 1) { setAttachment(urls[0]); try { log('ChatWindow.attach.single') } catch {} }
            if (urls.length > 1) { setAttachments(urls); try { log(`ChatWindow.attach.multi n=${urls.length}`) } catch {} }
            setPreparing(false); setPrepProgress(1)
            // clear for same-file reselect
            try { (e.target as HTMLInputElement).value = '' } catch {}
          }} />
          <button title={t('chat.attachFiles')!} onClick={() => (document.getElementById('cw-file') as HTMLInputElement)?.click()} style={{ padding: '6px 10px' }}>📎</button>
          <button
            title={CONFIG.LIVEKIT_ENABLED ? (t('chat.startCall') || 'Start call') : 'Calls not configured'}
            onClick={async () => {
              if (!CONFIG.LIVEKIT_ENABLED) { show('Calls not configured', 'error'); return }
              if (!selectedPeer) { show('No peer selected', 'error'); return }
              let sk = localStorage.getItem('nostr_sk')
              if (!sk) {
                const secret = generateSecretKey()
                const hexd = bytesToHex(secret)
                const pub = getPublicKey(secret)
                try { localStorage.setItem('nostr_sk', hexd) } catch {}
                setMyPubkey(pub)
              }
              // Create deterministic 1:1 room id and ring peer via DM envelope
              const room = dmRoomName
              if (!room) { setCallOpen(true); return }
              setCallOpen(true)
              // Send a call_invite DM so the other side gets a ring banner
              const body = { type: 'call_invite', room }
              try {
                const mySk = localStorage.getItem('nostr_sk')
                if (mySk) await sendDM(mySk, selectedPeer, { t: JSON.stringify(body) })
              } catch {}
            }}
            style={{ padding: '6px 10px' }}
          >📞</button>
          {/* camera photo capture */}
          {!cameraOn ? (
            <button title={t('chat.takePhoto')!} onClick={async () => {
              if (!navigator.mediaDevices) { show(t('errors.cameraUnsupported')!, 'error'); return }
              try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
                cameraStreamRef.current = stream
                setCameraOn(true)
                setTimeout(() => {
                  if (cameraVideoRef.current) cameraVideoRef.current.srcObject = stream
                }, 0)
                try { log('ChatWindow.camera.start') } catch {}
              } catch (e: any) {
                show(t('errors.failedCamera')!, 'error')
                try { log(`ChatWindow.camera.error: ${e?.message||e}`) } catch {}
              }
            }}>📷</button>
          ) : (
            <>
              <video ref={cameraVideoRef} autoPlay muted style={{ width: 120, height: 72, background: '#000', borderRadius: 6 }} />
              <button title={t('chat.capture')!} onClick={async () => {
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
                  if (dataURLSize(url) > 2 * 1024 * 1024) { show(t('errors.fileTooLarge')!, 'error'); return }
                  setAttachment(url)
                  try { log('ChatWindow.camera.capture') } catch {}
                }
                stream.getTracks().forEach(t => t.stop())
                setCameraOn(false)
                cameraStreamRef.current = null
              }}>📸</button>
              <button title={t('chat.cancel')!} onClick={() => {
                const stream = cameraStreamRef.current
                if (stream) stream.getTracks().forEach(t => t.stop())
                setCameraOn(false)
                cameraStreamRef.current = null
                try { log('ChatWindow.camera.cancel') } catch {}
              }}>✖️</button>
            </>
          )}
          {/* voice recording */}
          {!recording ? (
            <button onClick={async () => {
              if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') { show(t('errors.recordingUnsupported')!, 'error'); return }
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
              const audioMime = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) ? 'audio/webm;codecs=opus' : undefined
              let mr: MediaRecorder
              try {
                mr = new MediaRecorder(stream, { mimeType: audioMime as any, audioBitsPerSecond: 64000 })
              } catch {
                mr = new MediaRecorder(stream)
              }
              mediaRecorderRef.current = mr
              chunksRef.current = []
              mr.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data) }
              mr.onstop = async () => {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
                if (blob.size > MAX_ATTACHMENT_BYTES) { setRecording(false); show(t('errors.voiceTooLarge')!, 'error'); return }
                setPreparing(true); setPrepProgress(0)
                const url = await prepareBlobForSend(blob, { onProgress: (p) => setPrepProgress(p) })
                if (dataURLSize(url) > MAX_ATTACHMENT_BYTES) { setRecording(false); show(t('errors.encodedAudioTooLarge')!, 'error'); return }
                setAttachment(url)
                setRecording(false)
                setPreparing(false); setPrepProgress(1)
                try { log('ChatWindow.audio.stop') } catch {}
              }
              mr.start()
              setRecording(true)
              try { log('ChatWindow.audio.start') } catch {}
            }}>🎙️</button>
          ) : (
            <button onClick={() => {
              const mr = mediaRecorderRef.current
              if (mr && mr.state !== 'inactive') mr.stop()
              if (mr) mr.stream.getTracks().forEach(t => t.stop())
              try { log('ChatWindow.audio.cancel') } catch {}
            }}>⏹️</button>
          )}
          {/* video recording */}
          {!videoRecording ? (
            <button title={t('chat.recordVideo')!} onClick={async () => {
              if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') { show(t('errors.recordingUnsupported')!, 'error'); return }
              try {
                const stream = await navigator.mediaDevices.getUserMedia({
                  video: { width: { ideal: 640, max: 1280 }, height: { ideal: 360, max: 720 }, frameRate: { ideal: 24, max: 30 } },
                  audio: true
                })
                videoStreamRef.current = stream
                const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm'
                let mr: MediaRecorder
                try {
                  mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 600_000, audioBitsPerSecond: 64_000 })
                } catch {
                  mr = new MediaRecorder(stream, { mimeType: mime })
                }
                videoRecorderRef.current = mr
                videoChunksRef.current = []
                mr.ondataavailable = (ev) => { if (ev.data.size) videoChunksRef.current.push(ev.data) }
                mr.onstop = async () => {
                  const blob = new Blob(videoChunksRef.current, { type: 'video/webm' })
                  if (blob.size > MAX_ATTACHMENT_BYTES) { setVideoRecording(false); stream.getTracks().forEach(t => t.stop()); show(t('errors.videoTooLarge')!, 'error'); return }
                  setPreparing(true); setPrepProgress(0)
                  const url = await prepareBlobForSend(blob, { onProgress: (p) => setPrepProgress(p) })
                  if (dataURLSize(url) > MAX_ATTACHMENT_BYTES) { setVideoRecording(false); stream.getTracks().forEach(t => t.stop()); show(t('errors.encodedVideoTooLarge')!, 'error'); return }
                  setAttachment(url)
                  setVideoRecording(false)
                  stream.getTracks().forEach(t => t.stop())
                  videoStreamRef.current = null
                  setPreparing(false); setPrepProgress(1)
                  try { log('ChatWindow.video.stop') } catch {}
                }
                mr.start()
                setVideoRecording(true)
                try { log('ChatWindow.video.start') } catch {}
              } catch {
                show(t('errors.failedCamera')!, 'error')
              }
            }}>🎥</button>
          ) : (
            <button title={t('chat.stopVideo')!} onClick={() => {
              const mr = videoRecorderRef.current
              if (mr && mr.state !== 'inactive') mr.stop()
              const stream = videoStreamRef.current
              if (stream) stream.getTracks().forEach(t => t.stop())
              try { log('ChatWindow.video.cancel') } catch {}
            }}>⏹️</button>
          )}
          {preparing && (
            <span style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 120, height: 6, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', display: 'inline-block' }}>
                <span style={{ display: 'block', height: '100%', width: `${Math.round(prepProgress*100)}%`, background: 'var(--accent)' }} />
              </span>
              {t('chat.preparing', { pct: Math.round(prepProgress*100) })}
            </span>
          )}
          {attachment && !preparing && <span style={{ fontSize: 12 }}>{t('chat.attachmentReady')}</span>}
          {attachments.length > 0 && <span style={{ fontSize: 12 }}>{t('chat.filesReady', { n: attachments.length })}</span>}
          {/* Auto-load media toggle */}
          <label title={t('chat.autoLoadMediaHint') || 'Automatically load media previews when visible'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={autoResolveMedia} onChange={(e) => setAutoResolveMedia(e.target.checked)} />
            {t('chat.autoLoadMedia') || 'Auto-load media'}
          </label>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {sending && (
              <span style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 120, height: 6, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', display: 'inline-block' }}>
                  <span
                    style={{
                      display: 'block',
                      height: '100%',
                      width: sendProg.stage === 'uploading' && sendProg.fileProgress && sendProg.fileProgress.total > 0
                        ? `${Math.round((sendProg.fileProgress.current / sendProg.fileProgress.total) * 100)}%`
                        : (sendProg.total ? `${Math.round((sendProg.uploaded/sendProg.total)*100)}` : '100') + '%',
                      background: 'var(--accent)',
                      transition: 'width 150ms linear'
                    }}
                  />
                </span>
                {sendProg.stage === 'uploading' && sendProg.fileProgress && sendProg.fileProgress.total > 0
                  ? `${t('chat.uploading') || 'Uploading'} ${sendProg.uploaded + 1}/${sendProg.total} (${Math.round((sendProg.fileProgress.current/sendProg.fileProgress.total)*100)}% - ${formatBytes(sendProg.fileProgress.current)} / ${formatBytes(sendProg.fileProgress.total)})`
                  : sendProg.stage === 'uploading'
                    ? `${t('chat.uploading') || 'Uploading'} ${sendProg.uploaded}/${sendProg.total}`
                    : (sendProg.stage === 'publishing' ? (t('chat.publishing') || 'Publishing…') : (t('chat.sending') || 'Sending…'))}
              </span>
            )}
            <button style={{ minWidth: 88 }} onClick={async () => {
              if (navigator.vibrate) try { navigator.vibrate(15) } catch {}
              const sk = localStorage.getItem('nostr_sk')
              if (!sk) return
              if (blocked[selectedPeer]) { show(t('errors.contactBlocked')!, 'error'); return }
              const p = (encOn && (attachment || attachments.length)) ? encPass : undefined
              if (encOn && (attachment || attachments.length) && !p) { show(t('errors.enterMediaPassphrase')!, 'error'); return }
              // Prevent sending large media without a configured upload backend to avoid mem:// pointers
              try {
                const hasBackend = Boolean(((import.meta as any).env?.VITE_UPLOAD_BASE_URL) || CONFIG.UPLOAD_BASE_URL)
                if (!hasBackend) {
                  const inlineLimit = 128 * 1024
                  const sizes: number[] = []
                  if (attachment?.startsWith('data:')) sizes.push(dataURLSize(attachment))
                  for (const a of attachments) if (a.startsWith('data:')) sizes.push(dataURLSize(a))
                  const anyTooLarge = sizes.some(s => s > inlineLimit)
                  if (anyTooLarge) {
                    show('Cannot send large media without an upload server. Configure an upload server or send a smaller file.', 'error')
                    return
                  }
                }
              } catch {}
              setSending(true)
              setSendProg({ stage: 'uploading', uploaded: 0, total: 0, fileProgress: undefined })
              await sendDM(sk, selectedPeer, { t: text || undefined, a: attachment || undefined, as: attachments.length ? attachments : undefined, p }, {
                onProgress: ({ stage, uploaded, totalUploads, fileProgress }) => {
                  setSendProg({ stage, uploaded: uploaded ?? 0, total: totalUploads ?? 0, fileProgress })
                }
              })
// Format bytes for progress display
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
              setText('')
              setAttachment(null)
              setAttachments([])
              setSending(false)
              setSendProg({ stage: 'idle', uploaded: 0, total: 0, fileProgress: undefined })
            }} disabled={preparing || sending || (!text && !attachment && attachments.length===0)}>{t('common.send')}</button>
          </div>
        </div>
      </footer>
      {CONFIG.LIVEKIT_ENABLED && callOpen && dmRoomName && (
        <CallPanel
          open={callOpen}
          roomName={dmRoomName}
          identity={myPubkey || (localStorage.getItem('anon_id') || (() => { const v = 'guest-' + Math.random().toString(36).slice(2, 8); try { localStorage.setItem('anon_id', v) } catch {} return v })())}
          onClose={() => setCallOpen(false)}
      onEnded={async (info) => {
            try {
              const peer = selectedPeer
              if (!peer) return
              const sk = localStorage.getItem('nostr_sk')
        if (!sk || !info.hadConnected || info.iAmLeader === false) return
              // Compose a concise, localized-ish summary
              const start = info.startedAt ? new Date(info.startedAt) : null
              const end = info.endedAt ? new Date(info.endedAt) : new Date()
              const durMs = info.durationMs ?? (start ? (end.getTime() - start.getTime()) : undefined)
              const durSec = durMs != null ? Math.round(durMs / 1000) : undefined
              const durFmt = durSec != null ? (
                durSec >= 3600 ? `${Math.floor(durSec/3600)}h ${Math.floor((durSec%3600)/60)}m ${durSec%60}s` : durSec >= 60 ? `${Math.floor(durSec/60)}m ${durSec%60}s` : `${durSec}s`
              ) : 'unknown'
              const me = myPubkey || 'me'
              const who = `${me.slice(0, 8)}… → ${peer.slice(0, 8)}…`
              const startedS = start ? start.toLocaleString() : 'n/a'
              const endedS = end.toLocaleString()
              const reason = info.reason ? ` (${info.reason})` : ''
              const body = `📞 Call summary${reason}\nWho: ${who}\nRoom: ${info.room}\nStarted: ${startedS}\nEnded: ${endedS}\nDuration: ${durFmt}`
              await sendDM(sk, peer, { t: body })
            } catch (e) {
              try { log(`Call summary DM failed: ${String(e)}`) } catch {}
            }
          }}
        />
      )}
      {/* Incoming call banner */}
      {incomingCall && (
        <div role="dialog" aria-live="assertive" style={{ position:'fixed', left: 16, bottom: 88, zIndex: 2000, background: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span>📞 {t('call.incoming') || 'Incoming call'}</span>
            <span style={{ fontSize:12, color:'var(--muted)' }}>{incomingCall.from.slice(0,8)}…</span>
            <div style={{ marginLeft:'auto', display:'inline-flex', gap:8 }}>
              <button onClick={async () => { 
                const sk = localStorage.getItem('nostr_sk')
                const peer = incomingCall.from
                setIncomingCall(null); setCallOpen(true)
                try { if (sk) await sendDM(sk, peer, { t: JSON.stringify({ type:'call_accept', room: dmRoomName }) }) } catch {}
              }}>{t('call.accept') || 'Accept'}</button>
              <button onClick={async () => {
                const sk = localStorage.getItem('nostr_sk')
                const peer = incomingCall.from
                setIncomingCall(null)
                try { if (sk) await sendDM(sk, peer, { t: JSON.stringify({ type:'call_reject', room: dmRoomName }) }) } catch {}
              }}>{t('call.reject') || 'Reject'}</button>
            </div>
          </div>
        </div>
      )}
      {/* Upload configuration banner */}
      {uploadBannerMsg && (
        <div role="status" aria-live="polite" style={{ position: 'sticky', bottom: 0, padding: '6px 10px', fontSize: 12, color: 'var(--muted)', background: 'var(--bg)', borderTop: '1px dashed var(--border)' }}>
          {uploadBannerMsg}
        </div>
      )}
      {/* virtualized list with intersection preloading */}
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
