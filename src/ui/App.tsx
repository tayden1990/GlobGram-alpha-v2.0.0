import { KeyManager } from '../wallet'
import { ChatList } from './ChatList'
import { NostrEngine } from './NostrEngine'
import { RelayManager } from './RelayManager'
import { RoomList } from './RoomList'
import { ToastProvider, emitToast } from './Toast'
import Logo from './Logo'
import Splash from './Splash'
import { useState, useEffect, useRef, lazy, Suspense, useMemo } from 'react'
import { loadPreparedAds, extractFirstUrl as extractAdUrl, stripUrls as stripAdUrls, PreparedAd } from './ads'
import { useIsMobile } from './useIsMobile'
import { useChatStore } from '../state/chatStore'
import { useRoomStore } from '../state/roomStore'
import { useRelayStore } from '../state/relayStore'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { hexToBytes } from '../nostr/utils'
import { bytesToHex } from '../nostr/utils'
import { createRoom, refreshSubscriptions, sendDM } from '../nostr/engine'
import { useSettingsStore } from './settingsStore'
import { getLogs, clearLogs, onLog, log, setLogMinLevel, getPersistedLogsText, clearPersistedLogs } from './logger'
import { createSoundAudio, playSoundSafely } from './soundUtils'
import { useI18n } from '../i18n'
import { BUILD_INFO } from '../version'
import { checkLatestRelease, semverGreater, type GithubRelease, type GithubAsset } from '../services'
import { CallPanel } from './CallPanel'
import { CONFIG } from '../config'
import { IconInvite, IconLink } from './icons'
import { useContactStore } from '../state/contactStore'
import { useCallPersistence, useCallJoinHandler } from './useCallPersistence'
// Lazy-load QRCode only when needed to reduce initial bundle size

const ChatWindowLazy = lazy(() => import('./ChatWindow').then(m => ({ default: m.ChatWindow })))
const RoomWindowLazy = lazy(() => import('./RoomWindow').then(m => ({ default: m.RoomWindow })))

