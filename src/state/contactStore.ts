import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type State = {
  aliases: Record<string, string>
}

type Actions = {
  setAlias: (pubkey: string, name: string) => void
}

export const useContactStore = create<State & Actions>()(
  persist<State & Actions>(
    (set, get) => ({
      aliases: {},
      setAlias: (pubkey, name) => {
        const a = { ...get().aliases }
        if (name.trim()) a[pubkey] = name.trim()
        else delete a[pubkey]
        set({ aliases: a })
      },
    }),
    { name: 'globgram-contacts', version: 1 }
  )
)
