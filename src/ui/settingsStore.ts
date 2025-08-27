import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type SettingsState = {
  // Existing settings
  powMining: boolean
  
  // Enhanced UI settings
  theme: 'system' | 'light' | 'dark'
  fontSize: 'small' | 'medium' | 'large'
  compactMode: boolean
  
  // Privacy settings
  readReceipts: boolean
  onlineStatus: boolean
  blockUnknown: boolean
  
  // Notification settings
  desktopNotifications: boolean
  soundEnabled: boolean
  messagePreview: boolean
  
  // General settings
  autoStart: boolean
  minimizeToTray: boolean
  
  // Advanced settings
  enableLogs: boolean
  betaFeatures: boolean
}

type SettingsActions = {
  setPowMining: (v: boolean) => void
  setTheme: (v: 'system' | 'light' | 'dark') => void
  setFontSize: (v: 'small' | 'medium' | 'large') => void
  setCompactMode: (v: boolean) => void
  setReadReceipts: (v: boolean) => void
  setOnlineStatus: (v: boolean) => void
  setBlockUnknown: (v: boolean) => void
  setDesktopNotifications: (v: boolean) => void
  setSoundEnabled: (v: boolean) => void
  setMessagePreview: (v: boolean) => void
  setAutoStart: (v: boolean) => void
  setMinimizeToTray: (v: boolean) => void
  setEnableLogs: (v: boolean) => void
  setBetaFeatures: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set, get) => ({
      // Existing settings
      powMining: (() => {
        try { return localStorage.getItem('pow_mining') === '1' } catch { return true }
      })(),
      
      // Enhanced UI settings with defaults
      theme: 'system',
      fontSize: 'medium',
      compactMode: false,
      
      // Privacy settings defaults
      readReceipts: true,
      onlineStatus: true,
      blockUnknown: false,
      
      // Notification settings defaults
      desktopNotifications: true,
      soundEnabled: true,
      messagePreview: true,
      
      // General settings defaults
      autoStart: false,
      minimizeToTray: true,
      
      // Advanced settings defaults
      enableLogs: false,
      betaFeatures: false,
      
      // Actions
      setPowMining: (v: boolean) => {
        try { localStorage.setItem('pow_mining', v ? '1' : '0') } catch {}
        set({ powMining: v })
      },
      setTheme: (v: 'system' | 'light' | 'dark') => {
        // Apply theme to document
        const root = document.documentElement
        if (v === 'system') {
          root.removeAttribute('data-theme')
        } else {
          root.setAttribute('data-theme', v)
        }
        set({ theme: v })
      },
      setFontSize: (v: 'small' | 'medium' | 'large') => set({ fontSize: v }),
      setCompactMode: (v: boolean) => set({ compactMode: v }),
      setReadReceipts: (v: boolean) => set({ readReceipts: v }),
      setOnlineStatus: (v: boolean) => set({ onlineStatus: v }),
      setBlockUnknown: (v: boolean) => set({ blockUnknown: v }),
      setDesktopNotifications: (v: boolean) => set({ desktopNotifications: v }),
      setSoundEnabled: (v: boolean) => set({ soundEnabled: v }),
      setMessagePreview: (v: boolean) => set({ messagePreview: v }),
      setAutoStart: (v: boolean) => set({ autoStart: v }),
      setMinimizeToTray: (v: boolean) => set({ minimizeToTray: v }),
      setEnableLogs: (v: boolean) => set({ enableLogs: v }),
      setBetaFeatures: (v: boolean) => set({ betaFeatures: v }),
    }),
    { name: 'globgram-settings' }
  )
)