export default function App() {
  const { t, locale, setLocale, availableLocales } = useI18n()
  const aliases = useContactStore(s => s.aliases)
  const [latestTag, setLatestTag] = useState<string | null>(null)
  // Helper: safely get a localized invite caption/message without leaking raw keys
  const getInviteMessage = () => {
    const cap = t('invite.caption') as string
    if (cap && cap !== 'invite.caption') return cap
    const msg = t('invite.message') as string
    if (msg && msg !== 'invite.message') return msg
    return 'Join me on GlobGram. Tap the link to start a secure chat.'
  }
  // Helper: format a localized invite caption (message + link)
  const formatInviteCaption = (msg: string, link: string) => `${msg}\n${link}`
  // Helper: safely decode an nsec bech32 string to 64-char hex
  const nsecToHex = (n: string): string | null => {
    try {
      const dec: any = nip19.decode(n)
      if (dec && dec.type === 'nsec' && dec.data) {
        return bytesToHex(dec.data as Uint8Array)
      }
    } catch {}
    return null
  }
  // Helper: safely decode bech32 (npub/nprofile) to 64-char hex pubkey
  const npubToHex = (n: string): string | null => {
    try {
      const dec: any = nip19.decode(n)
      if (!dec) return null
      if (dec.type === 'npub') {
        const d: any = dec.data
        let hex: string | null = null
        if (typeof d === 'string') hex = d
        else if (d && typeof d === 'object' && 'length' in d) hex = bytesToHex(d as Uint8Array)
        if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return hex.toLowerCase()
        return null
      }
      if (dec.type === 'nprofile' && dec.data && typeof dec.data === 'object' && dec.data.pubkey) {
        const hex = String(dec.data.pubkey)
        if (/^[0-9a-fA-F]{64}$/.test(hex)) return hex.toLowerCase()
        return null
      }
    } catch (e) {
      try { log(`Invite.decodeError: ${String((e as any)?.message || e)}`) } catch {}
    }
    return null
  }

  // Background: Check GitHub Releases for newer version (rate-limited)
  useEffect(() => {
    const owner = 'tayden1990'
    const repo = 'GlobGram-alpha-v2.0.0'
    const now = Date.now()
    const lastAt = Number(localStorage.getItem('latest_release_check_at') || '0')
    if (now - lastAt < 6 * 60 * 60 * 1000) return // check at most every 6h
    localStorage.setItem('latest_release_check_at', String(now))
  checkLatestRelease(owner, repo).then((rel: GithubRelease) => {
      const tag = rel?.tag_name
      if (!tag) return
      const current = (BUILD_INFO.refName && /^v?\d+\.\d+\.\d+/.test(BUILD_INFO.refName)) ? BUILD_INFO.refName : 'v0.0.0'
      if (semverGreater(tag, current)) {
        setLatestTag(tag)
        const shownKey = `release_toast_shown_${tag}`
        if (!sessionStorage.getItem(shownKey)) {
          sessionStorage.setItem(shownKey, '1')
      emitToast((t('update.newReleaseAvailable', { tag }) as string) || `New release available: ${tag}`, 'info')
        }
      }
    }).catch(()=>{})
  }, [t])
  // Parse an invite value from arbitrary input (URL, npub/nprofile, hex) and return hex pubkey
  const parseInviteInput = (raw: string): string | null => {
    try {
      if (!raw) return null
      let s = raw.trim()
      // If it's a full URL, extract ?invite= or ?inviter= if present
      if (/^https?:\/\//i.test(s)) {
        try {
          const u = new URL(s)
          s = u.searchParams.get('invite') || u.searchParams.get('inviter') || s
        } catch {}
      }
      // Allow nostr: or web+nostr: schemes
      s = s.replace(/^web\+nostr:/i, '').replace(/^nostr:/i, '')
      // If string contains an npub anywhere, extract it
      const m = s.match(/(npub1[02-9ac-hj-np-z]{58,})/i)
      if (m && m[1]) s = m[1]
      // Or nprofile
      const mp = s.match(/(nprofile1[02-9ac-hj-np-z]+)/i)
      const candidate = m?.[1] || mp?.[1] || s
      // Normalize bech32 to lowercase
      const lower = candidate.startsWith('NPUB') || candidate.startsWith('NPROFILE') ? candidate.toLowerCase() : candidate
      if (lower.startsWith('npub') || lower.startsWith('nprofile')) {
        const hx = npubToHex(lower)
        if (hx) return hx
      }
      // Direct 64-hex
      if (/^[0-9a-fA-F]{64}$/.test(lower)) return lower.toLowerCase()
    } catch {}
    return null
  }
  const isMobile = useIsMobile(900)
  const selectedPeer = useChatStore(s => s.selectedPeer)
  const selectPeer = useChatStore(s => s.selectPeer)
  const selectedRoom = useRoomStore(s => s.selectedRoom)
  const selectRoom = useRoomStore(s => s.selectRoom)
  const [activeTab, setActiveTab] = useState<'chats'|'rooms'>(() => (localStorage.getItem('activeTab') as 'chats'|'rooms') || 'chats')
  const [theme, setTheme] = useState<'system'|'light'|'dark'>(() => (localStorage.getItem('theme') as any) || 'system')
  const [fabOpen, setFabOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [logModalOpen, setLogModalOpen] = useState(false)
  const [logAuth, setLogAuth] = useState<'idle'|'required'|'granted'|'denied'>('idle')
  const [logTick, setLogTick] = useState(0)
  const [logLevel, setLogLevel] = useState<'all'|'info'|'warn'|'error'>(() => {
    try { return (localStorage.getItem('logLevel') as any) || 'all' } catch { return 'all' }
  })
  useEffect(() => {
    try {
      localStorage.setItem('logLevel', logLevel); log(`Logs.level=${logLevel}`)
      if (logLevel === 'all') setLogMinLevel('info')
      else setLogMinLevel(logLevel)
    } catch {}
  }, [logLevel])
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string>('')
  const buildInviteLink = (npub: string, lang: string) => {
    try {
      const base = (import.meta as any).env?.BASE_URL || '/'
      const u = new URL(base, window.location.origin)
      u.searchParams.set('invite', npub)
      u.searchParams.set('lang', lang)
      return u.toString()
    } catch {
      return `${window.location.origin}?invite=${encodeURIComponent(npub)}&lang=${encodeURIComponent(lang)}`
    }
  }
  // Onboarding state
  const [onboardingOpen, setOnboardingOpen] = useState<boolean>(() => {
    try { return !localStorage.getItem('onboarding_done') } catch { return true }
  })
  const [obStep, setObStep] = useState<number>(0)
  const [notifStatus, setNotifStatus] = useState<'idle'|'granted'|'denied'|'unsupported'>('idle')
  const [micStatus, setMicStatus] = useState<'idle'|'granted'|'denied'|'unsupported'>('idle')
  const [camStatus, setCamStatus] = useState<'idle'|'granted'|'denied'|'unsupported'>('idle')
  const [keyReady, setKeyReady] = useState<boolean>(() => !!localStorage.getItem('nostr_sk'))
  const [chatListOpen, setChatListOpen] = useState(true)
  const [roomListOpen, setRoomListOpen] = useState(() => isMobile ? false : true)
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false)
  const [roomDrawerOpen, setRoomDrawerOpen] = useState(false)
  const [closing, setClosing] = useState<'none'|'chat'|'room'>('none')
  const chatButtonRef = useRef<HTMLButtonElement | null>(null)
  const roomButtonRef = useRef<HTMLButtonElement | null>(null)
  const chatSwipeRef = useRef({ x: 0, y: 0, active: false })
  const roomSwipeRef = useRef({ x: 0, y: 0, active: false })
  const chatHandleRef = useRef<HTMLButtonElement | null>(null)
  const roomHandleRef = useRef<HTMLButtonElement | null>(null)
  const inviteCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const setMyPubkey = useChatStore(s => s.setMyPubkey)
  const myPubkey = useChatStore(s => s.myPubkey)
  const powMining = useSettingsStore(s => s.powMining)
  const setPowMining = useSettingsStore(s => s.setPowMining)
  const keyFileRef = useRef<HTMLInputElement | null>(null)
  // PWA install prompt handling
  const [installAvailable, setInstallAvailable] = useState(false)
  const installPromptRef = useRef<any>(null)
  const [installStatus, setInstallStatus] = useState<'idle'|'prompting'|'accepted'|'dismissed'|'installed'>('idle')
  const [installError, setInstallError] = useState<string | null>(null)
  const [bipCapturedAt, setBipCapturedAt] = useState<number | null>(null)
  const [isStandalone, setIsStandalone] = useState<boolean>(false)
  // SW version/update state
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [swVersion, setSwVersion] = useState<string | null>(null)
  const [updateCountdown, setUpdateCountdown] = useState<number | null>(null)
  // Ads state (JSON-driven, with ad.txt fallback)
  const [ads, setAds] = useState<PreparedAd[]>([])
  const [adIndex, setAdIndex] = useState(0)
  const [adsDisabled, setAdsDisabled] = useState<boolean>(() => {
    try { return localStorage.getItem('ads_disabled') === '1' } catch { return false }
  })

  // Global CallPanel state (for deep-links and FAB-created calls)
  const [globalCallOpen, setGlobalCallOpen] = useState(false)
  const [globalCallRoom, setGlobalCallRoom] = useState<string | null>(null)
  const [incomingGlobalCall, setIncomingGlobalCall] = useState<null | { from: string; room: string; evtId: string }>(null)
  const ringtoneRef = useRef<HTMLAudioElement | null>(null)
  // Preload ringtone on first user interaction to satisfy autoplay policies
  useEffect(() => {
    const onFirstGesture = () => {
      try {
        if (localStorage.getItem('ringtone_preloaded') === '1') return
        const a = createSoundAudio('ringtone-soft.mp3', {
          loop: false,
          volume: 0.001,
          preload: 'auto'
        });
        playSoundSafely(a, 'ringtone-preload').then(() => { 
          a.pause(); 
          try { a.currentTime = 0 } catch {}; 
          localStorage.setItem('ringtone_preloaded', '1') 
        }).catch(() => {
          // even if it fails, set the flag to avoid spamming
          try { localStorage.setItem('ringtone_preloaded', '1') } catch {}
        })
      } catch {}
      try {
        window.removeEventListener('pointerdown', onFirstGesture as any)
        window.removeEventListener('keydown', onFirstGesture as any)
        window.removeEventListener('touchstart', onFirstGesture as any)
      } catch {}
    }
    window.addEventListener('pointerdown', onFirstGesture as any, { once: true } as any)
    window.addEventListener('keydown', onFirstGesture as any, { once: true } as any)
    window.addEventListener('touchstart', onFirstGesture as any, { once: true } as any)
    return () => {
      try {
        window.removeEventListener('pointerdown', onFirstGesture as any)
        window.removeEventListener('keydown', onFirstGesture as any)
        window.removeEventListener('touchstart', onFirstGesture as any)
      } catch {}
    }
  }, [])
  // Per-ad visibility overrides (persisted)
  const [adDisabledIds, setAdDisabledIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('ads_disabled_ids')
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) return new Set(arr as string[])
      }
    } catch {}
    return new Set()
  })
  const persistAdDisabledIds = (s: Set<string>) => {
    try { localStorage.setItem('ads_disabled_ids', JSON.stringify(Array.from(s))) } catch {}
  }
  const visibleAds = useMemo(() => ads.filter(a => !adDisabledIds.has(a.id)), [ads, adDisabledIds])

  // apply theme
  const applyTheme = (t: 'system'|'light'|'dark') => {
    setTheme(t)
    localStorage.setItem('theme', t)
    const root = document.documentElement
    if (t === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', t)
  }

  // Initialize call persistence for handling shared call links
  useCallPersistence();
  const { autoJoinRoom, clearAutoJoinRoom } = useCallJoinHandler();
  
  // Auto-join call when URL parameter detected
  useEffect(() => {
    if (autoJoinRoom) {
      setGlobalCallRoom(autoJoinRoom);
      setGlobalCallOpen(true);
      clearAutoJoinRoom();
    }
  }, [autoJoinRoom, clearAutoJoinRoom]);

  // persist tab
  useEffect(() => {
    try { localStorage.setItem('activeTab', activeTab) } catch {}
  }, [activeTab])

  // Draw QR when invite modal opens
  useEffect(() => {
    if (!inviteOpen || !inviteUrl) return
    const canvas = inviteCanvasRef.current
    if (!canvas) return
    ;(async () => {
      try {
        const q = await import('qrcode')
        const toCanvas = (q as any).toCanvas || (q as any).default?.toCanvas
        if (typeof toCanvas === 'function') {
          toCanvas(canvas, inviteUrl)
        }
      } catch {}
    })()
  }, [inviteOpen, inviteUrl])

  // Capture PWA install prompt and installed event
  useEffect(() => {
    const onBip = (e: any) => {
      try { e.preventDefault() } catch {}
      installPromptRef.current = e
      setInstallAvailable(true)
      setBipCapturedAt(Date.now())
    }
    const onInstalled = () => {
      setInstallStatus('installed')
      setInstallAvailable(false)
      setIsStandalone(true)
      log('PWA appinstalled event')
    }
    window.addEventListener('beforeinstallprompt', onBip as any)
    window.addEventListener('appinstalled', onInstalled as any)
    // initial display-mode detection
    try {
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
      if (standalone) { setIsStandalone(true); setInstallAvailable(false); setInstallStatus('installed') }
    } catch {}
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip as any)
      window.removeEventListener('appinstalled', onInstalled as any)
    }
  }, [])

  // Load ads.json (with fallback to ad.txt); auto-refresh on locale change
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const items = await loadPreparedAds(locale, 'top')
        if (!cancelled) {
          setAds(items)
          try { console.info('Ads loaded:', items.length) } catch {}
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [locale])

  // Rotate visible ad every 20s when multiple are active
  useEffect(() => {
    if (!visibleAds.length) return
    let i = 0
    const id = setInterval(() => { i = (i + 1) % visibleAds.length; setAdIndex(i) }, 20000)
    return () => clearInterval(id)
  }, [visibleAds])

  // Persist ads disabled preference
  useEffect(() => {
    try { localStorage.setItem('ads_disabled', adsDisabled ? '1' : '0') } catch {}
  }, [adsDisabled])

  // Check for PWA updates on initial open and show Update button
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => {
      const data: any = e.data
      if (data && data.type === 'VERSION') {
        setSwVersion(String(data.version || ''))
      }
    }
    navigator.serviceWorker.addEventListener('message', onMsg as any)
    // Ask SW for its version immediately
    try { navigator.serviceWorker.controller?.postMessage({ type: 'GET_VERSION' }) } catch {}
    // Also trigger an update check
    navigator.serviceWorker.getRegistrations().then(regs => {
  regs.forEach(reg => reg.update().catch(()=>{}))
    }).catch(()=>{})
    // If a new worker is waiting, surface update
    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return
      const handle = () => {
        if (reg.waiting) setUpdateAvailable(true)
      }
      handle()
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing
        if (!nw) return
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) { setUpdateAvailable(true); log('SW update available') }
        })
      })
    }).catch(()=>{})
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMsg as any)
    }
  }, [])

  // Start a short countdown to auto-apply updates
  useEffect(() => {
    if (!updateAvailable) { setUpdateCountdown(null); return }
    setUpdateCountdown(5)
    const id = setInterval(() => {
      setUpdateCountdown((n) => {
        if (n === null) return null
        if (n <= 1) {
          clearInterval(id)
          ;(async () => {
            try {
              const reg = await navigator.serviceWorker.getRegistration()
              if (reg?.waiting) {
                reg.waiting.postMessage({ type: 'SKIP_WAITING' })
                setTimeout(() => window.location.reload(), 200)
              } else {
                window.location.reload()
              }
            } catch { window.location.reload() }
          })()
          return 0
        }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [updateAvailable])

  // While the log modal is open and unlocked, subscribe to log updates to live-refresh
  useEffect(() => {
    if (!(logModalOpen && logAuth === 'granted')) return
    const off = onLog(() => setLogTick(t => (t + 1) % 1_000_000))
    return () => { try { off && off() } catch {} }
  }, [logModalOpen, logAuth])

  // Store invite info for processing after onboarding (if needed)
  const [pendingInvite, setPendingInvite] = useState<{hex: string, lang?: string} | null>(null)
  
  // Handle invite links: ?invite=<npub|hex>&lang=<locale>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    // Handle call deep-link first: ?call=<roomId>
    const call = params.get('call') || ''
    if (call && CONFIG.LIVEKIT_ENABLED) {
      try { log(`DeepLink.call: ${call}`) } catch {}
      // Ensure account exists so identity is stable
      let sk = localStorage.getItem('nostr_sk')
      if (!sk) {
        const secret = generateSecretKey()
        const hexd = bytesToHex(secret)
        const pub = getPublicKey(secret)
        try { localStorage.setItem('nostr_sk', hexd) } catch {}
        setMyPubkey(pub)
        sk = hexd
      }
      setGlobalCallRoom(call)
      setGlobalCallOpen(true)
      // Clean URL of query params to avoid re-triggering
      try { window.history.replaceState({}, '', window.location.pathname + window.location.hash) } catch {}
      return
    }
    // Accept alternate param names just in case
    const invite = params.get('invite') || params.get('inviter') || ''
    // If language override present, apply it immediately so translations load before sending first message
    const urlLang = params.get('lang')
    if (urlLang) {
      try { setLocale(urlLang) } catch {}
    }
    const parsedHex = parseInviteInput(invite)
    if (!parsedHex) return
    try { log(`Invite.detect ${invite.slice(0, 64)}`) } catch {}
    // Clean URL
    try { window.history.replaceState({}, '', window.location.pathname + window.location.hash) } catch {}
    
    // Store invite info for processing
    setPendingInvite({ hex: parsedHex, lang: urlLang || undefined })
    
    // Check if user already has account and onboarding is done
    const hasKey = !!localStorage.getItem('nostr_sk')
    const onboardingDone = !!localStorage.getItem('onboarding_done')
    
    if (hasKey && onboardingDone) {
      // Existing user - process invite immediately
      processInviteGreeting(parsedHex, urlLang || undefined)
    } else {
      // New user or onboarding incomplete - force onboarding, greeting will be sent after completion
      try { log('Invite.needsOnboarding - will greet after completion') } catch {}
      if (!onboardingDone) {
        setOnboardingOpen(true)
      }
      // If no key, it will be created during onboarding
    }
  }, [])

  // Global incoming call banner + soft ringtone
  useEffect(() => {
    const handler = (e: any) => {
      const d = e?.detail
      if (!d || !d.from || !d.room) return
      setIncomingGlobalCall({ from: d.from, room: d.room, evtId: d.evtId })
      // try to play a soft ringtone (best-effort; may require prior gesture on iOS)
      try {
        if (!ringtoneRef.current) {
          const audio = createSoundAudio('ringtone-soft.mp3', {
            loop: true,
            volume: 0.3,
            preload: 'auto'
          });
          ringtoneRef.current = audio
          audio.volume = 0.25
          ringtoneRef.current = audio
        }
        ringtoneRef.current?.play().catch(()=>{})
      } catch {}
    }
    window.addEventListener('incoming-call', handler as any)
    return () => window.removeEventListener('incoming-call', handler as any)
  }, [])

  // Stop ringtone when banner dismissed or call starts
  useEffect(() => {
    if (!incomingGlobalCall && !globalCallOpen) {
      try { ringtoneRef.current?.pause(); if (ringtoneRef.current) ringtoneRef.current.currentTime = 0 } catch {}
    }
  }, [incomingGlobalCall, globalCallOpen])
  // Auto-dismiss global call banner after 45s
  useEffect(() => {
    if (!incomingGlobalCall) return
    const to = setTimeout(() => setIncomingGlobalCall(null), 45000)
    return () => clearTimeout(to)
  }, [incomingGlobalCall])

  // Function to process invite greeting
  const processInviteGreeting = async (inviterHex: string, urlLang?: string) => {
    try {
      // Ensure we only act once per inviter
      const ackKey = `invite_ack_${inviterHex}`
      if (localStorage.getItem(ackKey)) {
        try { log(`Invite.alreadyProcessed: ${inviterHex.slice(0, 12)}…`) } catch {}
        // Still focus the conversation even if already processed
        selectPeer(inviterHex)
        return
      }
      
      // Ensure we have an account
      let sk = localStorage.getItem('nostr_sk')
      if (!sk) {
        const secret = generateSecretKey()
        const hexd = bytesToHex(secret)
        const pub = getPublicKey(secret)
        localStorage.setItem('nostr_sk', hexd)
        setMyPubkey(pub)
        sk = hexd
        try { log('Invite.autoAccountCreated') } catch {}
      }
      
      // Send hello DM (best-effort) and focus chat
      try {
        // Give more time for engine to start and translations to load
        const delay = urlLang ? 800 : 600  // Increased delay to ensure engine is ready
        setTimeout(async () => {
          try { log(`Invite.helloDM.starting -> ${inviterHex.slice(0, 12)}…`) } catch {}
          
          // Wait for translations if we just switched locale via ?lang
          if (urlLang) {
            await new Promise(res => setTimeout(res, 300))
          }
          
          // Ensure NostrEngine has started and relays are connected
          let retries = 0
          const maxRetries = 15
          let engineReady = false
          
          while (retries < maxRetries && !engineReady) {
            try {
              // Check if engine is initialized and has active relay connections
              const { getRelayPool } = await import('../nostr/pool')
              const enabledRelays = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
              
              if (enabledRelays.length > 0) {
                const pool = getRelayPool(enabledRelays)
                let openConnections = 0
                
                for (const [url, ws] of pool.entries()) {
                  if (ws.readyState === WebSocket.OPEN) {
                    openConnections++
                  }
                }
                
                // Consider engine ready if we have at least one open connection
                if (openConnections > 0) {
                  engineReady = true
                  try { log(`Invite.engineReady: ${openConnections}/${enabledRelays.length} relays connected`) } catch {}
                  break
                }
              }
            } catch (e) {
              try { log(`Invite.engineCheck.error: ${String(e)}`) } catch {}
            }
            
            retries++
            await new Promise(res => setTimeout(res, 300))
          }
          
          if (!engineReady) {
            try { log(`Invite.engineNotReady: proceeding anyway after ${retries} retries`) } catch {}
          }
          
          // Get localized greeting message with comprehensive fallbacks
          const getAutoStartMessage = () => {
            const pref = t('invite.autoStartMessage') as string
            const alt1 = t('chat.autoStartMessage') as string  
            const alt2 = t('invite.message') as string
            const pick = (val: string, key: string) => (val && val !== key ? val : '')
            const msg = pick(pref, 'invite.autoStartMessage') || 
                       pick(alt1, 'chat.autoStartMessage') || 
                       pick(alt2, 'invite.message')
            
            if (msg) return msg
            
            // Final fallback based on language
            if (urlLang === 'es') return "¡Hola! Acepté tu invitación. ¡Hablemos!"
            if (urlLang === 'fr') return "Salut! J'ai accepté votre invitation. Parlons!"
            if (urlLang === 'de') return "Hallo! Ich habe Ihre Einladung angenommen. Lass uns reden!"
            if (urlLang === 'it') return "Ciao! Ho accettato il tuo invito. Parliamo!"
            if (urlLang === 'pt') return "Olá! Aceitei seu convite. Vamos conversar!"
            if (urlLang === 'ru') return "Привет! Я принял ваше приглашение. Давайте поговорим!"
            if (urlLang === 'ja') return "こんにちは！あなたの招待を受け入れました。話しましょう！"
            if (urlLang === 'zh') return "你好！我接受了你的邀请。让我们聊聊吧！"
            
            return "Hi! I accepted your invite. Let's chat."
          }
          
          let autoStartMsg = getAutoStartMessage()
          let acked = false

          // helper to send and wait for ack
          const sendAndWait = async (text: string): Promise<boolean> => {
            try {
              const { acked } = await sendDM(sk!, inviterHex, { t: text })
              const ok = await Promise.race([
                acked,
                new Promise<boolean>(res => setTimeout(() => res(false), 9000)),
              ])
              if (ok) try { log(`Invite.helloDM.acked`) } catch {}
              return ok
            } catch (e) {
              try { log(`Invite.helloDM.sendError: ${String(e)}`) } catch {}
              return false
            }
          }

          // Announce sending start
          try { emitToast(t('invite.sendingGreeting'), 'info') } catch {}
          // Primary attempt
          acked = await sendAndWait(autoStartMsg)
          if (!acked) {
            try { log(`Invite.helloDM.primaryNoAck`) } catch {}
            // Retry with safe default
            acked = await sendAndWait("Hi! I accepted your invite. Let's chat.")
          }

          // Last-chance delayed retry (non-blocking) if still not acked
          if (!acked) {
            try { log(`Invite.helloDM.scheduleLastChance`) } catch {}
            try { emitToast(t('invite.retryingGreeting'), 'info') } catch {}
            setTimeout(() => { sendDM(sk!, inviterHex, { t: "Hi! 👋" }).catch(()=>{}) }, 2500)
          }
          
          const finalizeSuccess = () => {
            // Focus conversation
            selectPeer(inviterHex)
            setTimeout(() => selectPeer(inviterHex), 100)
            // Mark processed and clear pending
            try { localStorage.setItem(ackKey, '1') } catch {}
            setPendingInvite(null)
            try { log(`Invite.completed: ${inviterHex.slice(0, 12)}… ack=true`) } catch {}
          }

          if (acked) {
            try { emitToast(t('invite.greetingSent'), 'success') } catch {}
            finalizeSuccess()
          } else {
            try { log('Invite.pendingAck - will retry before finishing') } catch {}
            try { emitToast(t('invite.sendingGreeting'), 'info') } catch {}
            // Background retry loop; only finish when acked
            const plan = [3000, 6000, 12000, 24000, 48000]
            let idx = 0
            const tryAgain = () => {
              if (idx >= plan.length) {
                try { log('Invite.greetingFailedAfterRetries') } catch {}
                return
              }
              const delay = plan[idx++]
              setTimeout(async () => {
                const ok = await sendAndWait("Hi! I accepted your invite. Let's chat.")
                if (ok) {
                  try { emitToast(t('invite.greetingSent'), 'success') } catch {}
                  finalizeSuccess()
                } else {
                  try { emitToast(t('invite.retryingGreeting'), 'info') } catch {}
                  tryAgain()
                }
              }, delay)
            }
            tryAgain()
          }
        }, delay)
      } catch (e: any) { try { log(`Invite.error: ${e?.message||e}`) } catch {} }
    } catch (e: any) { try { log(`Invite.processError: ${e?.message||e}`) } catch {} }
  }

  // Process pending invite after onboarding completion
  useEffect(() => {
    if (!onboardingOpen && pendingInvite) {
      // Onboarding just completed and we have a pending invite
      try { log('Invite.onboardingComplete - processing pending invite') } catch {}
      processInviteGreeting(pendingInvite.hex, pendingInvite.lang)
    }
  }, [onboardingOpen, pendingInvite])

  // Prefetch heavy panels just-in-time (removed dynamic import to avoid TS module warning in isolated checks)

  // Keyboard shortcuts: Alt+1 toggle chats list, Alt+2 toggle rooms list (desktop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return
      if (e.key === '1') {
        e.preventDefault()
        if (isMobile) {
          setChatDrawerOpen(v => !v)
        } else if (chatListOpen) {
          setChatListOpen(false)
          setTimeout(() => chatHandleRef.current?.focus(), 0)
        } else {
          setChatListOpen(true)
          setTimeout(() => (document.querySelector('#chatListNav input') as HTMLInputElement | null)?.focus(), 0)
        }
      } else if (e.key === '2') {
        e.preventDefault()
        if (isMobile) {
          setRoomDrawerOpen(v => !v)
        } else if (roomListOpen) {
          setRoomListOpen(false)
          setTimeout(() => roomHandleRef.current?.focus(), 0)
        } else {
          setRoomListOpen(true)
          setTimeout(() => (document.querySelector('#roomListNav input') as HTMLInputElement | null)?.focus(), 0)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chatListOpen, roomListOpen, isMobile])

  // Auto-collapse any drawers/lists on chat selection; prefer panel-ready event, else hard-reload once as last resort
  useEffect(() => {
    if (!selectedPeer) return
    try { log(`Nav.selectPeer ${selectedPeer.slice(0, 12)}…`) } catch {}
    // Ensure Chats tab is active on mobile
    setActiveTab('chats')
    // Close drawers/side lists proactively
    setChatDrawerOpen(false)
    setChatListOpen(false)
    // Listen for panel-ready; if not received quickly, reload once (per-target guard)
    let ready = false
    const onReady = (e: any) => {
      const d = e?.detail
      if (d?.type === 'chat' && d?.id === selectedPeer) ready = true
    }
    window.addEventListener('panel-ready', onReady as any)
    // Poll DOM for chat pane presence as an additional readiness signal
    const checkDom = () => {
      try {
        const pane = document.querySelector('section[aria-label="Direct messages"] .scroll-y')
        if (pane) ready = true
      } catch {}
    }
    checkDom()
    const poll = window.setInterval(checkDom, 200)
    const t1 = window.setTimeout(() => {
      const overlays = document.querySelectorAll('.drawer-overlay')
      if (overlays.length) {
        try { log('UI.drawerOverlay.stuck.afterPeerSelect -> forceClose') } catch {}
        setChatDrawerOpen(false)
        setRoomDrawerOpen(false)
        overlays.forEach(el => { (el as HTMLElement).style.display = 'none' })
      }
    }, 250)
    const t2 = window.setTimeout(() => {
      if (!ready) {
        const global = 'autoReloadedOnce'
        const key = `reloaded_for_chat_${selectedPeer}`
        if (!sessionStorage.getItem(global) && !sessionStorage.getItem(key)) {
          try { log('Nav.selectPeer.notReady -> hardReloadOnce') } catch {}
          try { sessionStorage.setItem(global, '1') } catch {}
          try { sessionStorage.setItem(key, '1') } catch {}
          try {
            ;(async () => {
              try {
                const regs = await (navigator as any)?.serviceWorker?.getRegistrations?.()
                if (regs && Array.isArray(regs)) regs.forEach((r: any) => { try { r.unregister() } catch {} })
              } catch {}
              try {
                const keys = await (caches as any)?.keys?.()
                if (keys && Array.isArray(keys)) {
                  for (const k of keys) { try { await (caches as any).delete(k) } catch {} }
                }
              } catch {}
              try {
                const u = new URL(window.location.href)
                u.searchParams.set('bust', String(Date.now()))
                window.location.replace(u.toString())
              } catch { window.location.reload() }
            })()
          } catch { window.location.reload() }
        }
      }
    }, 2500)
    return () => { window.removeEventListener('panel-ready', onReady as any); window.clearTimeout(t1); window.clearTimeout(t2); window.clearInterval(poll) }
  }, [selectedPeer])

  // Auto-collapse any drawers/lists on room selection; prefer panel-ready then hard-reload once if needed
  useEffect(() => {
    if (!selectedRoom) return
    try { log(`Nav.selectRoom ${String(selectedRoom).slice(0, 18)}…`) } catch {}
    // Ensure Rooms tab is active on mobile
    setActiveTab('rooms')
    // Close drawers/side lists proactively
    setRoomDrawerOpen(false)
    setRoomListOpen(false)
    let ready = false
    const onReady = (e: any) => {
      const d = e?.detail
      if (d?.type === 'room' && String(d?.id) === String(selectedRoom)) ready = true
    }
    window.addEventListener('panel-ready', onReady as any)
    // Poll DOM for room pane presence as an additional readiness signal
    const checkDom = () => {
      try {
        const pane = document.querySelector('section[aria-label="Room messages"] .scroll-y')
        if (pane) ready = true
      } catch {}
    }
    checkDom()
    const poll = window.setInterval(checkDom, 200)
    const t1 = window.setTimeout(() => {
      const overlays = document.querySelectorAll('.drawer-overlay')
      if (overlays.length) {
        try { log('UI.drawerOverlay.stuck.afterRoomSelect -> forceClose') } catch {}
        setRoomDrawerOpen(false)
        setChatDrawerOpen(false)
        overlays.forEach(el => { (el as HTMLElement).style.display = 'none' })
      }
    }, 250)
    const t2 = window.setTimeout(() => {
      if (!ready) {
        const global = 'autoReloadedOnce'
        const key = `reloaded_for_room_${selectedRoom}`
        if (!sessionStorage.getItem(global) && !sessionStorage.getItem(key)) {
          try { log('Nav.selectRoom.notReady -> hardReloadOnce') } catch {}
          try { sessionStorage.setItem(global, '1') } catch {}
          try { sessionStorage.setItem(key, '1') } catch {}
          try {
            ;(async () => {
              try {
                const regs = await (navigator as any)?.serviceWorker?.getRegistrations?.()
                if (regs && Array.isArray(regs)) regs.forEach((r: any) => { try { r.unregister() } catch {} })
              } catch {}
              try {
                const keys = await (caches as any)?.keys?.()
                if (keys && Array.isArray(keys)) {
                  for (const k of keys) { try { await (caches as any).delete(k) } catch {} }
                }
              } catch {}
              try {
                const u = new URL(window.location.href)
                u.searchParams.set('bust', String(Date.now()))
                window.location.replace(u.toString())
              } catch { window.location.reload() }
            })()
          } catch { window.location.reload() }
        }
      }
    }, 2500)
    return () => { window.removeEventListener('panel-ready', onReady as any); window.clearTimeout(t1); window.clearTimeout(t2); window.clearInterval(poll) }
  }, [selectedRoom])

  // One-time global guard: if React hook mismatch error (#310) bubbles, hard-reload with cache-bust
  useEffect(() => {
    const key = 'react310Reloaded'
    const onErr = (e: ErrorEvent) => {
      try {
        const msg = String(e?.message || '')
        if (msg.includes('Minified React error #310') && !sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1')
          ;(async () => {
            try {
              const regs = await (navigator as any)?.serviceWorker?.getRegistrations?.()
              if (regs && Array.isArray(regs)) regs.forEach((r: any) => { try { r.unregister() } catch {} })
            } catch {}
            try {
              const keys = await (caches as any)?.keys?.()
              if (keys && Array.isArray(keys)) {
                for (const k of keys) { try { await (caches as any).delete(k) } catch {} }
              }
            } catch {}
            try {
              const u = new URL(window.location.href)
              u.searchParams.set('bust', String(Date.now()))
              window.location.replace(u.toString())
            } catch { window.location.reload() }
          })()
        }
      } catch {}
    }
    window.addEventListener('error', onErr)
    return () => window.removeEventListener('error', onErr)
  }, [])
  return (
    <ToastProvider>
      <Splash />
      {/* Onboarding overlay */}
      {onboardingOpen && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: 'min(720px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 10px 32px rgba(0,0,0,0.35)', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>{t('onboarding.welcome')}</h2>
              <button onClick={() => setOnboardingOpen(false)} aria-label={t('common.close')}>✖</button>
            </div>
            {obStep === 0 && (
              <div>
                <h3>{t('onboarding.intro.title')}</h3>
                <p>{t('onboarding.intro.desc')}</p>
                <p style={{ marginTop: -8, opacity: 0.9 }}>{t('onboarding.intro.nostr')}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)' }}>{t('onboarding.intro.chooseLanguage')}</label>
                  <select value={locale} onChange={(e) => setLocale(e.target.value)}>
                    {availableLocales.map(l => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                  <div style={{ marginLeft: 'auto' }}>
                    <button onClick={() => setObStep(1)}>{t('common.next')}</button>
                  </div>
                </div>
              </div>
            )}
            {obStep === 1 && (
              <div>
                <h3>{t('onboarding.step1.title')}</h3>
                <p>{t('onboarding.step1.desc')}</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={async () => {
                    try {
                      // @ts-ignore
                      if (!('Notification' in window)) { setNotifStatus('unsupported'); return }
                      // @ts-ignore
                      const r = await Notification.requestPermission()
                      setNotifStatus(r === 'granted' ? 'granted' : 'denied')
                    } catch { setNotifStatus('unsupported') }
                  }}>{t('onboarding.allowNotifications')}</button>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {notifStatus === 'idle' && t('status.notRequested')}
                    {notifStatus === 'granted' && t('status.granted')}
                    {notifStatus === 'denied' && t('status.denied')}
                    {notifStatus === 'unsupported' && t('status.unsupported')}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                    <button onClick={() => setObStep(0)}>← {t('common.back')}</button>
                    <button onClick={() => setObStep(2)}>{t('common.next')}</button>
                  </div>
                </div>
              </div>
            )}
            {obStep === 2 && (
              <div>
                <h3>{t('onboarding.step2.title')}</h3>
                <p>{t('onboarding.step2.desc')}</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={async () => {
                    try {
                      if (!navigator.mediaDevices?.getUserMedia) { setMicStatus('unsupported'); return }
                      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                      try { stream.getTracks().forEach(t => t.stop()) } catch {}
                      setMicStatus('granted')
                    } catch { setMicStatus('denied') }
                  }}>{t('onboarding.allowMic')}</button>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {micStatus === 'idle' && t('status.notRequested')}
                    {micStatus === 'granted' && t('status.granted')}
                    {micStatus === 'denied' && t('status.denied')}
                    {micStatus === 'unsupported' && t('status.unsupported')}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                    <button onClick={() => setObStep(1)}>← {t('common.back')}</button>
                    <button onClick={() => setObStep(3)}>{t('common.next')}</button>
                  </div>
                </div>
              </div>
            )}
            {obStep === 3 && (
              <div>
                <h3>{t('onboarding.step3.title')}</h3>
                <p>{t('onboarding.step3.desc')}</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={async () => {
                    try {
                      if (!navigator.mediaDevices?.getUserMedia) { setCamStatus('unsupported'); return }
                      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
                      try { stream.getTracks().forEach(t => t.stop()) } catch {}
                      setCamStatus('granted')
                    } catch { setCamStatus('denied') }
                  }}>{t('onboarding.allowCamera')}</button>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {camStatus === 'idle' && t('status.notRequested')}
                    {camStatus === 'granted' && t('status.granted')}
                    {camStatus === 'denied' && t('status.denied')}
                    {camStatus === 'unsupported' && t('status.unsupported')}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                    <button onClick={() => setObStep(2)}>← {t('common.back')}</button>
                    <button onClick={() => setObStep(4)}>{t('common.next')}</button>
                  </div>
                </div>
              </div>
            )}
            {obStep === 4 && (
              <div>
                <h3>{t('onboarding.step4.title')}</h3>
                <p>{t('onboarding.step4.desc')}</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={() => {
                    const secret = generateSecretKey()
                    const hexd = bytesToHex(secret)
                    const pub = getPublicKey(secret)
                    try { localStorage.setItem('nostr_sk', hexd) } catch {}
                    setMyPubkey(pub)
                    setKeyReady(true)
                  }}>{t('onboarding.generateKey')}</button>
                  <button onClick={() => keyFileRef.current?.click()}>{t('onboarding.importFromFile')}</button>
                  <input ref={keyFileRef} type="file" accept=".txt,.json,.key" style={{ display: 'none' }} onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    try {
                      const txt = await f.text()
                      let secretHex: string | null = null
                      // Try JSON formats first
                      try {
                        const j = JSON.parse(txt)
                        // Encrypted backup v2
                        if (j && j.v === 2 && Array.isArray(j.salt) && Array.isArray(j.iv) && Array.isArray(j.data)) {
                          const password = prompt(t('onboarding.import.passwordPrompt')!)
                          if (!password) { alert(t('onboarding.import.cancelled')); return }
                          const enc = new TextEncoder()
                          const salt = new Uint8Array(j.salt)
                          const iv = new Uint8Array(j.iv)
                          const data = new Uint8Array(j.data)
                          const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
                          const dkey = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['decrypt'])
                          const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dkey, data)
                          const decoded = JSON.parse(new TextDecoder().decode(new Uint8Array(plaintext)))
                          if (decoded && typeof decoded.secretHex === 'string') secretHex = decoded.secretHex.trim()
                        } else {
                          // Plain backup v1 or generic JSON
                          if (typeof j?.secretHex === 'string') secretHex = j.secretHex.trim()
                          else if (typeof j?.hex === 'string') secretHex = j.hex.trim()
                          else if (typeof j?.sk === 'string') secretHex = j.sk.trim()
                          else if (typeof j?.nsec === 'string' && j.nsec) {
                            const hx = nsecToHex(j.nsec)
                            if (hx) secretHex = hx
                          } else if (j?.version === 1) {
                            if (typeof j?.secretHex === 'string') secretHex = j.secretHex.trim()
                            else if (typeof j?.nsec === 'string') {
                              const hx = nsecToHex(j.nsec)
                              if (hx) secretHex = hx
                            } else if (typeof j?.sk === 'string') secretHex = j.sk.trim()
                          }
                        }
                      } catch {}
                      // Fallback to plain text formats
                      if (!secretHex) {
                        const trimmed = txt.trim()
                        if (trimmed.startsWith('nsec')) {
                          const hx = nsecToHex(trimmed)
                          if (hx) secretHex = hx
                        } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
                          secretHex = trimmed
                        } else {
                          const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
                          const maybeNsec = lines.find(l => l.startsWith('nsec'))
                          if (maybeNsec) {
                            const hx = nsecToHex(maybeNsec)
                            if (hx) secretHex = hx
                          }
                          if (!secretHex) {
                            const maybeHex = lines.find(l => /^[0-9a-fA-F]{64}$/.test(l))
                            if (maybeHex) secretHex = maybeHex
                          }
                        }
                      }
                      if (!secretHex || !/^[0-9a-fA-F]{64}$/.test(secretHex)) { alert(t('errors.invalidKey')); return }
                      const pub = getPublicKey(hexToBytes(secretHex))
                      try { localStorage.setItem('nostr_sk', secretHex) } catch {}
                      setMyPubkey(pub)
                      setKeyReady(true)
                    } catch {
                      alert(t('errors.readKeyFailed'))
                    } finally {
                      try { (e.target as HTMLInputElement).value = '' } catch {}
                    }
                  }} />
                  {keyReady ? <span style={{ color: 'var(--muted)', fontSize: 12 }}>{t('onboarding.keyReady')}</span> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>{t('onboarding.noKey')}</span> }
                  <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                    <button onClick={() => setObStep(3)}>← {t('common.back')}</button>
                    <button disabled={!keyReady} onClick={() => setObStep(5)}>{t('common.next')}</button>
                  </div>
                </div>
              </div>
            )}
            {obStep === 5 && (
              <div>
                <h3>{t('onboarding.step5.title')}</h3>
                <p>{t('onboarding.step5.desc')}</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    disabled={!installAvailable || isStandalone}
                    title={isStandalone ? t('install.alreadyInstalled') : (installAvailable ? t('install.installApp') : t('install.promptNotAvailable'))}
                    onClick={async () => {
                      setInstallError(null)
                      const prompt = installPromptRef.current
                      if (!prompt) { setInstallStatus('idle'); return }
                      try {
                        setInstallStatus('prompting')
                        await prompt.prompt()
                        const choice = await prompt.userChoice
                        if (choice?.outcome === 'accepted') setInstallStatus('accepted')
                        else setInstallStatus('dismissed')
                      } catch (err: any) {
                        setInstallStatus('dismissed')
                        setInstallError(String(err?.message || err || 'Install prompt was blocked'))
                      } finally {
                        // The prompt can only be used once.
                        installPromptRef.current = null
                        setInstallAvailable(false)
                      }
                    }}
                  >{t('install.installApp')}</button>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {isStandalone && t('install.status.installed')}
                    {!isStandalone && installStatus === 'idle' && (installAvailable ? t('install.status.ready') : t('install.status.waiting'))}
                    {installStatus === 'prompting' && t('install.status.prompting')}
                    {installStatus === 'accepted' && t('install.status.accepted')}
                    {installStatus === 'dismissed' && t('install.status.dismissed')}
                    {installStatus === 'installed' && t('install.status.installed')}
                  </span>
                  {installError && (
                    <div style={{ color: 'var(--danger, #e57373)', fontSize: 12 }}>
                      {installError}
                    </div>
                  )}
                  {!installAvailable && (
                    <div style={{ width: '100%', color: 'var(--muted)', fontSize: 12 }}>
                      <div>{t('install.tipTitle')}</div>
                      <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                        <li>{t('install.tip.reloadOnce')}</li>
                        <li>{t('install.tip.https')}</li>
                        <li>{t('install.tip.notInstalled')}</li>
                        <li>
                          {(() => {
                            const ua = navigator.userAgent.toLowerCase()
                            const isiOS = /iphone|ipad|ipod/.test(ua)
                            const isChromium = /chrome|edg|crios/.test(ua)
                            if (isiOS) return t('install.tip.ios')
                            if (isChromium) return t('install.tip.chromium')
                            return t('install.tip.generic')
                          })()}
                        </li>
                      </ul>
                      <div style={{ marginTop: 6 }}>
                        <button onClick={() => {
                          try { navigator.serviceWorker.controller?.postMessage({ type: 'GET_VERSION' }) } catch {}
                          navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.update().catch(()=>{}))).catch(()=>{})
                        }}>{t('common.checkAgain')}</button>
                        <button onClick={() => window.location.reload()} style={{ marginLeft: 8 }}>{t('common.reload')}</button>
                      </div>
                      <div style={{ marginTop: 6, opacity: 0.8 }}>
                        {t('install.readiness')}: {isSecureContext ? t('install.secure') : t('install.insecure')} · SW: {navigator.serviceWorker?.controller ? t('install.swControlled') : t('install.swNoController')} ·
                        BIP: {bipCapturedAt ? new Date(bipCapturedAt).toLocaleTimeString() : t('install.notYet')}
                      </div>
                    </div>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                    <button onClick={() => setObStep(4)}>← {t('common.back')}</button>
                    <button onClick={() => setObStep(6)}>{t('common.next')}</button>
                  </div>
                </div>
              </div>
            )}
            {obStep === 6 && (
              <div>
                <h3>{t('onboarding.step6.title')}</h3>
                <ul>
                  <li>{t('onboarding.step6.tip1')}</li>
                  <li>{t('onboarding.step6.tip2')}</li>
                  <li>{t('onboarding.step6.tip3')}</li>
                  <li>{t('onboarding.step6.tip4')}</li>
                  <li>{t('onboarding.step6.tip5')}</li>
                </ul>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={() => setObStep(5)}>← {t('common.back')}</button>
                  <button onClick={() => { 
                    try { localStorage.setItem('onboarding_done', '1') } catch {}
                    setOnboardingOpen(false)
                    try { log('Onboarding.completed - checking for pending invite') } catch {}
                  }}>{t('common.finish')}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    <div style={{ fontFamily: 'system-ui, sans-serif', height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', overflow: 'hidden' }}>
      <div className="sticky-top" style={{ display: 'flex', flexDirection: 'column', gap: 0, borderBottom: '1px solid var(--border)', background: 'var(--card)' }}>
        {!adsDisabled && visibleAds.length > 0 && (() => {
          const ad = visibleAds[adIndex] || visibleAds[0]
          const url = ad.url
          const displayText = ad.displayText
          return (
            <div role="note" aria-live="polite" style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  title={displayText}
                  onClick={() => { if (url) try { window.open(url, '_blank', 'noopener,noreferrer') } catch {} }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '10px 14px', background: 'var(--accent)', color: '#fff',
                    border: 'none', borderRadius: 10, cursor: url ? 'pointer' : 'default',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.18)', transition: 'transform 120ms ease, opacity 120ms ease'
                  }}
                  onMouseDown={(e) => { const t = e.currentTarget; t.style.transform = 'translateY(1px)' }}
                  onMouseUp={(e) => { const t = e.currentTarget; t.style.transform = '' }}
                  onMouseLeave={(e) => { const t = e.currentTarget; t.style.transform = '' }}
                  aria-label={url ? `${displayText} — open link` : displayText}
                >
                  <span aria-hidden>📣</span>
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayText}</span>
                  {url && <span aria-hidden style={{ opacity: 0.9 }}>↗</span>}
                </button>
                <button
                  type="button"
                  title={t('common.dismiss') || 'Dismiss'}
                  aria-label={t('common.dismiss') || 'Dismiss'}
                  onClick={() => {
                    setAdDisabledIds(prev => {
                      const next = new Set(prev)
                      next.add(ad.id)
                      persistAdDisabledIds(next)
                      return next
                    })
                    setAdIndex(0)
                  }}
                  style={{
                    flex: 'none', padding: '8px 10px', background: 'transparent', color: 'var(--muted)',
                    border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer'
                  }}
                >✖</button>
              </div>
            </div>
          )
        })()}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <Logo size={28} animated title="GlobGram" />
          <h1 style={{ margin: 0, fontSize: 16 }}>GlobGram Alpha</h1>
        </div>
        {/* <span style={{ color: 'var(--muted)' }}>Decentralized DMs over Nostr</span> */}
        <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <button title={t('actions.invite')} aria-label={t('actions.invite')} onClick={async () => {
            // Ensure we have a key
            let sk = localStorage.getItem('nostr_sk')
            if (!sk) {
              const secret = generateSecretKey()
              const hexd = bytesToHex(secret)
              const pub = getPublicKey(secret)
              localStorage.setItem('nostr_sk', hexd)
              setMyPubkey(pub)
              sk = hexd
            }
            // Build invite URL with my npub and current language
            const pk = useChatStore.getState().myPubkey
            if (!pk) return
            const npub = nip19.npubEncode(pk)
            const link = buildInviteLink(npub, locale)
            setInviteUrl(link)
            
            // Quick share attempt first, then open modal as fallback
            try {
              const message = getInviteMessage()
              const caption = formatInviteCaption(message, link)
              
              // Try sharing text+link+QR image with improved Web Share logic
              const tryShareWithQR = async () => {
                try {
                  // Build QR image blob offscreen
                  const { toCanvas } = await import('qrcode') as any
                  const off = document.createElement('canvas')
                  off.width = 256
                  off.height = 256
                  await new Promise<void>((resolve) => {
                    try { 
                      (toCanvas || (toCanvas as any)?.default?.toCanvas)(off, link, { width: 256 }, (err: any) => {
                        if (err) console.warn('QR generation error:', err)
                        resolve()
                      }) 
                    } catch (e) { 
                      console.warn('QR generation failed:', e)
                      resolve() 
                    }
                  })
                  const blob: Blob | null = await new Promise(res => { 
                    try { 
                      off.toBlob(b => res(b), 'image/png', 0.9) 
                    } catch { 
                      res(null) 
                    } 
                  })
                  if (!blob) return false
                  
                  const file = new File([blob], 'globgram-invite.png', { type: 'image/png' })
                  
                  // @ts-ignore
                  if ((navigator as any).share) {
                    try {
                      // Strategy 1: Try files with text as separate field
                      try {
                        const shareData = { files: [file], text: caption, title: t('invite.connectTitle') }
                        // @ts-ignore
                        if ((navigator as any).canShare && (navigator as any).canShare(shareData)) {
                          // @ts-ignore
                          await (navigator as any).share(shareData)
                          return true
                        }
                      } catch (e) {
                        console.log('Files+text share failed:', e)
                      }
                      
                      // Strategy 2: Try files with caption as title
                      try {
                        const shareData = { files: [file], title: caption }
                        // @ts-ignore
                        if ((navigator as any).canShare && (navigator as any).canShare(shareData)) {
                          // @ts-ignore
                          await (navigator as any).share(shareData)
                          return true
                        }
                      } catch (e) {
                        console.log('Files+title share failed:', e)
                      }
                      
                      // Strategy 3: Files only, then copy text
                      try {
                        const shareData = { files: [file] }
                        // @ts-ignore
                        if ((navigator as any).canShare && (navigator as any).canShare(shareData)) {
                          // @ts-ignore
                          await (navigator as any).share(shareData)
                          // Immediately copy caption to clipboard as fallback
                          try { 
                            await navigator.clipboard.writeText(caption)
                            // Show user that caption was copied
                            setTimeout(() => alert(t('invite.copied') + '\n' + t('invite.captionCopied')), 100)
                          } catch {}
                          return true
                        }
                      } catch (e) {
                        console.log('Files-only share failed:', e)
                      }
                    } catch (shareErr) {
                      console.warn('All file sharing strategies failed:', shareErr)
                    }
                  }
                } catch (e) {
                  console.warn('QR generation failed:', e)
                }
                return false
              }
              
              // Try to share, but always open the manual share modal afterwards
              let shared = false
              // Try QR sharing first (files-based strategies)
              if (await tryShareWithQR()) { 
                try { log('Invite.share.success.qr') } catch {}
                shared = true
              } else {
                // Fallback to text-only sharing via Web Share API
                // @ts-ignore
                if ((navigator as any).share) {
                  try {
                    // @ts-ignore
                    await (navigator as any).share({ title: t('invite.connectTitle'), text: caption })
                    try { log('Invite.share.success.text') } catch {}
                    shared = true
                  } catch (e) {
                    console.log('Text-only share failed:', e)
                  }
                }
              }

              // Many apps drop captions when images are shared; copy caption for safety
              if (shared) {
                try { await navigator.clipboard.writeText(caption) } catch {}
              }

              // Always show the invite modal so the user can copy/share manually
              setInviteOpen(true)
              
            } catch (e: any) { 
              try { log(`Invite.share.error: ${e?.message||e}`) } catch {} 
              // On any error, open modal as fallback
              setInviteOpen(true)
            }
            }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconInvite size={18} /> <span className="btn-text">{t('actions.invite')}</span>
            </button>
            {CONFIG.LIVEKIT_ENABLED && (
              <button
                title={(t('actions.instantMeeting') as string) || 'Instant meeting link'}
                aria-label={(t('actions.instantMeeting') as string) || 'Instant meeting link'}
                onClick={async () => {
                  const { buildAppUrl } = await import('../services/url')
                  // Ensure we have an account so identity is stable
                  let sk = localStorage.getItem('nostr_sk')
                  if (!sk) {
                    const secret = generateSecretKey()
                    const hexd = bytesToHex(secret)
                    const pub = getPublicKey(secret)
                    localStorage.setItem('nostr_sk', hexd)
                    setMyPubkey(pub)
                    sk = hexd
                  }
                  const callId = `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
                  const link = buildAppUrl('', { call: callId })
                  try {
                    await navigator.clipboard.writeText(link)
                    emitToast(t('common.copied') || 'Copied link to clipboard', 'success')
                  } catch {
                    prompt(t('common.copyLink') || 'Copy this link', link)
                  }
                  // Optionally open the call immediately
                  setGlobalCallRoom(callId)
                  setGlobalCallOpen(true)
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <IconLink size={18} /> {(t('actions.instantMeeting') as string) || 'Instant meeting'}
              </button>
            )}
          <button aria-label={t('actions.settings')} title={t('actions.settings')} onClick={() => setSettingsOpen(true)}>⚙️</button>
        </div>
        </div>
        {updateAvailable && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderTop: '1px solid var(--border)', background: 'var(--card)', color: 'var(--fg)' }}>
            <span style={{ fontSize: 13 }}>{t('update.available')}{swVersion ? ` (${swVersion})` : ''}. {updateCountdown !== null ? t('update.countdown', { s: updateCountdown }) : ''}</span>
            <button onClick={async () => {
              try {
                const reg = await navigator.serviceWorker.getRegistration()
                if (reg?.waiting) {
                  reg.waiting.postMessage({ type: 'SKIP_WAITING' })
                  setTimeout(() => window.location.reload(), 200)
                } else {
                  window.location.reload()
                }
              } catch { window.location.reload() }
            }}>{t('update.now')}</button>
            <button onClick={() => { setUpdateAvailable(false); setUpdateCountdown(null) }} style={{ marginLeft: 'auto' }}>{t('common.dismiss')}</button>
          </div>
        )}
      </div>
      {/* Settings modal keeps Keys and Relays compact and out of the main layout */}
      {settingsOpen && (
        <Modal onClose={() => setSettingsOpen(false)}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>{t('settings.title')}</h3>
            <button onClick={() => setSettingsOpen(false)} aria-label={t('common.close')}>✖</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <details>
              <summary style={{ cursor: 'pointer', userSelect: 'none' }}>{t('settings.keys')}</summary>
              <div style={{ marginTop: 8 }}>
                <KeyManager />
              </div>
            </details>
            <details>
              <summary style={{ cursor: 'pointer', userSelect: 'none' }}>{t('settings.relays')}</summary>
              <div style={{ marginTop: 8 }}>
                <RelayManager />
              </div>
            </details>
            <details open>
              <summary style={{ cursor: 'pointer', userSelect: 'none' }}>{t('settings.preferences')}</summary>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={powMining} onChange={(e) => { setPowMining(e.target.checked); try { log(`Settings: powMining=${e.target.checked}`) } catch {} }} />
                  {t('settings.powMining')}
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 14, fontWeight: 500 }}>{t('actions.theme')}</label>
                  <select 
                    value={theme} 
                    onChange={(e) => applyTheme(e.target.value as any)}
                    style={{ 
                      padding: '8px 12px', 
                      borderRadius: '6px', 
                      border: '1px solid var(--border)', 
                      background: 'var(--bg)', 
                      color: 'var(--fg)',
                      fontSize: '14px'
                    }}
                  >
                    <option value="system">{t('theme.system')}</option>
                    <option value="light">{t('theme.light')}</option>
                    <option value="dark">{t('theme.dark')}</option>
                  </select>
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={!adsDisabled} onChange={(e) => setAdsDisabled(!e.target.checked)} />
                  {t('settings.showAds') || 'Show top banner' }
                </label>
                {!adsDisabled && ads.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 2 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('settings.manageAds') || 'Manage ads'}</div>
                    {ads.map(a => (
                      <label key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={!adDisabledIds.has(a.id)}
                          onChange={(e) => {
              {/* Global incoming call banner */}
              {incomingGlobalCall && (
                <div role="dialog" aria-live="assertive" style={{ position:'fixed', left: 16, right: 16, bottom: 24, zIndex: 3000, background: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, boxShadow: '0 10px 28px rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 18 }}>📞</div>
                  <div style={{ display:'grid' }}>
                    <div style={{ fontWeight: 600 }}>{t('call.incoming') || 'Incoming call'}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {(() => {
                        const from = incomingGlobalCall.from
                        const name = aliases[from]
                        return name ? `${name} (${from.slice(0,8)}…)` : `${from.slice(0,8)}…`
                      })()}
                    </div>
                  </div>
                  <div style={{ marginLeft:'auto', display:'inline-flex', gap:8 }}>
                    <button onClick={async () => {
                      const sk = localStorage.getItem('nostr_sk')
                      const peer = incomingGlobalCall.from
                      setIncomingGlobalCall(null)
                      // stop ringtone
                      try { ringtoneRef.current?.pause(); if (ringtoneRef.current) ringtoneRef.current.currentTime = 0 } catch {}
                      // Send call_accept so caller gets feedback
                      try { if (sk) await sendDM(sk, peer, { t: JSON.stringify({ type:'call_accept', room: incomingGlobalCall.room }) }) } catch {}
                      // Open call panel for provided room
                      setGlobalCallRoom(incomingGlobalCall.room)
                      setGlobalCallOpen(true)
                    }}>{t('call.accept') || 'Accept'}</button>
                    <button onClick={async () => {
                      const sk = localStorage.getItem('nostr_sk')
                      const peer = incomingGlobalCall.from
                      setIncomingGlobalCall(null)
                      try { ringtoneRef.current?.pause(); if (ringtoneRef.current) ringtoneRef.current.currentTime = 0 } catch {}
                      try { if (sk) await sendDM(sk, peer, { t: JSON.stringify({ type:'call_reject', room: incomingGlobalCall.room }) }) } catch {}
                    }}>{t('call.reject') || 'Reject'}</button>
                  </div>
                </div>
              )}
                            setAdDisabledIds(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) next.delete(a.id); else next.add(a.id)
                              persistAdDisabledIds(next)
                              return next
                            })
                            setAdIndex(0)
                          }}
                        />
                        <span style={{ maxWidth: 420, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.displayText}</span>
                      </label>
                    ))}
                    <div style={{ display: 'inline-flex', gap: 8 }}>
                      <button onClick={() => { setAdDisabledIds(new Set()); try { localStorage.removeItem('ads_disabled_ids') } catch {}; setAdIndex(0) }}>
                        {t('common.reset') || 'Reset'}
                      </button>
                      <button onClick={async () => { try { const items = await loadPreparedAds(locale, 'top'); setAds(items); setAdIndex(0) } catch {} }}>
                        {t('common.reload')}
                      </button>
                    </div>
                  </div>
                )}
                <button onClick={() => { try { localStorage.removeItem('onboarding_done') } catch {}; try { log('Onboarding: reset requested') } catch {}; window.location.reload() }}>{t('settings.onboardingAgain')}</button>
                <button onClick={() => { setLogAuth('required'); setLogModalOpen(true) }}>{t('settings.viewLog')}</button>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('settings.language')}</span>
                  <select value={locale} onChange={(e) => setLocale(e.target.value)}>
                    {availableLocales.map(l => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                </label>
                <BuildInfoRow />
                <UpdateSection />
              </div>
            </details>
          </div>
        </Modal>
      )}
      {logModalOpen && (
        <Modal onClose={() => { setLogModalOpen(false); setLogAuth('idle') }}>
          {logAuth !== 'granted' ? (
            <div>
              <h3 style={{ marginTop: 0 }}>{t('logs.unlockTitle')}</h3>
              <input type="password" placeholder={t('common.password')} id="log-pass" />
              <div style={{ display: 'inline-flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => {
                  const inp = (document.getElementById('log-pass') as HTMLInputElement | null)
                  const ok = inp && inp.value === '4522815'
                  if (ok) setLogAuth('granted'); else setLogAuth('denied')
                }}>{t('common.unlock')}</button>
                <button onClick={() => { setLogModalOpen(false); setLogAuth('idle') }}>{t('common.cancel')}</button>
              </div>
              {logAuth === 'denied' && (
                <div style={{ color: 'var(--danger, #d32f2f)', marginTop: 8 }}>{t('logs.incorrectPassword')}</div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>{t('logs.title')}</h3>
                <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)' }}>{t('logs.level')}</label>
                  <select value={logLevel} onChange={(e) => setLogLevel(e.target.value as any)}>
                    <option value="all">{t('logs.level.all')}</option>
                    <option value="info">{t('logs.level.info')}</option>
                    <option value="warn">{t('logs.level.warn')}</option>
                    <option value="error">{t('logs.level.error')}</option>
                  </select>
                  <button onClick={async () => {
                    try {
                      const text = (getLogs() || []).map(e => `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] ${e.msg}`).join('\n')
                      await navigator.clipboard.writeText(text)
                    } catch {}
                  }}>{t('common.copy')}</button>
                  <button onClick={async () => {
                    try {
                      const items = (getLogs() || []).filter(e => logLevel==='all' ? true : e.level===logLevel)
                      const text = items.map(e => `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] ${e.msg}`).join('\n')
                      await navigator.clipboard.writeText(text)
                    } catch {}
                  }}>{t('common.copyFiltered')}</button>
                  <button onClick={() => {
                    try {
                      const items = (getLogs() || [])
                      const text = items.map(e => `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] ${e.msg}`).join('\n')
                      const blob = new Blob([text], { type: 'text/plain' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `globgram-logs-${Date.now()}.txt`
                      document.body.appendChild(a)
                      a.click()
                      a.remove()
                      URL.revokeObjectURL(url)
                    } catch {}
                  }}>{t('common.download')}</button>
                  <button onClick={async () => {
                    try {
                      const text = await getPersistedLogsText('all')
                      const blob = new Blob([text], { type: 'text/plain' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `globgram-logs-all-${Date.now()}.txt`
                      document.body.appendChild(a)
                      a.click()
                      a.remove()
                      URL.revokeObjectURL(url)
                    } catch {}
                  }}>{t('common.downloadAllPersisted')}</button>
                  <button onClick={() => {
                    try {
                      const items = (getLogs() || []).filter(e => logLevel==='all' ? true : e.level===logLevel)
                      const text = items.map(e => `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] ${e.msg}`).join('\\n')
                      const blob = new Blob([text], { type: 'text/plain' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `globgram-logs-${logLevel}-${Date.now()}.txt`
                      document.body.appendChild(a)
                      a.click()
                      a.remove()
                      URL.revokeObjectURL(url)
                    } catch {}
                  }}>{t('common.downloadFiltered')}</button>
                  <button onClick={async () => { try { await clearPersistedLogs() } catch {} }}>{t('common.clearPersisted')}</button>
                  <button onClick={() => { try { clearLogs(); setLogTick(t => (t + 1) % 1_000_000) } catch {} }}>{t('common.clear')}</button>
                </div>
              </div>
              <div style={{ marginTop: 8, maxHeight: '60vh', overflow: 'auto', border: '1px solid var(--border)', padding: 8, borderRadius: 8, background: 'var(--card)' }}>
                {(getLogs() || []).filter(e => logLevel==='all' ? true : e.level===logLevel).map((e, i) => (
                  <div key={i} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, color: e.level==='error' ? '#d32f2f' : e.level==='warn' ? '#ed6c02' : 'var(--fg)' }}>
                    {new Date(e.ts).toLocaleTimeString()} [{e.level.toUpperCase()}] {e.msg}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}
      {inviteOpen && (
        <Modal onClose={() => setInviteOpen(false)}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 id="invite-modal-title" style={{ margin: 0 }}>{t('modal.invite.title')}</h3>
            <button onClick={() => setInviteOpen(false)} aria-label={t('common.close')}>✖</button>
          </div>
          <p id="invite-modal-desc" style={{ marginTop: 0 }}>{t('modal.invite.desc')}</p>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>{t('modal.invite.qrLabel')}</label>
              <canvas ref={inviteCanvasRef} width={200} height={200} style={{ borderRadius: 8, background: '#fff' }} />
              <div style={{ display: 'inline-flex', gap: 8, marginTop: 6 }}>
                <button onClick={async () => {
                  try {
                    const canvas = inviteCanvasRef.current
                    if (!canvas) return
                    const blob: Blob | null = await new Promise(resolve => { try { canvas.toBlob(b => resolve(b), 'image/png') } catch { resolve(null) } })
                    if (!blob) return
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `globgram-invite-${locale}.png`
                    document.body.appendChild(a)
                    a.click()
                    a.remove()
                    URL.revokeObjectURL(url)
                  } catch {}
                }}>{t('modal.invite.downloadQR')}</button>
                <button onClick={async () => {
                  try {
                    const canvas = inviteCanvasRef.current
                    if (!canvas) return
                    const blob: Blob | null = await new Promise(resolve => { try { canvas.toBlob(b => resolve(b), 'image/png') } catch { resolve(null) } })
                    if (!blob) return
                    // @ts-ignore ClipboardItem
                    if ('ClipboardItem' in window && (navigator.clipboard as any)?.write) {
                      // @ts-ignore
                      const item = new (window as any).ClipboardItem({ 'image/png': blob })
                      await (navigator.clipboard as any).write([item])
                      alert(t('invite.copied'))
                    }
                  } catch {}
                }}>{(() => { const l = t('modal.invite.copyQR') as string; return l && l !== 'modal.invite.copyQR' ? l : 'Copy QR' })()}</button>
              </div>
            </div>
            <div style={{ minWidth: 280, flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>{t('modal.invite.linkLabel')}</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="text" value={inviteUrl} readOnly style={{ flex: 1 }} onFocus={(e) => { try { (e.target as HTMLInputElement).select() } catch {} }} />
                <button onClick={async () => {
                  // Copy localized invite message + link, and include QR image when possible
                  const text = formatInviteCaption(getInviteMessage(), inviteUrl)
                  try {
                    const canvas = inviteCanvasRef.current
                    if (canvas && 'ClipboardItem' in window && (navigator.clipboard as any)?.write) {
                      const blob: Blob | null = await new Promise(resolve => { try { canvas.toBlob(b => resolve(b), 'image/png') } catch { resolve(null) } })
                      if (blob) {
                        const item = new (window as any).ClipboardItem({
                          'image/png': blob,
          'text/plain': new Blob([text], { type: 'text/plain' }),
                        })
                        await (navigator.clipboard as any).write([item])
                        alert(t('invite.copied'))
                        return
                      }
                    }
                    await navigator.clipboard.writeText(text)
                    alert(t('invite.copied'))
                 } catch { try { await navigator.clipboard.writeText(text) } catch {}; alert(t('invite.copied')) }
                }}>{t('common.copyLink')}</button>
              </div>
              {/* Read-only full caption (message + link) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {(() => { const l = t('modal.invite.captionText') as string; return l && l !== 'modal.invite.captionText' ? l : 'Invite text' })()}
                </label>
                <textarea
                  readOnly
                  rows={3}
                  value={formatInviteCaption(getInviteMessage(), inviteUrl)}
                  onFocus={(e) => { try { (e.target as HTMLTextAreaElement).select() } catch {} }}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>
              {/* Quick share targets */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(() => {
                  const caption = formatInviteCaption(getInviteMessage(), inviteUrl)
                  const encodedCaption = encodeURIComponent(caption)
                  const encodedUrl = encodeURIComponent(inviteUrl)
                  const subj = encodeURIComponent(String(t('invite.connectTitle') || 'Connect on GlobGram'))
                  const smsBody = encodedCaption
                  const links = {
                    wa: `https://wa.me/?text=${encodedCaption}`,
                    tg: `https://t.me/share/url?url=${encodedUrl}&text=${encodedCaption}`,
                    mail: `mailto:?subject=${subj}&body=${encodedCaption}`,
                    sms: `sms:?&body=${smsBody}`,
                  }
                  return (
                    <>
                      <a href={links.wa} target="_blank" rel="noopener noreferrer">
                        <button type="button">{(() => { const l = t('modal.invite.shareWhatsApp') as string; return l && l !== 'modal.invite.shareWhatsApp' ? l : 'Share via WhatsApp' })()}</button>
                      </a>
                      <a href={links.tg} target="_blank" rel="noopener noreferrer">
                        <button type="button">{(() => { const l = t('modal.invite.shareTelegram') as string; return l && l !== 'modal.invite.shareTelegram' ? l : 'Share via Telegram' })()}</button>
                      </a>
                      <a href={links.mail} target="_self">
                        <button type="button">{(() => { const l = t('modal.invite.shareEmail') as string; return l && l !== 'modal.invite.shareEmail' ? l : 'Share via Email' })()}</button>
                      </a>
                      {isMobile && (
                        <a href={links.sms} target="_self">
                          <button type="button">{(() => { const l = t('modal.invite.shareSMS') as string; return l && l !== 'modal.invite.shareSMS' ? l : 'Share via SMS' })()}</button>
                        </a>
                      )}
                    </>
                  )
                })()}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={async () => {
                  // Copy invite text + link + QR image when possible
                  const msg = formatInviteCaption(getInviteMessage(), inviteUrl)
                  try {
                    const canvas = inviteCanvasRef.current
                    if (canvas && 'ClipboardItem' in window && (navigator.clipboard as any)?.write) {
                      const blob: Blob | null = await new Promise(resolve => { try { canvas.toBlob(b => resolve(b), 'image/png') } catch { resolve(null) } })
                      if (blob) {
                        const item = new (window as any).ClipboardItem({
                          'image/png': blob,
                          'text/plain': new Blob([msg], { type: 'text/plain' }),
                        })
                        await (navigator.clipboard as any).write([item])
                        alert(t('invite.copied'))
                        return
                      }
                    }
                    await navigator.clipboard.writeText(msg)
                    alert(t('invite.copied'))
                  } catch { try { await navigator.clipboard.writeText(msg) } catch {}; alert(t('invite.copied')) }
                }}>{t('modal.invite.copyText')}</button>
                <button onClick={async () => {
                  const text = formatInviteCaption(getInviteMessage(), inviteUrl)
                  const canvas = inviteCanvasRef.current
                  
                  // Try Web Share API with multiple strategies
                  if ((navigator as any).share && canvas) {
                    try {
                      const blob: Blob | null = await new Promise(resolve => { 
                        try { 
                          canvas.toBlob(b => resolve(b), 'image/png') 
                        } catch { 
                          resolve(null) 
                        } 
                      })
                      
                      if (blob) {
                        const file = new File([blob], `globgram-invite-${locale}.png`, { type: 'image/png' })
                        
                        // Strategy 1: Try files with text
                        try {
                          const dataWithText = { files: [file], text, title: t('invite.connectTitle') }
                          if ((navigator as any).canShare && (navigator as any).canShare(dataWithText)) {
                            await (navigator as any).share(dataWithText)
                            return
                          }
                        } catch (e) {
                          console.log('Files+text share failed:', e)
                        }
                        
                        // Strategy 2: Try files only, then copy text separately
                        try {
                          const dataFilesOnly = { files: [file], title: t('invite.connectTitle') }
                          if ((navigator as any).canShare && (navigator as any).canShare(dataFilesOnly)) {
                            await (navigator as any).share(dataFilesOnly)
                            // Copy text to clipboard as backup
                            try {
                              await navigator.clipboard.writeText(text)
                            } catch {}
                            return
                          }
                        } catch (e) {
                          console.log('Files-only share failed:', e)
                        }
                      }
                      
                      // Strategy 3: Text-only fallback
                      try {
                        await (navigator as any).share({ title: t('invite.connectTitle'), text })
                        return
                      } catch (e) {
                        console.log('Text-only share failed:', e)
                      }
                    } catch (e) {
                      console.log('Web Share API failed:', e)
                    }
                  }
                  
                  // Clipboard fallback: try to copy both image and text
                  try {
                    if (canvas && 'ClipboardItem' in window && (navigator.clipboard as any)?.write) {
                      const blob: Blob | null = await new Promise(resolve => { 
                        try { 
                          canvas.toBlob(b => resolve(b), 'image/png') 
                        } catch { 
                          resolve(null) 
                        } 
                      })
                      if (blob) {
                        const item = new (window as any).ClipboardItem({
                          'image/png': blob,
                          'text/plain': new Blob([text], { type: 'text/plain' }),
                        })
                        await (navigator.clipboard as any).write([item])
                        alert(t('invite.copied'))
                        return
                      }
                    }
                    // Text-only clipboard fallback
                    await navigator.clipboard.writeText(text)
                    alert(t('invite.copied'))
                  } catch {
                    // Final fallback - just copy text
                    try { 
                      await navigator.clipboard.writeText(text) 
                    } catch {}
                    alert(t('invite.copied'))
                  }
                }}>{t('modal.invite.shareAll')}</button>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {/* Mobile-first single-pane with tabs and list drawers */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', padding: 16, gap: 10 }}>
          <NostrEngine />
          <div role="tablist" aria-label={t('tabs.main')} style={{ display: 'flex', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 999, padding: 4 }}>
            <button role="tab" aria-selected={activeTab==='chats'} onClick={() => { setActiveTab('chats'); setRoomDrawerOpen(false) }} style={{ flex: 1, borderRadius: 999, padding: '8px 12px', background: activeTab==='chats'? 'var(--accent)' : 'transparent', color: activeTab==='chats'? '#fff':'var(--fg)', border: 'none' }}>{t('tabs.chats')}</button>
            <button role="tab" aria-selected={activeTab==='rooms'} onClick={() => { setActiveTab('rooms'); setChatDrawerOpen(false) }} style={{ flex: 1, borderRadius: 999, padding: '8px 12px', background: activeTab==='rooms'? 'var(--accent)' : 'transparent', color: activeTab==='rooms'? '#fff':'var(--fg)', border: 'none' }}>{t('tabs.rooms')}</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 8, overflow: 'hidden', position: 'relative', height: 0 }}>
            {activeTab === 'chats' ? (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
                <div className="sticky-top" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px', borderBottom: '1px solid var(--border)', background: 'var(--card)' }}>
                  <button ref={chatButtonRef} title={t('tabs.showChats')} aria-label={t('tabs.showChatsList')} onClick={() => setChatDrawerOpen(true)}>☰</button>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>{t('tabs.chats')}</div>
                </div>
                <div style={{ flex: 1, minHeight: 0, height: 0 }}>
                  <Suspense fallback={<div className="app-loading" style={{ padding: 16, textAlign: 'center' }}><Logo size={56} animated /><div className="hint">{t('loading.chat')}</div></div>}>
                    <ChatWindowLazy />
                  </Suspense>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
                <div className="sticky-top" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px', borderBottom: '1px solid var(--border)', background: 'var(--card)' }}>
                  <button ref={roomButtonRef} title={t('tabs.showRooms')} aria-label={t('tabs.showRoomsList')} onClick={() => setRoomDrawerOpen(true)}>☰</button>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>{t('tabs.rooms')}</div>
                </div>
                <div style={{ flex: 1, minHeight: 0, height: 0 }}>
                  <Suspense fallback={<div className="app-loading" style={{ padding: 16, textAlign: 'center' }}><Logo size={56} animated /><div className="hint">{t('loading.room')}</div></div>}>
                    <RoomWindowLazy />
                  </Suspense>
                </div>
              </div>
            )}
            {/* Chat drawer */}
            {chatDrawerOpen && (
              <div role="dialog" aria-label={t('tabs.chats')} onClick={() => { setClosing('chat'); setTimeout(() => { setChatDrawerOpen(false); setClosing('none'); chatButtonRef.current?.focus() }, 160) }} className={`drawer-overlay ${closing==='chat' ? 'closing' : ''}`} style={{ position: 'absolute', inset: 0, display: 'flex' }}>
                <div
                  onClick={(e) => e.stopPropagation()}
                  onTouchStart={(e) => { const t = e.touches[0]; chatSwipeRef.current = { x: t.clientX, y: t.clientY, active: true } }}
                  onTouchMove={(e) => {
                    if (!chatSwipeRef.current.active) return
                    const t = e.touches[0]
                    const dx = t.clientX - chatSwipeRef.current.x
                    const dy = t.clientY - chatSwipeRef.current.y
                    if (dx > 70 && Math.abs(dy) < 50) {
                      chatSwipeRef.current.active = false
                      setClosing('chat')
                      setTimeout(() => { setChatDrawerOpen(false); setClosing('none'); chatButtonRef.current?.focus() }, 160)
                    }
                  }}
                  className={`drawer-panel ${closing==='chat' ? 'closing' : ''}`}
                  style={{ width: '82vw', maxWidth: 360, height: '100%', background: 'var(--card)', borderRight: '1px solid var(--border)', boxShadow: '2px 0 12px rgba(0,0,0,0.2)' }}
                >
                  <ChatList onCollapse={() => setChatDrawerOpen(false)} />
                </div>
              </div>
            )}
            {/* Room drawer */}
            {roomDrawerOpen && (
              <div role="dialog" aria-label={t('tabs.rooms')} onClick={() => { setClosing('room'); setTimeout(() => { setRoomDrawerOpen(false); setClosing('none'); roomButtonRef.current?.focus() }, 160) }} className={`drawer-overlay ${closing==='room' ? 'closing' : ''}`} style={{ position: 'absolute', inset: 0, display: 'flex' }}>
                <div
                  onClick={(e) => e.stopPropagation()}
                  onTouchStart={(e) => { const t = e.touches[0]; roomSwipeRef.current = { x: t.clientX, y: t.clientY, active: true } }}
                  onTouchMove={(e) => {
                    if (!roomSwipeRef.current.active) return
                    const t = e.touches[0]
                    const dx = t.clientX - roomSwipeRef.current.x
                    const dy = t.clientY - roomSwipeRef.current.y
                    if (dx > 70 && Math.abs(dy) < 50) {
                      roomSwipeRef.current.active = false
                      setClosing('room')
                      setTimeout(() => { setRoomDrawerOpen(false); setClosing('none'); roomButtonRef.current?.focus() }, 160)
                    }
                  }}
                  className={`drawer-panel ${closing==='room' ? 'closing' : ''}`}
                  style={{ width: '82vw', maxWidth: 360, height: '100%', background: 'var(--card)', borderRight: '1px solid var(--border)', boxShadow: '2px 0 12px rgba(0,0,0,0.2)' }}
                >
                  <RoomList onCollapse={() => setRoomDrawerOpen(false)} />
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        // Desktop/tablet split view
        <div style={{ display: 'flex', flex: 1, border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 8, overflow: 'hidden', margin: 16, minHeight: 0 }}>
          <NostrEngine />
          <div style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }}>
            <div style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }}>
              {chatListOpen ? (
                <ChatList onCollapse={() => { setChatListOpen(false); setTimeout(() => chatHandleRef.current?.focus(), 0) }} />
              ) : (
                <div style={{ width: 44, borderRight: '1px solid var(--border)', background: 'var(--card)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <button ref={chatHandleRef} title={`${t('tabs.showChats')} (Alt+1)`} aria-keyshortcuts="Alt+1" aria-label={t('tabs.showChatsList')} aria-controls="chatListNav" aria-expanded={false} onClick={() => { setChatListOpen(true); setTimeout(() => (document.querySelector('#chatListNav input') as HTMLInputElement | null)?.focus(), 0) }}>☰</button>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>Alt+1</span>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <Suspense fallback={<div className="app-loading" style={{ padding: 16, textAlign: 'center' }}><Logo size={64} animated /><div className="hint">{t('loading.chat')}</div></div>}>
                  <ChatWindowLazy />
                </Suspense>
              </div>
            </div>
            <div style={{ width: 1, background: 'var(--border)' }} />
            <div style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }}>
              {roomListOpen ? (
                <RoomList onCollapse={() => { setRoomListOpen(false); setTimeout(() => roomHandleRef.current?.focus(), 0) }} />
              ) : (
                <div style={{ width: 44, borderRight: '1px solid var(--border)', background: 'var(--card)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <button ref={roomHandleRef} title={`${t('tabs.showRooms')} (Alt+2)`} aria-keyshortcuts="Alt+2" aria-label={t('tabs.showRoomsList')} aria-controls="roomListNav" aria-expanded={false} onClick={() => { setRoomListOpen(true); setTimeout(() => (document.querySelector('#roomListNav input') as HTMLInputElement | null)?.focus(), 0) }}>☰</button>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>Alt+2</span>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <Suspense fallback={<div className="app-loading" style={{ padding: 16, textAlign: 'center' }}><Logo size={64} animated /><div className="hint">{t('loading.room')}</div></div>}>
                  <RoomWindowLazy />
                </Suspense>
              </div>
            </div>
          </div>
        </div>
      )}
    {isMobile && (
        <div style={{ position: 'fixed', right: 16, bottom: 120, zIndex: 50, transform: 'scale(0.5)', transformOrigin: 'bottom right' }}>
      <div className={`fab-menu ${fabOpen ? '' : 'hidden'}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8, alignItems: 'flex-end' }}>
              <button onClick={async () => {
                setFabOpen(false)
                const input = (prompt(t('fab.newChatPrompt')!) || '').trim()
                if (!input) return
                const hex = parseInviteInput(input)
                if (!hex) { alert(t('errors.invalidPubkey')); return }
                selectPeer(hex)
              }} aria-label={t('fab.startNewChat')} style={{ background: 'var(--accent)', color: '#fff' }}>+ {t('fab.newChat')}</button>
        {CONFIG.LIVEKIT_ENABLED && (
                <button onClick={async () => {
                  setFabOpen(false)
                  // Generate a shareable call id and link
                  const callId = `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          const { buildAppUrl } = await import('../services/url')
          const link = buildAppUrl('', { call: callId })
                  try {
                    await navigator.clipboard.writeText(link)
                    emitToast(t('common.copied') || 'Copied link to clipboard', 'success')
                  } catch {
                    prompt(t('common.copyLink') || 'Copy this link', link)
                  }
                  // Optionally start the call now
                  setGlobalCallRoom(callId)
                  setGlobalCallOpen(true)
                }} aria-label={t('fab.createCall') || 'Create call'} style={{ background: 'var(--accent)', color: '#fff' }}>+ {(t('fab.createCall') || 'New call')}</button>
              )}
              <button onClick={async () => {
                setFabOpen(false)
                const name = prompt(t('fab.roomNameOptional')!) || undefined
                const about = prompt(t('fab.aboutOptional')!) || undefined
                const picture = undefined
                const sk = localStorage.getItem('nostr_sk')
                if (!sk) { alert(t('errors.noKey')); return }
                const id = await createRoom(sk, { name, about, picture })
                selectRoom(id)
              }} aria-label={t('fab.createNewRoom')} style={{ background: 'var(--accent)', color: '#fff' }}>+ {t('fab.newRoom')}</button>
            </div>
          <button aria-label={t('fab.openActions')} onClick={() => { if (navigator.vibrate) try { navigator.vibrate(10) } catch {}; setFabOpen(v => !v) }} style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--accent)', color: '#fff', border: 'none', boxShadow: '0 6px 16px rgba(0,0,0,0.2)', fontSize: 22 }}>＋</button>
        </div>
      )}
    {/* Global CallPanel overlay (deep-link / FAB) */}
    {CONFIG.LIVEKIT_ENABLED && (
      <CallPanel
        open={globalCallOpen}
        roomName={globalCallRoom || 'call'}
        identity={myPubkey || (localStorage.getItem('anon_id') || (() => { const v = 'guest-' + Math.random().toString(36).slice(2, 8); try { localStorage.setItem('anon_id', v) } catch {} return v })())}
        onClose={() => { setGlobalCallOpen(false); setGlobalCallRoom(null) }}
    onEnded={async (info) => {
          try {
      if (!info.hadConnected || info.iAmLeader === false) return
            const start = info.startedAt ? new Date(info.startedAt) : null
            const end = info.endedAt ? new Date(info.endedAt) : new Date()
            const durMs = info.durationMs ?? (start ? (end.getTime() - start.getTime()) : undefined)
            const durSec = durMs != null ? Math.round(durMs / 1000) : undefined
            const durFmt = durSec != null ? (
              durSec >= 3600 ? `${Math.floor(durSec/3600)}h ${Math.floor((durSec%3600)/60)}m ${durSec%60}s` : durSec >= 60 ? `${Math.floor(durSec/60)}m ${durSec%60}s` : `${durSec}s`
            ) : 'unknown'
            const reason = info.reason ? ` (${info.reason})` : ''
            const plist = (info.participants || []).map(p => (String(p).slice(0,8) + '…')).join(', ')
            const body = `📞 Call summary${reason}\nRoom: ${info.room}\nParticipants: ${plist || 'n/a'}\nStarted: ${start ? start.toLocaleString() : 'n/a'}\nEnded: ${end.toLocaleString()}\nDuration: ${durFmt}`
            const sk = localStorage.getItem('nostr_sk')
            if (sk) {
              const sent = new Set<string>()
              // If the global call corresponds to currently selected DM peer, DM them
              const peer = useChatStore.getState().selectedPeer
              if (peer) { await sendDM(sk, peer, { t: body }).catch(()=>{}); sent.add(peer) }
              // DM all other participants (exclude self)
              const mine = myPubkey || ''
              for (const p of (info.participants || [])) {
                const to = String(p || '')
                if (!to || to === mine || sent.has(to)) continue
                await sendDM(sk, to, { t: body }).catch(()=>{})
                sent.add(to)
              }
            }
          } catch {}
        }}
      />
    )}
    </div>
    </ToastProvider>
  )
}

