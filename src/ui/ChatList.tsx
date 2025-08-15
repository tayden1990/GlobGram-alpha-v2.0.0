import { useMemo, useState } from 'react'
import { refreshSubscriptions } from '../nostr/engine'
import { useChatStore } from '../state/chatStore'
import { useContactStore } from '../state/contactStore'
import { nip19 } from 'nostr-tools'
import { bytesToHex } from '../nostr/utils'
import { QRScan } from './QRScan'
import { useToast } from './Toast'
import { log } from './logger'

export function ChatList({ onCollapse }: { onCollapse?: () => void }) {
	const { show } = useToast()
	const conversations = useChatStore(s => s.conversations)
	const selected = useChatStore(s => s.selectedPeer)
	const selectPeer = useChatStore(s => s.selectPeer)
	const [newPeer, setNewPeer] = useState('')
	const [qrOpen, setQrOpen] = useState(false)
	const aliases = useContactStore(s => s.aliases)
	const setAlias = useContactStore(s => s.setAlias)
	const lastRead = useChatStore(s => s.lastRead)

	const peers = useMemo(() => {
		const keys = Object.keys(conversations)
		return keys.sort((a, b) => {
			const la = conversations[a]?.[conversations[a].length - 1]?.ts ?? 0
			const lb = conversations[b]?.[conversations[b].length - 1]?.ts ?? 0
			return lb - la
		})
	}, [conversations])

	// pull-to-refresh when at top
	const ptrRef = useState({ y0: 0, pulling: false })[0]
	const listRef = (el: HTMLDivElement | null) => {
		if (!el) return
		let startY = 0
		el.addEventListener('touchstart', (e) => {
			if (el.scrollTop === 0) { startY = e.touches[0].clientY; ptrRef.y0 = startY; ptrRef.pulling = true }
			else ptrRef.pulling = false
		}, { passive: true })
		el.addEventListener('touchmove', (e) => {
			if (!ptrRef.pulling) return
			const dy = e.touches[0].clientY - startY
					if (dy > 80) {
						if (navigator.vibrate) try { navigator.vibrate(30) } catch {}
						ptrRef.pulling = false
						refreshSubscriptions()
					}
		}, { passive: true })
	}

	return (
		<aside id="chatListNav" role="navigation" aria-label="Chats" style={{ width: 300, borderRight: '1px solid var(--border)', padding: 12, background: 'var(--card)', color: 'var(--fg)' }}>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
				<h3 style={{ marginTop: 0 }}>Chats</h3>
				{onCollapse && (
					<div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
						<button aria-label="Hide chats list" aria-controls="chatListNav" aria-expanded={true} onClick={onCollapse} title="Hide list (Alt+1)">«</button>
						<span style={{ fontSize: 10, color: 'var(--muted)' }}>Alt+1</span>
					</div>
				)}
			</div>
			<div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
				<input placeholder="start chat: pubkey hex or npub" value={newPeer} onChange={(e) => setNewPeer(e.target.value)} style={{ flex: 1 }} />
				<button onClick={() => {
					let pk = newPeer.trim()
					if (!pk) return
					try {
						if (pk.startsWith('npub')) {
							const dec = nip19.decode(pk)
							pk = typeof dec.data === 'string' ? dec.data : bytesToHex(dec.data as Uint8Array)
						}
					} catch {}
					if (!/^[0-9a-fA-F]{64}$/.test(pk)) { show('Invalid pubkey', 'error'); try { log('ChatList.newChat.invalid') } catch {}; return }
					selectPeer(pk); try { onCollapse && onCollapse() } catch {}
					try { log(`ChatList.newChat ${pk.slice(0, 12)}…`) } catch {}
					setNewPeer('')
				}}>Start</button>
				<button title="Scan QR" onClick={() => { try { log('ChatList.qr.open') } catch {}; setQrOpen(true) }}>📷</button>
			</div>
			{qrOpen && (
				<QRScan onResult={(text) => {
					setQrOpen(false)
					try { log(`ChatList.qr.result ${String(text).slice(0,64)}`) } catch {}
					try {
						if (text.startsWith('npub')) {
							const dec = nip19.decode(text)
							const pk = typeof dec.data === 'string' ? dec.data : bytesToHex(dec.data as Uint8Array)
							if (/^[0-9a-fA-F]{64}$/.test(pk)) selectPeer(pk)
						}
						} catch (e: any) { try { log(`ChatList.qr.error: ${e?.message||e}`) } catch {} }
					}} onClose={() => { try { log('ChatList.qr.close') } catch {}; setQrOpen(false) }} />
			)}
			<div ref={listRef} style={{ maxHeight: 360, overflowY: 'auto' }}>
				<ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
					{peers.length === 0 && (
						<li style={{ color: 'var(--muted)', fontSize: 12 }}>No chats yet</li>
					)}
					{peers.map(pk => {
						const msgs = conversations[pk]
						const last = msgs[msgs.length - 1]
						const name = aliases[pk]
						const unread = msgs.filter(m => m.ts > (lastRead[pk] || 0)).length
						return (
							<li key={pk} style={{ padding: '8px 6px', cursor: 'pointer', background: selected===pk? 'var(--selected)': undefined }} onClick={() => { selectPeer(pk); try { onCollapse && onCollapse() } catch {} }}>
								<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
									<div style={{ fontFamily: name ? 'inherit' : 'monospace', fontSize: 12 }}>{name || `${pk.slice(0, 10)}…`}</div>
									{unread > 0 && <span style={{ background: 'var(--accent)', color: '#fff', borderRadius: 999, padding: '0 6px', fontSize: 11 }}>{unread}</span>}
									<button title="edit alias" onClick={(e) => { e.stopPropagation(); const v = prompt('Alias for contact:', name || ''); if (v !== null) setAlias(pk, v) }}>✏️</button>
								</div>
								{last && (
									<div style={{ color: 'var(--muted)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
										{last.text ||
											(last.attachments && last.attachments.length > 0
												? `[${last.attachments.map(a => a.startsWith('data:image/') ? 'image' : a.startsWith('data:video/') ? 'video' : a.startsWith('data:audio/') ? 'audio' : 'file').join(', ')}]`
												: (last.attachment?.startsWith('data:image/') ? '[image]'
													: last.attachment?.startsWith('data:video/') ? '[video]'
													: last.attachment?.startsWith('data:audio/') ? '[audio]'
													: last.attachment ? '[file]' : ''))}
									</div>
								)}
							</li>
						)
					})}
				</ul>
			</div>
		</aside>
	)
}

