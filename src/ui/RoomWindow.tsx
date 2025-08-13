import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRoomStore } from '../state/roomStore'
import { useChatStore } from '../state/chatStore'
import { sendRoom } from '../nostr/engine'
import { blobToDataURL, dataURLSize } from '../nostr/utils'
import { useToast } from './Toast'
import { THUMB_SIZE, PRELOAD_ROOT_MARGIN } from './constants'

export function RoomWindow() {
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
		// media encryption
		const [encOn, setEncOn] = useState(false)
		const [encPass, setEncPass] = useState('')
	const [visibleCount, setVisibleCount] = useState<number>(50)
	const loadingMoreRef = useRef(false)
	const topSentinelRef = useRef<HTMLDivElement | null>(null)
	const [isPreloading, setIsPreloading] = useState(false)
	const [lightbox, setLightbox] = useState<null | { type: 'image'|'video'|'audio'|'file'; src: string; name?: string }>(null)

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])

	// virtualized items (newest N)
	const items = useMemo(() => msgs.slice(-visibleCount), [msgs, visibleCount])
	const rowVirtualizer = useVirtualizer({
		count: items.length,
		getScrollElement: () => scrollerRef.current,
		estimateSize: () => 120,
		overscan: 8,
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
		const distanceFromBottom = rowVirtualizer.getTotalSize() - scroller.scrollTop - scroller.clientHeight
		if (distanceFromBottom < 120) {
			scroller.scrollTop = rowVirtualizer.getTotalSize()
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
				const prevTotal = rowVirtualizer.getTotalSize()
				const prevTop = root.scrollTop
				setVisibleCount(c => {
					const next = Math.min(c + 50, msgs.length)
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
	}, [msgs.length, visibleCount])

	if (!roomId) return <section style={{ flex: 1, padding: 16 }}>Select a room</section>

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
		<section role="main" aria-label="Room messages" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
			onDragOver={(e) => { e.preventDefault() }}
			onDrop={async (e) => {
				e.preventDefault()
				const f = e.dataTransfer?.files?.[0]
				if (!f) return
				if (f.size > 2 * 1024 * 1024) { show('File too large (>2MB)', 'error'); return }
				const url = await blobToDataURL(f)
				if (dataURLSize(url) > 2 * 1024 * 1024) { show('Encoded file too large', 'error'); return }
				setAttachment(url)
			}}
		>
					<header style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--card)' }}>
						<div style={{ fontFamily: 'monospace' }}>Room {roomId.slice(0, 12)}…</div>
						<label title="Encrypt media attachments with a passphrase" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
							<input type="checkbox" checked={encOn} onChange={(e) => setEncOn(e.target.checked)} /> Encrypt media
						</label>
						{encOn && (
							<input type="password" placeholder="media passphrase" value={encPass} onChange={e => setEncPass(e.target.value)} style={{ width: 160 }} />
						)}
					</header>
			<div ref={scrollerRef} style={{ flex: 1, overflowY: 'auto', padding: 16, position: 'relative', background: 'var(--bg)', color: 'var(--fg)' }}>
				<div ref={topSentinelRef} style={{ height: 1 }} />
				<div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
					{rowVirtualizer.getVirtualItems().map((vr) => {
						const m = items[vr.index]
						return (
							<div
								key={vr.key}
								ref={rowVirtualizer.measureElement}
								style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vr.start}px)`, paddingBottom: 8 }}
							>
								<div style={{ display: 'flex', justifyContent: m.from === myPubkey ? 'flex-end' : 'flex-start' }}>
									<div style={{ maxWidth: 520 }}>
										{m.text && (
											<div style={{ background: 'var(--bubble)', color: 'var(--bubble-fg)', borderRadius: 12, padding: '8px 10px' }}>{m.text}</div>
										)}
										{m.attachment?.startsWith('data:image/') && (
											<div title="Open image" onClick={() => setLightbox({ type: 'image', src: m.attachment! })} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: 'var(--border)', cursor: 'pointer' }}>
												<img src={m.attachment} alt="image" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
											</div>
										)}
										{m.attachment?.startsWith('data:video/') && (
											<div title="Play video" onClick={() => setLightbox({ type: 'video', src: m.attachment! })} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: '#000', position: 'relative', cursor: 'pointer' }}>
												<video src={m.attachment} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
												<div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 28, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>▶</div>
											</div>
										)}
										{m.attachment?.startsWith('data:audio/') && (
											<button title="Play audio" onClick={() => setLightbox({ type: 'audio', src: m.attachment! })} style={{ padding: '6px 10px', borderRadius: 16, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--fg)', cursor: 'pointer' }}>♫ Audio</button>
										)}
										{m.attachment && m.attachment.startsWith('data:') && !m.attachment.startsWith('data:image/') && !m.attachment.startsWith('data:video/') && !m.attachment.startsWith('data:audio/') && (
											<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
												<a href={m.attachment} download={filenameForDataUrl(m.attachment)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)' }}>
													📎 Download file ({readableSize(dataURLSize(m.attachment))})
												</a>
											</div>
										)}
										{m.attachments?.map((a: string, i: number) => (
											a.startsWith('data:image/') ? (
												<div key={i} title="Open image" onClick={() => setLightbox({ type: 'image', src: a })} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: 'var(--border)', cursor: 'pointer' }}>
													<img src={a} alt="image" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
												</div>
											) : a.startsWith('data:video/') ? (
												<div key={i} title="Play video" onClick={() => setLightbox({ type: 'video', src: a })} style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, overflow: 'hidden', background: '#000', position: 'relative', cursor: 'pointer' }}>
													<video src={a} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
													<div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 28, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>▶</div>
												</div>
											) : a.startsWith('data:audio/') ? (
												<button key={i} title="Play audio" onClick={() => setLightbox({ type: 'audio', src: a })} style={{ padding: '6px 10px', borderRadius: 16, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--fg)', cursor: 'pointer' }}>♫ Audio</button>
											) : a.startsWith('data:') ? (
												<div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
													<a href={a} download={filenameForDataUrl(a)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)' }}>
														📎 Download file ({readableSize(dataURLSize(a))})
													</a>
												</div>
											) : null
										))}
										<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
											<div style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(m.ts * 1000).toLocaleTimeString()}</div>
										</div>
									</div>
								</div>
							</div>
						)
					})}
				</div>
				{isPreloading && <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', padding: 6 }}>Loading…</div>}
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

			<footer className="sticky-footer" style={{ borderTop: '1px solid var(--border)', padding: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
				<input placeholder="type a message" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1 }} />
				<input type="file" multiple onChange={async (e) => {
					const files = Array.from(e.target.files || [])
					const urls: string[] = []
					for (const file of files) {
						if (file.size > 2 * 1024 * 1024) { show('File too large (>2MB)', 'error'); continue }
						const url = await blobToDataURL(file)
						if (dataURLSize(url) > 2 * 1024 * 1024) { show('Encoded file too large', 'error'); continue }
						urls.push(url)
					}
					if (urls.length === 1) setAttachment(urls[0])
					if (urls.length > 1) setAttachments(urls)
				}} />
				{/* camera photo capture */}
				{!cameraOn ? (
					<button title="Take photo" onClick={async () => {
						if (!navigator.mediaDevices) { show('Camera unsupported', 'error'); return }
						try {
							const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
							cameraStreamRef.current = stream
							setCameraOn(true)
							setTimeout(() => {
								if (cameraVideoRef.current) cameraVideoRef.current.srcObject = stream
							}, 0)
						} catch {
							show('Failed to access camera', 'error')
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
								if (dataURLSize(url) > 2 * 1024 * 1024) { show('Photo too large', 'error'); return }
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
				{/* voice recording */}
				{!recording ? (
					<button onClick={async () => {
						if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') { show('Recording unsupported', 'error'); return }
						const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
						const mr = new MediaRecorder(stream)
						mediaRecorderRef.current = mr
						chunksRef.current = []
						mr.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data) }
						mr.onstop = async () => {
							const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
							if (blob.size > 1024 * 1024) { setRecording(false); show('Voice note too large (>1MB)', 'error'); return }
							const url = await blobToDataURL(blob)
							if (dataURLSize(url) > 1024 * 1024) { setRecording(false); show('Encoded audio too large', 'error'); return }
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
						if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') { show('Recording unsupported', 'error'); return }
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
								if (blob.size > 2 * 1024 * 1024) { setVideoRecording(false); stream.getTracks().forEach(t => t.stop()); show('Video too large (>2MB)', 'error'); return }
								const url = await blobToDataURL(blob)
								if (dataURLSize(url) > 2 * 1024 * 1024) { setVideoRecording(false); stream.getTracks().forEach(t => t.stop()); show('Encoded video too large', 'error'); return }
								setAttachment(url)
								setVideoRecording(false)
								stream.getTracks().forEach(t => t.stop())
								videoStreamRef.current = null
							}
							mr.start()
							setVideoRecording(true)
						} catch {
							show('Failed to access camera', 'error')
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
						<button style={{ minWidth: 88 }} onClick={async () => {
					const sk = localStorage.getItem('nostr_sk')
					if (!sk || !roomId) return
							const p = (encOn && (attachment || attachments.length)) ? encPass : undefined
							if (encOn && (attachment || attachments.length) && !p) { show('Enter a media passphrase', 'error'); return }
							if (navigator.vibrate) try { navigator.vibrate(15) } catch {}
							await sendRoom(sk, roomId, text || undefined, { a: attachment || undefined, as: attachments.length ? attachments : undefined, p })
					setText('')
					setAttachment(null)
					setAttachments([])
				}} disabled={!text && !attachment}>Send</button>
			</footer>
		</section>
	)
}

