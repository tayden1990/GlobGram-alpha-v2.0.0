import { useMemo, useState, useEffect } from 'react'
import { useRoomStore } from '../state/roomStore'
import { createRoom, updateRoomMembers } from '../nostr/engine'
import { useChatStore } from '../state/chatStore'
import { usePresenceStore } from '../state/presenceStore'
import { useToast } from './Toast'
import { refreshSubscriptions } from '../nostr/engine'
import { log } from './logger'
import { BlinkingCallAlarm, RoomPresenceIndicator, GreenLightIndicator, JoinRoomButton } from './CallNotifications'
import { useRingtoneManager } from './RingtoneManager'

export function RoomList({ onCollapse }: { onCollapse?: () => void }) {
	const { show } = useToast()
	const rooms = useRoomStore(s => s.rooms)
	const selected = useRoomStore(s => s.selectedRoom)
	const selectRoom = useRoomStore(s => s.selectRoom)
	const addRoom = useRoomStore(s => s.addRoom)
	const removeRoom = useRoomStore(s => s.removeRoom)
	const msgs = useRoomStore(s => s.messages)
	const [newId, setNewId] = useState('')
	const owners = useRoomStore(s => s.owners)
	const members = useRoomStore(s => s.members)
	const my = useChatStore(s => s.myPubkey)
	
	const ids = useMemo(() => {
		const all = Object.keys(rooms)
		const visible = all.filter(id => (owners[id] && owners[id] === my) || (my ? !!(members[id] && members[id][my]) : false))
		return visible.sort()
	}, [rooms, owners, members, my])
	
	// Presence tracking
	const presenceStore = usePresenceStore()
	const { addCallInvitation, blinkingRooms } = presenceStore
	const hasActiveCall = presenceStore.hasActiveCall
	const updateMyPresence = presenceStore.updateMyPresence
	const setRoomCallActive = presenceStore.setRoomCallActive
	const setRoomBlinking = presenceStore.setRoomBlinking
	const { playOutgoingRingtone } = useRingtoneManager()
	
	// Start presence tracking when component mounts
	useEffect(() => {
		if (!my) return
		
		const interval = setInterval(() => {
			// Update presence for all rooms the user is a member of
			ids.forEach(roomId => {
				if (updateMyPresence) {
					updateMyPresence(roomId, {
						roomId,
						userId: my,
						joinedAt: Date.now(),
						lastHeartbeat: Date.now()
					})
				}
			})
		}, 5000) // Update every 5 seconds
		
		return () => clearInterval(interval)
	}, [my, updateMyPresence, ids])
	
	// Handle room selection with blinking click-to-join
	const handleRoomClick = (roomId: string) => {
		if (blinkingRooms instanceof Set && blinkingRooms.has(roomId)) {
			// Join active call
			// TODO: Open call interface directly
			console.log('Joining active call in room:', roomId)
		}
		
		try { log(`RoomList.select ${roomId}`) } catch {}
		selectRoom(roomId)
		try { onCollapse && onCollapse() } catch {}
	}
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
		<>
			<aside id="roomListNav" role="navigation" aria-label="Rooms" style={{ width: 260, borderRight: '1px solid var(--border)', padding: 12, background: 'var(--card)', color: 'var(--fg)' }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
					<h3 style={{ marginTop: 0 }}>Rooms</h3>
					{onCollapse && (
						<div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
							<button aria-label="Hide rooms list" aria-controls="roomListNav" aria-expanded={true} onClick={onCollapse} title="Hide list (Alt+2)">«</button>
							<span style={{ fontSize: 10, color: 'var(--muted)' }}>Alt+2</span>
						</div>
					)}
				</div>
				<div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
					<input placeholder="track room id (shown if you are owner/member)" value={newId} onChange={(e) => setNewId(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
					<button onClick={() => {
						const id = newId.trim();
						if (!id) return;
						addRoom({ id });
						try { log(`RoomList.join ${id}`) } catch {}
						// Auto-select and collapse drawer to avoid lingering overlay
						selectRoom(id);
						try { onCollapse && onCollapse() } catch {}
						setNewId('')
					}}>Join</button>
					<button title="Create a new room" onClick={async () => {
						const name = prompt('Room name (optional)') || undefined
						const about = prompt('About (optional)') || undefined
						const picture = undefined
						const sk = localStorage.getItem('nostr_sk')
						if (!sk) { show('No key', 'error'); return }
						const id = await createRoom(sk, { name, about, picture }); try { log(`RoomList.create ${id}`) } catch {}
						selectRoom(id)
						try { onCollapse && onCollapse() } catch {}
					}}>New</button>
				</div>
				<div ref={listRef} style={{ maxHeight: 360, overflowY: 'auto' }}>
					<ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
						{ids.length === 0 && <li style={{ color: 'var(--muted)', fontSize: 12 }}>No rooms</li>}
						{ids.map(id => {
							const last = (msgs[id] || [])[ (msgs[id] || []).length - 1 ]
							const isOwner = owners[id] && owners[id] === my
							const isBlinking = blinkingRooms instanceof Set ? blinkingRooms.has(id) : false
							const hasCall = hasActiveCall ? hasActiveCall(id) : false
							
							return (
								<li key={id} style={{ 
									padding: '8px 6px', 
									cursor: 'pointer', 
									background: selected===id ? 'var(--selected)' : undefined,
									position: 'relative',
									border: isBlinking ? '2px solid #ef4444' : undefined,
									borderRadius: isBlinking ? 8 : undefined,
									animation: isBlinking ? 'roomBlink 1s infinite' : undefined
								}} onClick={() => handleRoomClick(id)}>
									{/* Green light indicator for active rooms */}
									<GreenLightIndicator roomId={id} />
									
									{/* Blinking alarm indicator */}
									<BlinkingCallAlarm roomId={id} />
									
									{/* Join room button for active rooms */}
									<JoinRoomButton 
										roomId={id} 
										onJoin={() => handleRoomClick(id)}
									/>
									
									<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
										<div style={{ 
											fontFamily: 'monospace', 
											fontSize: 12,
											color: hasCall ? '#10b981' : undefined,
											fontWeight: hasCall ? 600 : undefined
										}}>
											{id.slice(0, 12)}…
										</div>
										
										<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
											<RoomPresenceIndicator roomId={id} />
											<span style={{ fontSize: 11, color: 'var(--muted)' }}>
												{Object.keys(members[id] || {}).length} members
											</span>
										</div>
										
										<span style={{ flex: 1 }} />
										<button onClick={(e) => { e.stopPropagation(); try { log(`RoomList.leave ${id}`) } catch {}; removeRoom(id) }}>Leave</button>
									</div>
									{last && <div style={{ color: 'var(--muted)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{last.text}</div>}
									{isOwner && (
										<div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
											<button title="Add member (pubkey hex)" onClick={async (e) => {
												e.stopPropagation()
												const sk = localStorage.getItem('nostr_sk')
												if (!sk) { show('No key', 'error'); return }
												const current = Object.keys(members[id] || {})
												const m = prompt('Add member pubkey (hex):')
												if (!m) return
												const next = Array.from(new Set([...current, m.trim()]))
												await updateRoomMembers(sk, id, next); try { log(`RoomList.members.add ${m}`) } catch {}
											}}>+ member</button>
											<button title="Remove member (pubkey hex)" onClick={async (e) => {
												e.stopPropagation()
												const sk = localStorage.getItem('nostr_sk')
												if (!sk) { show('No key', 'error'); return }
												const current = Object.keys(members[id] || {})
												if (!current.length) return
												const m = prompt('Remove which member (pubkey hex):', current[0])
												if (!m) return
												const next = current.filter(x => x !== m.trim())
												await updateRoomMembers(sk, id, next); try { log(`RoomList.members.remove ${m}`) } catch {}
											}}>- member</button>
											
											{/* Start call button for room owners */}
											<button 
												title="Start call in this room"
												onClick={async (e) => {
													e.stopPropagation()
													if (!my) return
													
													// Get room members
													const roomMembers = Object.keys(members[id] || {})
													
													if (roomMembers.length <= 1) {
														show('No other members to call', 'error')
														return
													}
													
													// Create call invitation for all room members except myself
													roomMembers.forEach(memberId => {
														if (memberId !== my) {
															addCallInvitation({
																id: `${Date.now()}-${memberId}-${Math.random().toString(36).slice(2)}`,
																roomId: id,
																fromUserId: my,
																fromUserName: undefined, // Could get from profile
																createdAt: Date.now(),
																status: 'pending'
															})
														}
													})
													
													// Set room as having active call and blinking
													if (setRoomCallActive) setRoomCallActive(id, true)
													if (setRoomBlinking) setRoomBlinking(id, true)
													
													// Play outgoing ringtone for caller
													playOutgoingRingtone()
													
													show(`Call started! Invitations sent to ${roomMembers.length - 1} members`, 'success')
													console.log('Starting call in room:', id, 'inviting:', roomMembers.filter(m => m !== my))
												}}
												style={{
													background: '#10b981',
													color: 'white',
													border: 'none',
													borderRadius: 4,
													padding: '4px 8px',
													fontSize: 11,
													fontWeight: 600
												}}
											>
												📞 Call
											</button>
										</div>
									)}
								</li>
							)
						})}
					</ul>
				</div>
			</aside>
			
			<style>{`
				@keyframes roomBlink {
					0%, 50% { border-color: #ef4444; opacity: 1; }
					51%, 100% { border-color: #ef444440; opacity: 0.8; }
				}
			`}</style>
		</>
	)
}

