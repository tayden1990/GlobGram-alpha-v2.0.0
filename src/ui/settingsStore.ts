import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type SettingsState = {
  powMining: boolean
}

type SettingsActions = {
  setPowMining: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set, get) => ({
      powMining: (() => {
        try { return localStorage.getItem('pow_mining') === '1' } catch { return true }
      })(),
      setPowMining: (v: boolean) => {
        try { localStorage.setItem('pow_mining', v ? '1' : '0') } catch {}
        set({ powMining: v })
      }
    }),
    { name: 'globgram-settings' }
  )
)
