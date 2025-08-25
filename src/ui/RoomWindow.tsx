import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRoomStore } from '../state/roomStore'
import { useChatStore } from '../state/chatStore'
import { sendRoom } from '../nostr/engine'
import { blobToDataURL, dataURLSize, MAX_ATTACHMENT_BYTES, prepareBlobForSend } from '../nostr/utils'
import { useToast } from './Toast'
import { THUMB_SIZE, PRELOAD_ROOT_MARGIN } from './constants'
import { useIsMobile } from './useIsMobile'
import { useI18n } from '../i18n'
import { CONFIG } from '../config'
import { CallPanel } from './CallPanel'

export function RoomWindow() {
	const { t } = useI18n()
	const isMobile = useIsMobile(900)
	const roomId = useRoomStore(s => s.selectedRoom)
	const roomMessages = useRoomStore(s => s.messages)
	const myPubkey = useChatStore(s => s.myPubkey)

	const msgs = useMemo(() => (roomId ? (roomMessages[roomId] ?? []) : []), [roomMessages, roomId])
	const scrollerRef = useRef<HTMLDivElement>(null)
	const [text, setText] = useState('')
	const [attachment, setAttachment] = useState<string | null>(null)
	const [attachments, setAttachments] = useState<string[]>([])
	// voice recording
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
	const { show } = useToast()
	// call UI
	const [callOpen, setCallOpen] = useState(false)
		// media encryption
		const [encOn, setEncOn] = useState(false)
		const [encPass, setEncPass] = useState('')
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
	const [visibleCount, setVisibleCount] = useState<number>(50)
	const loadingMoreRef = useRef(false)
	const topSentinelRef = useRef<HTMLDivElement | null>(null)
	const [isPreloading, setIsPreloading] = useState(false)
	const [lightbox, setLightbox] = useState<null | { type: 'image'|'video'|'audio'|'file'; src: string; name?: string }>(null)
	// footer height (desktop) to avoid overlap; mobile handled via CSS padding-bottom
	const footerRef = useRef<HTMLElement | null>(null)
	const [footerH, setFooterH] = useState<number>(180)
	// preparing/progress state
	const [preparing, setPreparing] = useState(false)
	const [prepProgress, setPrepProgress] = useState(0)
	type SendProg = { stage: 'idle'|'uploading'|'publishing'|'done'; uploaded: number; total: number; fileProgress?: { current: number; total: number; fileIndex: number } }
	const [sending, setSending] = useState(false)
	const [sendProg, setSendProg] = useState<SendProg>({ stage: 'idle', uploaded: 0, total: 0, fileProgress: undefined })

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
		return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
	}

	// Grid layout ensures footer has its own row and never overlaps the scroller
	

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])

	// Track footer height and update spacer to prevent overlap on desktop
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
			const it: any = items[index]
			return it?.id ?? it?.ts ?? index
		}
	})

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

	useEffect(() => {
		if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
	}, [msgs.length])

	// if user is near bottom when new messages arrive, keep pinned to bottom
	useEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller) return
		const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
		if (distanceFromBottom < 120) {
			scroller.scrollTop = scroller.scrollHeight
		}
	}, [msgs.length])

	// reset pagination when switching rooms
	useEffect(() => { setVisibleCount(50) }, [roomId])

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

	// cleanup on unmount (must be before any early return to keep hooks order stable)
	useEffect(() => {
		return () => {
			try { cameraStreamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
			try { videoStreamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
			if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop()
			if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') videoRecorderRef.current.stop()
		}
	}, [])

	// Signal to the app shell that the room panel is mounted and ready after a selection change
	useEffect(() => {
		if (!roomId) return
		try {
			const ev = new CustomEvent('panel-ready', { detail: { type: 'room', id: roomId, at: Date.now() } })
			window.dispatchEvent(ev)
		} catch {}
	}, [roomId])

	if (!roomId) return <section style={{ flex: 1, padding: 16, height: '100%' }}>{t('tabs.rooms')}</section>

	return (
		<section role="main" aria-label="Room messages" style={{ 
			flex: 1, 
			minHeight: 0, 
			display: 'grid', 
			gridTemplateRows: '1fr auto',
			overflow: 'hidden'
		}}
			onDragOver={(e) => { e.preventDefault() }}
			onDrop={async (e) => {
				e.preventDefault()
				const f = e.dataTransfer?.files?.[0]
				if (!f) return
				if (f.size > MAX_ATTACHMENT_BYTES) { show(t('errors.fileTooLarge')!, 'error'); return }
				setPreparing(true); setPrepProgress(0)
				const url = await prepareBlobForSend(f, { onProgress: (p) => setPrepProgress(p) })
				if (dataURLSize(url) > MAX_ATTACHMENT_BYTES) { show(t('errors.encodedFileTooLarge')!, 'error'); return }
				setAttachment(url)
				setPreparing(false); setPrepProgress(1)
			}}
		>
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
								style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vr.start}px)`, paddingBottom: 8, boxSizing: 'border-box' }}
							>
								<div style={{ display: 'flex', justifyContent: m.from === myPubkey ? 'flex-end' : 'flex-start' }}>
									<div className="msg-grid" style={{ maxWidth: 520, display: 'grid', gridTemplateColumns: '1fr', gridAutoFlow: 'row', gridAutoRows: 'max-content', rowGap: 12, alignItems: 'start' }}>
										{m.text && (
											<div style={{ background: 'var(--bubble)', color: 'var(--bubble-fg)', borderRadius: 12, padding: '8px 10px' }}>{m.text}</div>
										)}
										   {/* Render image attachments (data:*, http(s)://, mem://) */}
										   {m.attachment && (/^(data:|https?:\/\/|mem:\/\/)/.test(m.attachment)) && (() => {
											   if (/^data:image\//.test(m.attachment) || /\.(jpg|jpeg|png|gif|webp|svg|heic|heif|avif)$/i.test(m.attachment)) {
												   return (
													   <div title={t('chat.openImage')!} onClick={() => setLightbox({ type: 'image', src: m.attachment! })} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: 'var(--border)', cursor: 'pointer', justifySelf: 'start' }}>
														   <img src={m.attachment} alt="image" loading="lazy" decoding="async" onLoad={() => rowVirtualizer.measure()} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
													   </div>
												   )
											   }
											   if (/^data:video\//.test(m.attachment) || /\.(mp4|webm|mov|3gp)$/i.test(m.attachment)) {
												   return (
													   <div title={t('chat.playVideo')!} onClick={() => setLightbox({ type: 'video', src: m.attachment! })} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: '#000', position: 'relative', cursor: 'pointer', justifySelf: 'start' }}>
														   <video src={m.attachment} muted preload="metadata" onLoadedMetadata={() => rowVirtualizer.measure()} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
														   <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 28, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>▶</div>
													   </div>
												   )
											   }
											   if (/^data:audio\//.test(m.attachment) || /\.(mp3|ogg|wav|aac|flac|webm)$/i.test(m.attachment)) {
												   return (
													   <div style={{ width: THUMB_SIZE, justifySelf: 'start' }}>
														   <button title={t('chat.playAudio')!} onClick={() => setLightbox({ type: 'audio', src: m.attachment! })} className="msg-audio" style={{ width: '100%', padding: '6px 10px', borderRadius: 16, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--fg)', cursor: 'pointer' }}>{t('chat.audio')}</button>
													   </div>
												   )
											   }
											   // Generic file download for other types
											   return (
												   <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
													   <a href={m.attachment} download style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)' }}>
														   {t('chat.downloadFile')}
													   </a>
												   </div>
											   )
										   })()}
										   {m.attachments?.map((a: string, i: number) => {
											   if (/^data:image\//.test(a) || /^(https?:\/\/|mem:\/\/).+\.(jpg|jpeg|png|gif|webp|svg|heic|heif|avif)$/i.test(a)) {
												   return (
													   <div key={i} title={t('chat.openImage')!} onClick={() => setLightbox({ type: 'image', src: a })} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: 'var(--border)', cursor: 'pointer', justifySelf: 'start' }}>
														   <img src={a} alt="image" loading="lazy" decoding="async" onLoad={() => rowVirtualizer.measure()} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
													   </div>
												   )
											   }
											   if (/^data:video\//.test(a) || /^(https?:\/\/|mem:\/\/).+\.(mp4|webm|mov|3gp)$/i.test(a)) {
												   return (
													   <div key={i} title={t('chat.playVideo')!} onClick={() => setLightbox({ type: 'video', src: a })} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: '#000', position: 'relative', cursor: 'pointer', justifySelf: 'start' }}>
														   <video src={a} muted preload="metadata" onLoadedMetadata={() => rowVirtualizer.measure()} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
														   <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 28, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>▶</div>
													   </div>
												   )
											   }
											   if (/^data:audio\//.test(a) || /^(https?:\/\/|mem:\/\/).+\.(mp3|ogg|wav|aac|flac|webm)$/i.test(a)) {
												   return (
													   <div key={i} style={{ width: THUMB_SIZE, justifySelf: 'start' }}>
														   <button title={t('chat.playAudio')!} onClick={() => setLightbox({ type: 'audio', src: a })} className="msg-audio" style={{ width: '100%', padding: '6px 10px', borderRadius: 16, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--fg)', cursor: 'pointer' }}>{t('chat.audio')}</button>
													   </div>
												   )
											   }
											   if (/^(data:|https?:\/\/|mem:\/\/)/.test(a)) {
												   return (
													   <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
														   <a href={a} download style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)' }}>
															   {t('chat.downloadFile')}
														   </a>
													   </div>
												   )
											   }
											   return null
										   })}
										<div className="msg-meta" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
											<div style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(m.ts * 1000).toLocaleTimeString()}</div>
										</div>
									</div>
								</div>
							</div>
						)
					})}
				</div>
				{/* Spacer to ensure last message isn't hidden behind footer on desktop */}
				{!isMobile && <div aria-hidden style={{ height: footerH }} />}
				{isPreloading && <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', padding: 6 }}>{t('loading.more')}</div>}
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

			{/* LiveKit Call Panel overlay */}
			{CONFIG.LIVEKIT_ENABLED && (
				<CallPanel
					open={callOpen}
					roomName={roomId}
					identity={myPubkey || (localStorage.getItem('anon_id') || (() => { const v = 'guest-' + Math.random().toString(36).slice(2, 8); try { localStorage.setItem('anon_id', v) } catch {} return v })())}
					onClose={() => setCallOpen(false)}
		    onEnded={async (info) => {
						try {
							const sk = localStorage.getItem('nostr_sk')
			    if (!sk || !roomId || !info.hadConnected || info.iAmLeader === false) return
							const start = info.startedAt ? new Date(info.startedAt) : null
							const end = info.endedAt ? new Date(info.endedAt) : new Date()
							const durMs = info.durationMs ?? (start ? (end.getTime() - start.getTime()) : undefined)
							const durSec = durMs != null ? Math.round(durMs / 1000) : undefined
							const durFmt = durSec != null ? (
								durSec >= 3600 ? `${Math.floor(durSec/3600)}h ${Math.floor((durSec%3600)/60)}m ${durSec%60}s` : durSec >= 60 ? `${Math.floor(durSec/60)}m ${durSec%60}s` : `${durSec}s`
							) : 'unknown'
							const starter = (myPubkey || 'me').slice(0, 8) + '…'
							const plist = (info.participants || []).map(p => (String(p).slice(0,8) + '…')).join(', ')
							const reason = info.reason ? ` (${info.reason})` : ''
							const body = `📞 Call summary${reason}\nStarter: ${starter}\nRoom: ${info.room}\nParticipants: ${plist || 'n/a'}\nStarted: ${start ? start.toLocaleString() : 'n/a'}\nEnded: ${end.toLocaleString()}\nDuration: ${durFmt}`
							await sendRoom(sk, roomId, body)
						} catch {}
					}}
				/>
			)}

			<footer ref={footerRef as any} className="sticky-footer">
				<div style={{ width: '100%' }}>
				<textarea rows={5} placeholder={t('input.placeholder')!} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={async (e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault()
						const sk = localStorage.getItem('nostr_sk')
						if (!sk || !roomId) return
						const hasMedia = !!attachment || attachments.length > 0
						const p = (encOn && hasMedia) ? encPass : undefined
						if (encOn && hasMedia && !p) { show(t('errors.enterMediaPassphrase')!, 'error'); return }
						if (!text && !attachment && attachments.length === 0) return
						if (navigator.vibrate) try { navigator.vibrate(15) } catch {}
						await sendRoom(sk, roomId, text || undefined, { a: attachment || undefined, as: attachments.length ? attachments : undefined, p })
						setText('')
						setAttachment(null)
						setAttachments([])
					}
				}} style={{ width: '100%', resize: 'none', overflowY: 'auto', fontSize: 16, lineHeight: 1.35, background: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }} />
				</div>
				<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
				<input id="rw-file" type="file" multiple style={{ display: 'none' }} onChange={async (e) => {
					const files = Array.from(e.target.files || [])
					const urls: string[] = []
					for (const file of files) {
						if (file.size > MAX_ATTACHMENT_BYTES) { show(t('errors.fileTooLarge')!, 'error'); continue }
						setPreparing(true); setPrepProgress(0)
						const url = await prepareBlobForSend(file, { onProgress: (p) => setPrepProgress(p) })
						if (dataURLSize(url) > MAX_ATTACHMENT_BYTES) { show(t('errors.encodedFileTooLarge')!, 'error'); continue }
						urls.push(url)
					}
					if (urls.length === 1) setAttachment(urls[0])
					if (urls.length > 1) setAttachments(urls)
					setPreparing(false); setPrepProgress(1)
					try { (e.target as HTMLInputElement).value = '' } catch {}
				}} />
				<button title={t('chat.attachFiles')!} onClick={() => (document.getElementById('rw-file') as HTMLInputElement)?.click()} style={{ padding: '6px 10px' }}>📎</button>
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
							} catch {
								show(t('errors.failedCamera')!, 'error')
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
							mr = new MediaRecorder(stream, { mimeType: audioMime as any, audioBitsPerSecond: 64_000 })
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
							}
							mr.start()
							setVideoRecording(true)
						} catch {
							show('Failed to access camera', 'error')
						}
					}}>🎥</button>
				) : (
					<button title={t('chat.stopVideo')!} onClick={() => {
						const mr = videoRecorderRef.current
						if (mr && mr.state !== 'inactive') mr.stop()
						const stream = videoStreamRef.current
						if (stream) stream.getTracks().forEach(t => t.stop())
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
				{/* Auto-load media toggle (rooms) */}
				<label title={t('chat.autoLoadMediaHint') || 'Automatically load media previews when visible'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
					<input type="checkbox" checked={autoResolveMedia} onChange={(e) => setAutoResolveMedia(e.target.checked)} />
					{t('chat.autoLoadMedia') || 'Auto-load media'}
				</label>
				<div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
					<button
						title={CONFIG.LIVEKIT_ENABLED ? (t('chat.startCall') || 'Start call') : 'Calls not configured'}
						onClick={() => {
							if (!CONFIG.LIVEKIT_ENABLED) { show('Calls not configured', 'error'); return }
							setCallOpen(true)
						}}
						style={{ padding: '6px 10px' }}
					>
						📞
					</button>
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
						const sk = localStorage.getItem('nostr_sk')
						if (!sk || !roomId) return
						const p = (encOn && (attachment || attachments.length)) ? encPass : undefined
						if (encOn && (attachment || attachments.length) && !p) { show('Enter a media passphrase', 'error'); return }
						if (navigator.vibrate) try { navigator.vibrate(15) } catch {}
						setSending(true)
						setSendProg({ stage: 'uploading', uploaded: 0, total: 0, fileProgress: undefined })
						try {
							// Prepare message data for local echo
							let outA = attachment || undefined
							let outAs = attachments.length ? attachments : undefined
							let names: string[] | undefined = undefined
							if (attachments.length > 0) {
								names = attachments.map((a, i) => {
									if (typeof a === 'string' && a.startsWith('data:')) {
										const m = /^data:([^;]+);/.exec(a)
										const mime = m?.[1] || 'application/octet-stream'
										const ext = mime.split('/')[1] || 'bin'
										return `upload.${ext}`
									}
									return 'download.bin'
								})
							}
							const evtId = `${roomId}:${Date.now()}:${Math.random().toString(36).slice(2)}`
							await sendRoom(sk, roomId, text || undefined, {
								a: outA,
								as: outAs,
								p,
								onProgress: ({ stage, uploaded, totalUploads, fileProgress }) => {
									setSendProg({ stage, uploaded: uploaded ?? 0, total: totalUploads ?? 0, fileProgress })
								}
							})
							// Add local echo message
							useRoomStore.getState().addRoomMessage(roomId, {
								id: evtId,
								roomId,
								from: myPubkey as string,
								ts: Math.floor(Date.now()/1000),
								text,
								attachment: outA,
								attachments: outAs,
								name: outA ? 'upload.bin' : undefined,
								names
							})
							setText('')
							setAttachment(null)
							setAttachments([])
						} catch (e) {
							show((e as any)?.message || 'Failed to send', 'error')
						} finally {
							setSending(false)
							setSendProg({ stage: 'idle', uploaded: 0, total: 0, fileProgress: undefined })
						}
					}} disabled={preparing || sending || (!text && !attachment && attachments.length===0)}>{t('common.send')}</button>
				</div>
				</div>
			</footer>
		</section>
	)
}

