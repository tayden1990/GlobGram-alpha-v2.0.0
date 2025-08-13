import { useMemo, useState } from 'react'
import { useRoomStore } from '../state/roomStore'
import { createRoom, updateRoomMembers } from '../nostr/engine'
import { useChatStore } from '../state/chatStore'

export function RoomList() {
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
  return (
    <aside style={{ width: 260, borderRight: '1px solid #eee', padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>Rooms</h3>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
  <input placeholder="track room id (shown if you are owner/member)" value={newId} onChange={(e) => setNewId(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <button onClick={() => { const id = newId.trim(); if (!id) return; addRoom({ id }); setNewId('') }}>Join</button>
        <button title="Create a new room" onClick={async () => {
          const name = prompt('Room name (optional)') || undefined
          const about = prompt('About (optional)') || undefined
          const picture = undefined
          const sk = localStorage.getItem('nostr_sk')
          if (!sk) return alert('No key')
          const id = await createRoom(sk, { name, about, picture })
          selectRoom(id)
        }}>New</button>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {ids.length === 0 && <li style={{ color: '#777', fontSize: 12 }}>No rooms</li>}
        {ids.map(id => {
          const last = (msgs[id] || [])[ (msgs[id] || []).length - 1 ]
          const isOwner = owners[id] && owners[id] === my
          return (
            <li key={id} style={{ padding: '8px 6px', cursor: 'pointer', background: selected===id? '#f5f5f5': undefined }} onClick={() => selectRoom(id)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{id.slice(0, 12)}…</div>
                <span style={{ fontSize: 11, color: '#888' }}>{Object.keys(members[id] || {}).length} members</span>
                <span style={{ flex: 1 }} />
                <button onClick={(e) => { e.stopPropagation(); removeRoom(id) }}>Leave</button>
              </div>
              {last && <div style={{ color: '#666', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{last.text}</div>}
              {isOwner && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button title="Add member (pubkey hex)" onClick={async (e) => {
                    e.stopPropagation()
                    const sk = localStorage.getItem('nostr_sk')
                    if (!sk) return alert('No key')
                    const current = Object.keys(members[id] || {})
                    const m = prompt('Add member pubkey (hex):')
                    if (!m) return
                    const next = Array.from(new Set([...current, m.trim()]))
                    await updateRoomMembers(sk, id, next)
                  }}>+ member</button>
                  <button title="Remove member (pubkey hex)" onClick={async (e) => {
                    e.stopPropagation()
                    const sk = localStorage.getItem('nostr_sk')
                    if (!sk) return alert('No key')
                    const current = Object.keys(members[id] || {})
                    if (!current.length) return
                    const m = prompt('Remove which member (pubkey hex):', current[0])
                    if (!m) return
                    const next = current.filter(x => x !== m.trim())
                    await updateRoomMembers(sk, id, next)
                  }}>- member</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
