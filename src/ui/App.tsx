import { KeyManager } from '../wallet'
import { ChatList } from './ChatList'
import { NostrEngine } from './NostrEngine'
import { RelayManager } from './RelayManager'
import { RoomList } from './RoomList'
import { ToastProvider } from './Toast'
import Logo from './Logo'
import Splash from './Splash'
import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useIsMobile } from './useIsMobile'
import { useChatStore } from '../state/chatStore'
import { useRoomStore } from '../state/roomStore'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { hexToBytes } from '../nostr/utils'
import { bytesToHex } from '../nostr/utils'
import { createRoom, refreshSubscriptions, sendDM } from '../nostr/engine'
import { useSettingsStore } from './settingsStore'
import { getLogs, clearLogs, onLog, log, setLogMinLevel, getPersistedLogsText, clearPersistedLogs } from './logger'
// Lazy-load QRCode only when needed to reduce initial bundle size

const ChatWindowLazy = lazy(() => import('./ChatWindow').then(m => ({ default: m.ChatWindow })))
const RoomWindowLazy = lazy(() => import('./RoomWindow').then(m => ({ default: m.RoomWindow })))

export default function App() {
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

  // apply theme
  const applyTheme = (t: 'system'|'light'|'dark') => {
    setTheme(t)
    localStorage.setItem('theme', t)
    const root = document.documentElement
    if (t === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', t)
  }

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

  // Handle invite links: ?invite=<npub|hex>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const invite = params.get('invite')
    if (!invite) return
    try { log(`Invite.detect ${invite.slice(0, 64)}`) } catch {}
    // Clean URL
    try { window.history.replaceState({}, '', window.location.pathname + window.location.hash) } catch {}
    (async () => {
      // Ensure we only act once per inviter
      let inviterHex = invite
      try {
        if (invite.startsWith('npub')) {
          const dec = nip19.decode(invite)
          inviterHex = typeof dec.data === 'string' ? dec.data : bytesToHex(dec.data as Uint8Array)
        }
      } catch {}
      if (!/^[0-9a-fA-F]{64}$/.test(inviterHex)) return
      const ackKey = `invite_ack_${inviterHex}`
      if (localStorage.getItem(ackKey)) return
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
      // Send hello DM and focus chat
      try {
        // slight delay to allow engine to start
        setTimeout(async () => {
          try { log(`Invite.helloDM -> ${inviterHex.slice(0, 12)}…`) } catch {}
          await sendDM(sk!, inviterHex, { t: 'Hi, I am here from now' })
          selectPeer(inviterHex)
          localStorage.setItem(ackKey, '1')
        }, 400)
      } catch (e: any) { try { log(`Invite.error: ${e?.message||e}`) } catch {} }
    })()
  }, [])

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
          try { window.location.reload() } catch {}
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
          try { window.location.reload() } catch {}
        }
      }
    }, 2500)
    return () => { window.removeEventListener('panel-ready', onReady as any); window.clearTimeout(t1); window.clearTimeout(t2); window.clearInterval(poll) }
  }, [selectedRoom])
  return (
    <ToastProvider>
      <Splash />
      {/* Onboarding overlay */}
      {onboardingOpen && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: 'min(720px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 10px 32px rgba(0,0,0,0.35)', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Welcome to GlobGram</h2>
              <button onClick={() => setOnboardingOpen(false)} aria-label="Close">✖</button>
            </div>
            {obStep === 0 && (
              <div>
                <h3>Step 1 — Notifications</h3>
                <p>Allow notifications to get message alerts.</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={async () => {
                    try {
                      // @ts-ignore
                      if (!('Notification' in window)) { setNotifStatus('unsupported'); return }
                      // @ts-ignore
                      const r = await Notification.requestPermission()
                      setNotifStatus(r === 'granted' ? 'granted' : 'denied')
                    } catch { setNotifStatus('unsupported') }
                  }}>Allow notifications</button>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {notifStatus === 'idle' && 'Not requested yet'}
                    {notifStatus === 'granted' && 'Granted'}
                    {notifStatus === 'denied' && 'Denied'}
                    {notifStatus === 'unsupported' && 'Not supported'}
                  </span>
                  <div style={{ marginLeft: 'auto' }}>
                    <button onClick={() => setObStep(1)}>Next →</button>
                  </div>
                </div>
              </div>
            )}
            {obStep === 1 && (
              <div>
                <h3>Step 2 — Microphone</h3>
                <p>Enable microphone to record voice notes.</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={async () => {
                    try {
                      if (!navigator.mediaDevices?.getUserMedia) { setMicStatus('unsupported'); return }
                      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                      try { stream.getTracks().forEach(t => t.stop()) } catch {}
                      setMicStatus('granted')
                    } catch { setMicStatus('denied') }
                  }}>Allow microphone</button>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {micStatus === 'idle' && 'Not requested yet'}
                    {micStatus === 'granted' && 'Granted'}
                    {micStatus === 'denied' && 'Denied'}
                    {micStatus === 'unsupported' && 'Not supported'}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                    <button onClick={() => setObStep(0)}>← Back</button>
                    <button onClick={() => setObStep(2)}>Next →</button>
                  </div>
                </div>
              </div>
            )}
            {obStep === 2 && (
              <div>
                <h3>Step 3 — Camera</h3>
                <p>Enable camera to take photos and record videos.</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={async () => {
                    try {
                      if (!navigator.mediaDevices?.getUserMedia) { setCamStatus('unsupported'); return }
                      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
                      try { stream.getTracks().forEach(t => t.stop()) } catch {}
                      setCamStatus('granted')
                    } catch { setCamStatus('denied') }
                  }}>Allow camera</button>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {camStatus === 'idle' && 'Not requested yet'}
                    {camStatus === 'granted' && 'Granted'}
                    {camStatus === 'denied' && 'Denied'}
                    {camStatus === 'unsupported' && 'Not supported'}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                    <button onClick={() => setObStep(1)}>← Back</button>
                    <button onClick={() => setObStep(3)}>Next →</button>
                  </div>
                </div>
              </div>
            )}
            {obStep === 3 && (
              <div>
                <h3>Step 4 — Your key</h3>
                <p>Generate a new key or import an existing one (hex or nsec). It stays in your browser.</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={() => {
                    const secret = generateSecretKey()
                    const hexd = bytesToHex(secret)
                    const pub = getPublicKey(secret)
                    try { localStorage.setItem('nostr_sk', hexd) } catch {}
                    setMyPubkey(pub)
                    setKeyReady(true)
                  }}>Generate new key</button>
                  <button onClick={() => keyFileRef.current?.click()}>Import from file…</button>
                  <input ref={keyFileRef} type="file" accept=".txt,.json,.key" style={{ display: 'none' }} onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    try {
                      const txt = await f.text()
                      let sk = txt.trim()
                      try {
                        const j = JSON.parse(txt)
                        if (typeof j?.sk === 'string') sk = j.sk.trim()
                      } catch {}
                      if (sk.startsWith('nsec')) {
                        try {
                          const dec = nip19.decode(sk)
                          const data = dec.data as Uint8Array
                          sk = bytesToHex(data)
                        } catch {}
                      }
                      if (!/^[0-9a-fA-F]{64}$/.test(sk)) { alert('Invalid key format. Provide 64-char hex or nsec.'); return }
                      const pub = getPublicKey(hexToBytes(sk))
                      try { localStorage.setItem('nostr_sk', sk) } catch {}
                      setMyPubkey(pub)
                      setKeyReady(true)
                    } catch {
                      alert('Failed to read key file')
                    } finally {
                      try { (e.target as HTMLInputElement).value = '' } catch {}
                    }
                  }} />
                  {keyReady ? <span style={{ color: 'var(--muted)', fontSize: 12 }}>Key ready ✓</span> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>No key yet</span> }
                  <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                    <button onClick={() => setObStep(2)}>← Back</button>
                    <button disabled={!keyReady} onClick={() => setObStep(4)}>Next →</button>
                  </div>
                </div>
              </div>
            )}
            {obStep === 4 && (
              <div>
                <h3>Step 5 — Install the app</h3>
                <p>Install GlobGram to your device for a faster, more app-like experience.</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    disabled={!installAvailable || isStandalone}
                    title={isStandalone ? 'Already installed' : (installAvailable ? 'Install the app' : 'Install prompt not available yet')}
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
                  >Install app</button>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {isStandalone && 'Installed ✓'}
                    {!isStandalone && installStatus === 'idle' && (installAvailable ? 'Ready to install' : 'Waiting for install prompt…')}
                    {installStatus === 'prompting' && 'Showing prompt…'}
                    {installStatus === 'accepted' && 'Install accepted'}
                    {installStatus === 'dismissed' && 'Install dismissed'}
                    {installStatus === 'installed' && 'Installed ✓'}
                  </span>
                  {installError && (
                    <div style={{ color: 'var(--danger, #e57373)', fontSize: 12 }}>
                      {installError}
                    </div>
                  )}
                  {!installAvailable && (
                    <div style={{ width: '100%', color: 'var(--muted)', fontSize: 12 }}>
                      <div>Tip: the install prompt appears when the app meets PWA criteria. Try these:</div>
                      <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                        <li>Reload once so the service worker takes control.</li>
                        <li>Use HTTPS or localhost; avoid private windows.</li>
                        <li>Not already installed and opened in app mode.</li>
                        <li>
                          {(() => {
                            const ua = navigator.userAgent.toLowerCase()
                            const isiOS = /iphone|ipad|ipod/.test(ua)
                            const isChromium = /chrome|edg|crios/.test(ua)
                            if (isiOS) return 'On iOS Safari: Share → Add to Home Screen.'
                            if (isChromium) return 'On Chrome/Edge desktop: click the “Install” icon in the address bar.'
                            return 'Use your browser menu to Install/Add to Home Screen.'
                          })()}
                        </li>
                      </ul>
                      <div style={{ marginTop: 6 }}>
                        <button onClick={() => {
                          try { navigator.serviceWorker.controller?.postMessage({ type: 'GET_VERSION' }) } catch {}
                          navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.update().catch(()=>{}))).catch(()=>{})
                        }}>Check again</button>
                        <button onClick={() => window.location.reload()} style={{ marginLeft: 8 }}>Reload</button>
                      </div>
                      <div style={{ marginTop: 6, opacity: 0.8 }}>
                        Readiness: {isSecureContext ? 'secure' : 'insecure'} · SW: {navigator.serviceWorker?.controller ? 'controlled' : 'no controller yet'} ·
                        BIP: {bipCapturedAt ? new Date(bipCapturedAt).toLocaleTimeString() : 'not yet'}
                      </div>
                    </div>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                    <button onClick={() => setObStep(3)}>← Back</button>
                    <button onClick={() => setObStep(5)}>Next →</button>
                  </div>
                </div>
              </div>
            )}
            {obStep === 5 && (
              <div>
                <h3>Step 6 — Quick guide</h3>
                <ul>
                  <li>Use “Connect safely with your friend” to share an invite link or QR.</li>
                  <li>Start a chat and send text or media; press Enter to send (Shift+Enter for new line).</li>
                  <li>Optionally encrypt media with a passphrase for extra protection.</li>
                  <li>Statuses: ⏳ Sending, ✓ Sent, ✓✓ Delivered. Retry on failures.</li>
                  <li>On mobile, only the conversation area scrolls; header/footer stay pinned.</li>
                </ul>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={() => setObStep(4)}>← Back</button>
                  <button onClick={() => { try { localStorage.setItem('onboarding_done', '1') } catch {}; setOnboardingOpen(false) }}>Finish</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    <div style={{ fontFamily: 'system-ui, sans-serif', height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', overflow: 'hidden' }}>
      <div className="sticky-top" style={{ display: 'flex', flexDirection: 'column', gap: 0, borderBottom: '1px solid var(--border)', background: 'var(--card)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <Logo size={28} animated title="GlobGram" />
          <h1 style={{ margin: 0, fontSize: 16 }}>GlobGram Alpha</h1>
        </div>
        {/* <span style={{ color: 'var(--muted)' }}>Decentralized DMs over Nostr</span> */}
        <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <button title="Invite a friend" aria-label="Invite a friend" onClick={async () => {
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
            // Build invite URL with my npub
            const pk = useChatStore.getState().myPubkey
            if (!pk) return
            const npub = nip19.npubEncode(pk)
            const base = (import.meta as any).env?.BASE_URL || '/'
            const link = `${window.location.origin}${base}?invite=${encodeURIComponent(npub)}`
            setInviteUrl(link)
            setInviteOpen(true)
            try {
              const message = 'Join me on GlobGram. Tap the link to start a secure chat.'
              // @ts-ignore - Web Share API optional
              if (navigator.share) {
              try { log('Invite.share.attempt') } catch {}
              // Some platforms hide `text` when `url` is present. Try both, then fallback to text+link.
              const payloads: any[] = [
                { title: 'Chat with me on GlobGram', text: message, url: link },
                { title: 'Chat with me on GlobGram', text: `${message}\n${link}` },
              ]
              let shared = false
              for (const p of payloads) {
                try {
                const can = (navigator as any).canShare ? (navigator as any).canShare(p) : true
                if (can) { await (navigator as any).share(p); shared = true; break }
                } catch {
                // try next payload
                }
              }
              if (!shared) {
                try { await navigator.clipboard.writeText(`${message}\n${link}`) } catch {}
                alert('Invite text copied to clipboard.')
              } else {
                try { log('Invite.share.success') } catch {}
              }
              } else {
              try { await navigator.clipboard.writeText(`${message}\n${link}`) } catch {}
              try { log('Invite.share.unsupported') } catch {}
              alert('Invite text copied to clipboard.')
              }
            } catch (e: any) { try { log(`Invite.share.error: ${e?.message||e}`) } catch {} }
            }}>Invite a friend</button>
          <label style={{ fontSize: 8, color: 'var(--muted)' }}>Theme</label>
          <select value={theme} onChange={(e) => applyTheme(e.target.value as any)}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <button aria-label="Open settings" title="Settings" onClick={() => setSettingsOpen(true)}>⚙️</button>
        </div>
        </div>
        {updateAvailable && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderTop: '1px solid var(--border)', background: 'var(--card)', color: 'var(--fg)' }}>
            <span style={{ fontSize: 13 }}>A new version is available{swVersion ? ` (${swVersion})` : ''}. {updateCountdown !== null ? `Updating in ${updateCountdown}s…` : ''}</span>
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
            }}>Update now</button>
            <button onClick={() => { setUpdateAvailable(false); setUpdateCountdown(null) }} style={{ marginLeft: 'auto' }}>Dismiss</button>
          </div>
        )}
      </div>
      {/* Settings modal keeps Keys and Relays compact and out of the main layout */}
      {settingsOpen && (
        <Modal onClose={() => setSettingsOpen(false)}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Settings</h3>
            <button onClick={() => setSettingsOpen(false)} aria-label="Close settings">✖</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <details>
              <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Keys</summary>
              <div style={{ marginTop: 8 }}>
                <KeyManager />
              </div>
            </details>
            <details>
              <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Relays</summary>
              <div style={{ marginTop: 8 }}>
                <RelayManager />
              </div>
            </details>
            <details open>
              <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Preferences</summary>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={powMining} onChange={(e) => { setPowMining(e.target.checked); try { log(`Settings: powMining=${e.target.checked}`) } catch {} }} />
                  Enable PoW mining (for relays that require NIP-13)
                </label>
                <button onClick={() => { try { localStorage.removeItem('onboarding_done') } catch {}; try { log('Onboarding: reset requested') } catch {}; window.location.reload() }}>Run onboarding again</button>
                <button onClick={() => { setLogAuth('required'); setLogModalOpen(true) }}>View log</button>
              </div>
            </details>
          </div>
        </Modal>
      )}
      {logModalOpen && (
        <Modal onClose={() => { setLogModalOpen(false); setLogAuth('idle') }}>
          {logAuth !== 'granted' ? (
            <div>
              <h3 style={{ marginTop: 0 }}>Unlock logs</h3>
              <p style={{ marginTop: 0 }}>Enter password to view logs.</p>
              <input type="password" placeholder="Password" id="log-pass" />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => {
                  const inp = (document.getElementById('log-pass') as HTMLInputElement | null)
                  const ok = inp && inp.value === '4522815'
                  if (ok) setLogAuth('granted'); else setLogAuth('denied')
                }}>Unlock</button>
                <button onClick={() => { setLogModalOpen(false); setLogAuth('idle') }}>Cancel</button>
              </div>
              {logAuth === 'denied' && (<div style={{ color: 'var(--danger, #d32f2f)', marginTop: 8 }}>Incorrect password.</div>)}
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>Logs</h3>
                <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)' }}>Level</label>
                  <select value={logLevel} onChange={(e) => setLogLevel(e.target.value as any)}>
                    <option value="all">All</option>
                    <option value="info">Info</option>
                    <option value="warn">Warn</option>
                    <option value="error">Error</option>
                  </select>
                  <button onClick={async () => {
                    try {
                      const text = (getLogs() || []).map(e => `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] ${e.msg}`).join('\n')
                      await navigator.clipboard.writeText(text)
                    } catch {}
                  }}>Copy</button>
                  <button onClick={async () => {
                    try {
                      const items = (getLogs() || []).filter(e => logLevel==='all' ? true : e.level===logLevel)
                      const text = items.map(e => `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] ${e.msg}`).join('\n')
                      await navigator.clipboard.writeText(text)
                    } catch {}
                  }}>Copy filtered</button>
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
                  }}>Download</button>
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
                  }}>Download all (persisted)</button>
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
                  }}>Download filtered</button>
                  <button onClick={async () => { try { await clearPersistedLogs() } catch {} }}>Clear persisted</button>
                  <button onClick={() => { try { clearLogs(); setLogTick(t => (t + 1) % 1_000_000) } catch {} }}>Clear</button>
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
            <h3 style={{ margin: 0 }}>Invite a friend</h3>
            <button onClick={() => setInviteOpen(false)} aria-label="Close">✖</button>
          </div>
          <p style={{ marginTop: 0 }}>Scan or share this link to connect directly with you:</p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <canvas ref={inviteCanvasRef} width={200} height={200} style={{ borderRadius: 8, background: '#fff' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
              <input readOnly value={inviteUrl} style={{ width: '100%' }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={async () => { try { await navigator.clipboard.writeText(inviteUrl); } catch {} }}>Copy link</button>
                <button onClick={async () => {
                  try {
                    const message = 'Join me on GlobGram. Tap the link to start a secure chat.'
                    // @ts-ignore
                    if (navigator.share) {
                      try { log('InviteModal.share.attempt') } catch {}
                      const payloads: any[] = [
                        { title: 'Connect on GlobGram', text: message, url: inviteUrl },
                        { title: 'Connect on GlobGram', text: `${message}\n${inviteUrl}` },
                      ]
                      let shared = false
                      for (const p of payloads) {
                        try {
                          const can = (navigator as any).canShare ? (navigator as any).canShare(p) : true
                          if (can) { await (navigator as any).share(p); shared = true; break }
                        } catch {
                          // try next
                        }
                      }
                      if (!shared) {
                        try { await navigator.clipboard.writeText(`${message}\n${inviteUrl}`) } catch {}
                        alert('Invite text copied to clipboard.')
                      } else {
                        try { log('InviteModal.share.success') } catch {}
                      }
                    } else {
                      try { await navigator.clipboard.writeText(`${message}\n${inviteUrl}`) } catch {}
                      try { log('InviteModal.share.unsupported') } catch {}
                      alert('Invite text copied to clipboard.')
                    }
                  } catch (e: any) { try { log(`InviteModal.share.error: ${e?.message||e}`) } catch {} }
                }}>Share…</button>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {/* Mobile-first single-pane with tabs and list drawers */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', padding: 16, gap: 10 }}>
          <NostrEngine />
          <div role="tablist" aria-label="Main sections" style={{ display: 'flex', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 999, padding: 4 }}>
            <button role="tab" aria-selected={activeTab==='chats'} onClick={() => { setActiveTab('chats'); setRoomDrawerOpen(false) }} style={{ flex: 1, borderRadius: 999, padding: '8px 12px', background: activeTab==='chats'? 'var(--accent)' : 'transparent', color: activeTab==='chats'? '#fff':'var(--fg)', border: 'none' }}>Chats</button>
            <button role="tab" aria-selected={activeTab==='rooms'} onClick={() => { setActiveTab('rooms'); setChatDrawerOpen(false) }} style={{ flex: 1, borderRadius: 999, padding: '8px 12px', background: activeTab==='rooms'? 'var(--accent)' : 'transparent', color: activeTab==='rooms'? '#fff':'var(--fg)', border: 'none' }}>Rooms</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 8, overflow: 'hidden', position: 'relative', height: 0 }}>
            {activeTab === 'chats' ? (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
                <div className="sticky-top" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px', borderBottom: '1px solid var(--border)', background: 'var(--card)' }}>
                  <button ref={chatButtonRef} title="Show chats" aria-label="Show chats list" onClick={() => setChatDrawerOpen(true)}>☰</button>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>Chats</div>
                </div>
                <div style={{ flex: 1, minHeight: 0, height: 0 }}>
                  <Suspense fallback={<div className="app-loading" style={{ padding: 16, textAlign: 'center' }}><Logo size={56} animated /><div className="hint">Loading chat…</div></div>}>
                    <ChatWindowLazy />
                  </Suspense>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
                <div className="sticky-top" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px', borderBottom: '1px solid var(--border)', background: 'var(--card)' }}>
                  <button ref={roomButtonRef} title="Show rooms" aria-label="Show rooms list" onClick={() => setRoomDrawerOpen(true)}>☰</button>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>Rooms</div>
                </div>
                <div style={{ flex: 1, minHeight: 0, height: 0 }}>
                  <Suspense fallback={<div className="app-loading" style={{ padding: 16, textAlign: 'center' }}><Logo size={56} animated /><div className="hint">Loading room…</div></div>}>
                    <RoomWindowLazy />
                  </Suspense>
                </div>
              </div>
            )}
            {/* Chat drawer */}
            {chatDrawerOpen && (
              <div role="dialog" aria-label="Chats" onClick={() => { setClosing('chat'); setTimeout(() => { setChatDrawerOpen(false); setClosing('none'); chatButtonRef.current?.focus() }, 160) }} className={`drawer-overlay ${closing==='chat' ? 'closing' : ''}`} style={{ position: 'absolute', inset: 0, display: 'flex' }}>
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
              <div role="dialog" aria-label="Rooms" onClick={() => { setClosing('room'); setTimeout(() => { setRoomDrawerOpen(false); setClosing('none'); roomButtonRef.current?.focus() }, 160) }} className={`drawer-overlay ${closing==='room' ? 'closing' : ''}`} style={{ position: 'absolute', inset: 0, display: 'flex' }}>
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
                  <button ref={chatHandleRef} title="Show chats (Alt+1)" aria-keyshortcuts="Alt+1" aria-label="Show chats list" aria-controls="chatListNav" aria-expanded={false} onClick={() => { setChatListOpen(true); setTimeout(() => (document.querySelector('#chatListNav input') as HTMLInputElement | null)?.focus(), 0) }}>☰</button>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>Alt+1</span>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <Suspense fallback={<div className="app-loading" style={{ padding: 16, textAlign: 'center' }}><Logo size={64} animated /><div className="hint">Loading chat…</div></div>}>
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
                  <button ref={roomHandleRef} title="Show rooms (Alt+2)" aria-keyshortcuts="Alt+2" aria-label="Show rooms list" aria-controls="roomListNav" aria-expanded={false} onClick={() => { setRoomListOpen(true); setTimeout(() => (document.querySelector('#roomListNav input') as HTMLInputElement | null)?.focus(), 0) }}>☰</button>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>Alt+2</span>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <Suspense fallback={<div className="app-loading" style={{ padding: 16, textAlign: 'center' }}><Logo size={64} animated /><div className="hint">Loading room…</div></div>}>
                  <RoomWindowLazy />
                </Suspense>
              </div>
            </div>
          </div>
        </div>
      )}
    {isMobile && (
        <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 50 }}>
      <div className={`fab-menu ${fabOpen ? '' : 'hidden'}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8, alignItems: 'flex-end' }}>
              <button onClick={async () => {
                setFabOpen(false)
                let pk = prompt('New chat: enter pubkey hex or npub') || ''
                pk = pk.trim()
                if (!pk) return
                try {
                  if (pk.startsWith('npub')) {
                    const dec = nip19.decode(pk)
                    pk = typeof dec.data === 'string' ? dec.data : bytesToHex(dec.data as Uint8Array)
                  }
                } catch {}
                if (!/^[0-9a-fA-F]{64}$/.test(pk)) { alert('Invalid pubkey'); return }
                selectPeer(pk)
              }} aria-label="Start new chat" style={{ background: 'var(--accent)', color: '#fff' }}>+ New chat</button>
              <button onClick={async () => {
                setFabOpen(false)
                const name = prompt('Room name (optional)') || undefined
                const about = prompt('About (optional)') || undefined
                const picture = undefined
                const sk = localStorage.getItem('nostr_sk')
                if (!sk) { alert('No key'); return }
                const id = await createRoom(sk, { name, about, picture })
                selectRoom(id)
              }} aria-label="Create new room" style={{ background: 'var(--accent)', color: '#fff' }}>+ New room</button>
            </div>
          <button aria-label="Open quick actions" onClick={() => { if (navigator.vibrate) try { navigator.vibrate(10) } catch {}; setFabOpen(v => !v) }} style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--accent)', color: '#fff', border: 'none', boxShadow: '0 6px 16px rgba(0,0,0,0.2)', fontSize: 22 }}>＋</button>
        </div>
      )}
    </div>
    </ToastProvider>
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
