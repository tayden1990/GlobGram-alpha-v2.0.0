import { create } from 'zustand'
import { log } from '../ui/logger'
import { persist } from 'zustand/middleware'

export type Room = {
  id: string
  name?: string
  about?: string
  picture?: string
}

export type RoomMessage = {
  id: string
  roomId: string
  from: string
  ts: number
  text?: string
  attachment?: string
  attachments?: string[]
}

type State = {
  rooms: Record<string, Room>
  selectedRoom: string | null
  messages: Record<string, RoomMessage[]>
  owners: Record<string, string> // roomId -> owner pubkey
  members: Record<string, Record<string, true>> // roomId -> set of member pubkeys
}

type Actions = {
  addRoom: (room: Room) => void
  removeRoom: (id: string) => void
  selectRoom: (id: string | null) => void
  addRoomMessage: (id: string, msg: RoomMessage) => void
  setRoomMeta: (id: string, meta: Partial<Room>) => void
  clearRoom: (id: string) => void
  setOwner: (id: string, owner: string) => void
  setMembers: (id: string, members: string[]) => void
  addMember: (id: string, member: string) => void
  removeMember: (id: string, member: string) => void
}

export const useRoomStore = create<State & Actions>()(
  persist<State & Actions>(
    (set, get) => ({
      rooms: {},
      selectedRoom: (() => {
        try { return localStorage.getItem('lastSelectedRoom') } catch { return null }
      })(),
  messages: {},
  owners: {},
  members: {},
      addRoom: (room) => {
        const prev = get().rooms[room.id]
        const next = { ...(prev || {}), ...room }
        const changed = !prev || prev.name !== next.name || prev.about !== next.about || prev.picture !== next.picture
        set({ rooms: { ...get().rooms, [room.id]: next } })
        if (changed) { try { log(`roomStore.addRoom ${room.id.slice(0,8)}…`) } catch {} }
      },
      removeRoom: (id) => {
        try { log(`roomStore.removeRoom ${id.slice(0,8)}…`) } catch {}
        const r = { ...get().rooms }
        delete r[id]
        const m = { ...get().messages }
        delete m[id]
        set({ rooms: r, messages: m, selectedRoom: get().selectedRoom === id ? null : get().selectedRoom })
      },
      selectRoom: (id) => {
        try { log(`roomStore.selectRoom ${id?.slice(0,8) || 'null'}`) } catch {}
        set({ selectedRoom: id })
        try { if (id) localStorage.setItem('lastSelectedRoom', id); else localStorage.removeItem('lastSelectedRoom') } catch {}
      },
      addRoomMessage: (id, msg) => {
        try { log(`roomStore.addRoomMessage ${id.slice(0,8)}… id=${msg.id.slice(0,8)}…`) } catch {}
        const list = get().messages[id] ? [...get().messages[id]] : []
        if (!list.some(m => m.id === msg.id)) {
          list.push(msg)
          list.sort((a, b) => a.ts - b.ts)
        }
        set({ messages: { ...get().messages, [id]: list } })
      },
      setRoomMeta: (id, meta) => {
        const prev = get().rooms[id] || { id }
        const next = { ...prev, ...meta }
        const changed = (prev.name !== next.name) || (prev.about !== next.about) || (prev.picture !== next.picture)
        if (!changed) return
        try { log(`roomStore.setRoomMeta ${id.slice(0,8)}… keys=${Object.keys(meta).join(',')}`) } catch {}
        set({ rooms: { ...get().rooms, [id]: next } })
      },
      clearRoom: (id) => { try { log(`roomStore.clearRoom ${id.slice(0,8)}…`) } catch {}; set({ messages: { ...get().messages, [id]: [] } }) },
      setOwner: (id, owner) => {
        const cur = get().owners[id]
        if (cur === owner) return
        try { log(`roomStore.setOwner ${id.slice(0,8)}… -> ${owner.slice(0,8)}…`) } catch {}
        set({ owners: { ...get().owners, [id]: owner } })
      },
      setMembers: (id, arr) => {
        const prev = get().members[id] || {}
        const setMap: Record<string, true> = {}
        for (const m of arr) setMap[m] = true
        // shallow compare membership sets
        const sameSize = Object.keys(prev).length === Object.keys(setMap).length
        let equal = sameSize
        if (equal) {
          for (const k of Object.keys(setMap)) { if (!prev[k]) { equal = false; break } }
        }
        if (equal) return
        try { log(`roomStore.setMembers ${id.slice(0,8)}… count=${arr.length}`) } catch {}
        set({ members: { ...get().members, [id]: setMap } })
      },
      addMember: (id, member) => {
        try { log(`roomStore.addMember ${id.slice(0,8)}… + ${member.slice(0,8)}…`) } catch {}
        const m = { ...(get().members[id] || {}) }
        m[member] = true
        set({ members: { ...get().members, [id]: m } })
      },
      removeMember: (id, member) => {
        try { log(`roomStore.removeMember ${id.slice(0,8)}… - ${member.slice(0,8)}…`) } catch {}
        const m = { ...(get().members[id] || {}) }
        delete m[member]
        set({ members: { ...get().members, [id]: m } })
      },
    }),
    { name: 'globgram-rooms', version: 1 }
  )
)
