import { create } from 'zustand'
import { log } from '../ui/logger'
import { persist } from 'zustand/middleware'

export type Relay = { url: string; enabled: boolean }

type State = {
  relays: Relay[]
}

type Actions = {
  addRelay: (url: string) => void
  removeRelay: (url: string) => void
  toggleRelay: (url: string, enabled: boolean) => void
}

const defaults: Relay[] = [
  { url: 'wss://relay1.matrus.org', enabled: true },
]

export const useRelayStore = create<State & Actions>()(
  persist<State & Actions>(
    (set, get) => ({
      relays: defaults,
      addRelay: (url) => {
        const u = url.trim()
        if (!u) return
        const exists = get().relays.some(r => r.url === u)
        if (exists) return
        set({ relays: [...get().relays, { url: u, enabled: true }] })
        try { log(`relayStore.addRelay ${u}`) } catch {}
      },
      removeRelay: (url) => { set({ relays: get().relays.filter(r => r.url !== url) }); try { log(`relayStore.removeRelay ${url}`) } catch {} },
      toggleRelay: (url, enabled) => { set({ relays: get().relays.map(r => r.url === url ? { ...r, enabled } : r) }); try { log(`relayStore.toggleRelay ${url} -> ${enabled}`) } catch {} },
    }),
    { name: 'globgram-relays', version: 1 }
  )
)