function BuildInfoRow() {
  // Show SW version if available via postMessage elsewhere in App
  const [swVer, setSwVer] = useState<string | null>(null)
  useEffect(() => {
    let mounted = true
    try {
      navigator.serviceWorker?.getRegistration?.().then(reg => {
        if (!mounted || !reg) return
        // Request version from SW if active
        reg.active?.postMessage?.({ type: 'GET_VERSION' })
      }).catch(()=>{})
    } catch {}
    const onMsg = (e: MessageEvent) => {
      if (e?.data?.type === 'VERSION') setSwVer(String(e.data.version || ''))
    }
    try { navigator.serviceWorker?.addEventListener?.('message', onMsg) } catch {}
    return () => { mounted = false; try { navigator.serviceWorker?.removeEventListener?.('message', onMsg) } catch {} }
  }, [])
  return (
    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
      <span>Build: {BUILD_INFO.shortSha} {BUILD_INFO.refName} {new Date(BUILD_INFO.date).toLocaleString()}</span>
      <span> · Mode: {BUILD_INFO.mode} · Base: {BUILD_INFO.base}</span>
      {swVer ? <span> · SW: {swVer}</span> : null}
    </div>
  )
}

function UpdateSection() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [release, setRelease] = useState<GithubRelease | null>(null)

  // Current "version": prefer a semver-like refName (e.g., v3.9.5); else fall back to 0.0.0
  const current = (BUILD_INFO.refName && /^v?\d+\.\d+\.\d+/.test(BUILD_INFO.refName)) ? BUILD_INFO.refName : 'v0.0.0'

  const owner = 'tayden1990'
  const repo = 'GlobGram-alpha-v2.0.0'

  useEffect(() => {
    let mounted = true
    setLoading(true)
    checkLatestRelease(owner, repo)
      .then((r: GithubRelease) => { if (mounted) setRelease(r) })
      .catch((e: any) => { if (mounted) setError(String(e?.message || e)) })
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  const latestTag = release?.tag_name || null
  const hasUpdate = latestTag ? semverGreater(latestTag, current) : false

  const openUrl = (u?: string) => { if (u) window.open(u, '_blank') }

  // Best-effort platform asset pickers
  const assets: GithubAsset[] = (release?.assets ?? []) as any
  const findAsset = (match: RegExp) => assets.find((a: GithubAsset) => match.test(a.name))
  const winAsset = findAsset(/win32|windows|\.exe$|\.zip$/i)
  const apkAsset = findAsset(/\.apk$/i)
  const aabAsset = findAsset(/\.aab$/i)

  const isStandalone = (() => {
    try { return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone } catch { return false }
  })()
  const isElectron = /Electron/i.test(navigator.userAgent)

  const tryPwaUpdateNow = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      await reg?.update()
      // If a new worker installed and waiting, activate it
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        setTimeout(() => window.location.reload(), 250)
      } else {
        // Force reload to pick up any cached assets if update landed
        window.location.reload()
      }
    } catch {
      window.location.reload()
    }
  }

  // Signing info comes from build-time env if provided
  const signing = (import.meta as any).env?.VITE_SIGNING_FINGERPRINT || ''

  // Translation with safe fallback (avoid showing raw i18n keys)
  const tf = (key: string, fb: string) => {
    const v = (t(key) as string) || ''
    return v && v !== key ? v : fb
  }

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{tf('settings.appInfo', 'App info')}</div>
      <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div>{tf('settings.currentVersion', 'Current')}: <code>{current}</code></div>
        <div>{tf('settings.latestVersion', 'Latest')}: <code>{latestTag || (loading ? tf('common.loading', 'Loading…') : '—')}</code></div>
        <div>{tf('settings.platform', 'Platform')}: <code>{isElectron ? 'Desktop (Electron/Nativefier)' : isStandalone ? 'PWA (standalone)' : 'Web (browser tab)'}</code></div>
        <div>{tf('settings.signing', 'Signing')}: <code>{signing || tf('settings.signingUnknown', 'Not available in this build')}</code></div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {hasUpdate ? (
          <>
            {isStandalone && (
              <button onClick={tryPwaUpdateNow}>{tf('settings.updateNowPwa', 'Update PWA now')}</button>
            )}
            <button onClick={() => openUrl(release?.html_url)}>{tf('settings.openRelease', 'Open latest release')}</button>
            {apkAsset ? <button onClick={() => openUrl(apkAsset.browser_download_url)}>{tf('settings.downloadApk', 'Download APK')}</button> : null}
            {aabAsset ? <button onClick={() => openUrl(aabAsset.browser_download_url)}>{tf('settings.downloadAab', 'Download AAB')}</button> : null}
            {winAsset ? <button onClick={() => openUrl(winAsset.browser_download_url)}>{tf('settings.downloadWindows', 'Download for Windows')}</button> : null}
          </>
        ) : (
          <>
            <button onClick={() => openUrl(release?.html_url)} disabled={!release}>{tf('settings.openRelease', 'Open latest release')}</button>
            {isStandalone && <button onClick={tryPwaUpdateNow}>{tf('settings.checkForUpdates', 'Check for updates')}</button>}
          </>
        )}
      </div>
      {!loading && !error && release && !hasUpdate ? (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>{tf('settings.upToDate', 'You are up to date.')}</div>
      ) : null}
      {error ? <div style={{ marginTop: 6, fontSize: 12, color: 'tomato' }}>{tf('settings.updateError', 'Failed to check updates')}: {String(error)}</div> : null}
    </div>
  )
}

