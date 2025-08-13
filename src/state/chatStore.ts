import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ChatMessage = {
  id: string
  from: string // pubkey hex
  to: string // pubkey hex
  ts: number
  text?: string
  attachment?: string // data URL (legacy single)
  attachments?: string[] // data URLs (new multi)
  status?: 'pending' | 'sent' | 'failed'
}

type State = {
  myPubkey: string | null
  selectedPeer: string | null
  conversations: Record<string, ChatMessage[]> // by peer pubkey
  lastRead: Record<string, number> // last read timestamp per peer
  blocked: Record<string, boolean>
  typing: Record<string, boolean>
}

type Actions = {
  setMyPubkey: (pk: string | null) => void
  selectPeer: (pk: string | null) => void
  addMessage: (peer: string, msg: ChatMessage) => void
  markRead: (peer: string) => void
  removeMessage: (peer: string, id: string) => void
  clearConversation: (peer: string) => void
  setBlocked: (peer: string, enabled: boolean) => void
  updateMessageStatus: (peer: string, id: string, status: ChatMessage['status']) => void
  setTyping: (peer: string, typing: boolean) => void
}

export const useChatStore = create<State & Actions>()(
  persist<State & Actions>(
    (set, get) => ({
      myPubkey: null,
      selectedPeer: (() => {
        try { return localStorage.getItem('lastSelectedPeer') } catch { return null }
      })(),
      conversations: {},
      lastRead: {},
  blocked: {},
  typing: {},
      setMyPubkey: (pk: string | null) => set({ myPubkey: pk }),
      selectPeer: (pk: string | null) => {
        set({ selectedPeer: pk })
        try { if (pk) localStorage.setItem('lastSelectedPeer', pk); else localStorage.removeItem('lastSelectedPeer') } catch {}
        if (pk) {
          // mark read to newest message when switching
          const msgs = get().conversations[pk] || []
          const ts = msgs.length ? msgs[msgs.length - 1].ts : 0
          const lr = { ...get().lastRead }
          lr[pk] = ts
          set({ lastRead: lr })
        }
      },
      addMessage: (peer: string, msg: ChatMessage) => {
        const convs = { ...get().conversations }
        const list = convs[peer] ? [...convs[peer]] : []
        if (!list.some((m) => m.id === msg.id)) {
          list.push(msg)
          // keep sorted by timestamp asc
          list.sort((a, b) => a.ts - b.ts)
        }
        convs[peer] = list
        set({ conversations: convs })
      },
      markRead: (peer: string) => {
        const msgs = get().conversations[peer] || []
        const ts = msgs.length ? msgs[msgs.length - 1].ts : 0
        const lr = { ...get().lastRead }
        lr[peer] = ts
        set({ lastRead: lr })
      },
      removeMessage: (peer: string, id: string) => {
        const convs = { ...get().conversations }
        const list = (convs[peer] || []).filter(m => m.id !== id)
        convs[peer] = list
        set({ conversations: convs })
      },
      clearConversation: (peer: string) => {
        const convs = { ...get().conversations }
        delete convs[peer]
        set({ conversations: convs })
      },
      setBlocked: (peer: string, enabled: boolean) => {
        const b = { ...get().blocked }
        if (enabled) b[peer] = true
        else delete b[peer]
        set({ blocked: b })
      },
      updateMessageStatus: (peer: string, id: string, status: ChatMessage['status']) => {
        const convs = { ...get().conversations }
        const list = (convs[peer] || []).map(m => m.id === id ? { ...m, status } : m)
        convs[peer] = list
        set({ conversations: convs })
      },
      setTyping: (peer: string, typing: boolean) => {
        const t = { ...get().typing }
        if (typing) t[peer] = true
        else delete t[peer]
        set({ typing: t })
      },
    }),
    {
      name: 'globgram-chat-store',
      version: 1,
    }
  )
)
