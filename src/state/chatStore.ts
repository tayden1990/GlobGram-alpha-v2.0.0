import { create } from 'zustand'
import { log } from '../ui/logger'
import { persist } from 'zustand/middleware'

export type ChatMessage = {
  id: string
  from: string // pubkey hex
  to: string // pubkey hex
  ts: number
  text?: string
  attachment?: string // data URL (legacy single)
  attachments?: string[] // data URLs (new multi)
  status?: 'pending' | 'sent' | 'delivered' | 'failed'
  error?: string
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
  updateMessageId: (peer: string, oldId: string, newId: string) => void
  updateMessage: (peer: string, id: string, patch: Partial<ChatMessage>) => void
  clearConversation: (peer: string) => void
  setBlocked: (peer: string, enabled: boolean) => void
  updateMessageStatus: (peer: string, id: string, status: ChatMessage['status'], error?: string) => void
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
  setMyPubkey: (pk: string | null) => { set({ myPubkey: pk }); try { log(`chatStore.setMyPubkey ${pk?.slice(0,8) || 'null'}`) } catch {} },
      selectPeer: (pk: string | null) => {
        set({ selectedPeer: pk })
        try { if (pk) localStorage.setItem('lastSelectedPeer', pk); else localStorage.removeItem('lastSelectedPeer') } catch {}
        if (pk) {
          try { log(`chatStore.selectPeer ${pk.slice(0,8)}…`) } catch {}
          // mark read to newest message when switching
          const msgs = get().conversations[pk] || []
          const ts = msgs.length ? msgs[msgs.length - 1].ts : 0
          const lr = { ...get().lastRead }
          lr[pk] = ts
          set({ lastRead: lr })
        }
      },
      addMessage: (peer: string, msg: ChatMessage) => {
        try { log(`chatStore.addMessage ${peer.slice(0,8)}… id=${msg.id.slice(0,8)}… status=${msg.status || ''}`) } catch {}
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
  try { log(`chatStore.markRead ${peer.slice(0,8)}…`) } catch {}
        const msgs = get().conversations[peer] || []
        const ts = msgs.length ? msgs[msgs.length - 1].ts : 0
        const lr = { ...get().lastRead }
        lr[peer] = ts
        set({ lastRead: lr })
      },
      removeMessage: (peer: string, id: string) => {
  try { log(`chatStore.removeMessage ${peer.slice(0,8)}… id=${id.slice(0,8)}…`) } catch {}
        const convs = { ...get().conversations }
        const list = (convs[peer] || []).filter(m => m.id !== id)
        convs[peer] = list
        set({ conversations: convs })
      },
      updateMessageId: (peer: string, oldId: string, newId: string) => {
  try { log(`chatStore.updateMessageId ${peer.slice(0,8)}… ${oldId.slice(0,8)}… -> ${newId.slice(0,8)}…`) } catch {}
        const convs = { ...get().conversations }
        const list = (convs[peer] || []).map(m => m.id === oldId ? { ...m, id: newId } : m)
        convs[peer] = list
        set({ conversations: convs })
      },
  updateMessage: (peer: string, id: string, patch: Partial<ChatMessage>) => {
  try { log(`chatStore.updateMessage ${peer.slice(0,8)}… id=${id.slice(0,8)}… keys=${Object.keys(patch).join(',')}`) } catch {}
    const convs = { ...get().conversations }
    const list = (convs[peer] || []).map(m => m.id === id ? { ...m, ...patch } : m)
    convs[peer] = list
    set({ conversations: convs })
  },
      clearConversation: (peer: string) => {
  try { log(`chatStore.clearConversation ${peer.slice(0,8)}…`) } catch {}
        const convs = { ...get().conversations }
        delete convs[peer]
        set({ conversations: convs })
      },
      setBlocked: (peer: string, enabled: boolean) => {
  try { log(`chatStore.setBlocked ${peer.slice(0,8)}… -> ${enabled}`) } catch {}
        const b = { ...get().blocked }
        if (enabled) b[peer] = true
        else delete b[peer]
        set({ blocked: b })
      },
      updateMessageStatus: (peer: string, id: string, status: ChatMessage['status'], error?: string) => {
        const convs = { ...get().conversations }
        let changed = false
        const list = (convs[peer] || []).map(m => {
          if (m.id !== id) return m
          if (m.status === status && (status !== 'failed' || m.error === error)) return m
          changed = true
          return { ...m, status, error: status === 'failed' ? (error || m.error) : undefined }
        })
        if (!changed) return
        try { log(`chatStore.updateMessageStatus ${peer.slice(0,8)}… id=${id.slice(0,8)}… -> ${status}${error ? ` (${error})` : ''}`) } catch {}
        convs[peer] = list
        set({ conversations: convs })
      },
      setTyping: (peer: string, typing: boolean) => {
  try { log(`chatStore.setTyping ${peer.slice(0,8)}… -> ${typing}`) } catch {}
        const t = { ...get().typing }
        if (typing) t[peer] = true
        else delete t[peer]
        set({ typing: t })
      },
    }),
    {
      name: 'globgram-chat-store',
      version: 2,
      // Do NOT persist conversations (they can be replayed from relays) or typing state.
      // Persist only small, useful bits.
      partialize: (state) => ({
        myPubkey: state.myPubkey,
        selectedPeer: state.selectedPeer,
        lastRead: state.lastRead,
        blocked: state.blocked,
      }) as any,
      migrate: (persisted, version) => {
        // Drop heavy fields from v1 -> v2; only keep small persisted subset
        if (version < 2) {
          const p: any = persisted || {}
          return {
            myPubkey: p.myPubkey ?? null,
            selectedPeer: p.selectedPeer ?? null,
            lastRead: p.lastRead ?? {},
            blocked: p.blocked ?? {},
          }
        }
        return persisted as any
      }
    }
  )
)