// Lightweight inline modal component to keep settings small and unobtrusive
function Modal({ children, onClose }: { children: any; onClose: () => void }) {
  const btnRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
  try { document.body.classList.add('modal-open') } catch {}
  return () => { window.removeEventListener('keydown', onKey); try { document.body.classList.remove('modal-open') } catch {} }
  }, [onClose])
  return (
  <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: '92vw', maxWidth: 520, maxHeight: '80vh', overflow: 'auto', padding: 12, background: 'var(--card)', color: 'var(--fg)' }}>
        {children}
      </div>
    </div>
  )
}

// Robust invite parser -> 64-hex pubkey
function parseInviteToHex(input: string): string | null {
  if (!input) return null
  let s = input.trim()

  try {
    const u = new URL(s)
    const cand = u.searchParams.get('invite') || u.searchParams.get('npub') || u.searchParams.get('pubkey') || ''
    if (cand) s = cand
  } catch {}

  s = s.replace(/^nostr:/i, '').replace(/^web\+nostr:/i, '')
  const m = s.match(/(npub1[02-9ac-hj-np-z]{6,}|nprofile1[02-9ac-hj-np-z]{6,}|[0-9a-fA-F]{64})/)
  if (!m) return null
  const token = m[1]

  if (/^[0-9a-fA-F]{64}$/.test(token)) return token.toLowerCase()

  try {
    const dec = nip19.decode(token)
    if (dec.type === 'npub') return String(dec.data)
    if (dec.type === 'nprofile') return String((dec.data as any)?.pubkey || '')
  } catch {}
  return null
}
