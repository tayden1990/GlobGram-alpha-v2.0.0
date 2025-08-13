import { create } from 'zustand'
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
      selectedRoom: null,
  messages: {},
  owners: {},
  members: {},
      addRoom: (room) => set({ rooms: { ...get().rooms, [room.id]: { ...get().rooms[room.id], ...room } } }),
      removeRoom: (id) => {
        const r = { ...get().rooms }
        delete r[id]
        const m = { ...get().messages }
        delete m[id]
        set({ rooms: r, messages: m, selectedRoom: get().selectedRoom === id ? null : get().selectedRoom })
      },
      selectRoom: (id) => set({ selectedRoom: id }),
      addRoomMessage: (id, msg) => {
        const list = get().messages[id] ? [...get().messages[id]] : []
        if (!list.some(m => m.id === msg.id)) {
          list.push(msg)
          list.sort((a, b) => a.ts - b.ts)
        }
        set({ messages: { ...get().messages, [id]: list } })
      },
      setRoomMeta: (id, meta) => {
        const r = get().rooms[id] || { id }
        set({ rooms: { ...get().rooms, [id]: { ...r, ...meta } } })
      },
      clearRoom: (id) => set({ messages: { ...get().messages, [id]: [] } }),
      setOwner: (id, owner) => set({ owners: { ...get().owners, [id]: owner } }),
      setMembers: (id, arr) => {
        const setMap: Record<string, true> = {}
        for (const m of arr) setMap[m] = true
        set({ members: { ...get().members, [id]: setMap } })
      },
      addMember: (id, member) => {
        const m = { ...(get().members[id] || {}) }
        m[member] = true
        set({ members: { ...get().members, [id]: m } })
      },
      removeMember: (id, member) => {
        const m = { ...(get().members[id] || {}) }
        delete m[member]
        set({ members: { ...get().members, [id]: m } })
      },
    }),
    { name: 'globgram-rooms', version: 1 }
  )
)
