import { KeyManager } from '../wallet'
import { ChatList, NostrEngine, RelayManager, RoomList } from '.'
import { ToastProvider } from './Toast'
import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useIsMobile } from './useIsMobile'
import { useChatStore } from '../state/chatStore'
import { useRoomStore } from '../state/roomStore'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { hexToBytes } from '../nostr/utils'
import { bytesToHex } from '../nostr/utils'
import { createRoom, refreshSubscriptions, sendDM } from '../nostr/engine'
import { useSettingsStore } from './settingsStore'
// Lazy-load QRCode only when needed to reduce initial bundle size

const ChatWindowLazy = lazy(() => import('.').then(m => ({ default: m.ChatWindow })))
const RoomWindowLazy = lazy(() => import('.').then(m => ({ default: m.RoomWindow })))

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
  const [installStatus, setInstallStatus] = useState<'idle'|'accepted'|'dismissed'|'installed'>('idle')
  // SW version/update state
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [swVersion, setSwVersion] = useState<string | null>(null)

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
    }
    const onInstalled = () => {
      setInstallStatus('installed')
      setInstallAvailable(false)
    }
    window.addEventListener('beforeinstallprompt', onBip as any)
    window.addEventListener('appinstalled', onInstalled as any)
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
          if (nw.state === 'installed' && navigator.serviceWorker.controller) setUpdateAvailable(true)
        })
      })
    }).catch(()=>{})
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMsg as any)
    }
  }, [])

  // Handle invite links: ?invite=<npub|hex>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const invite = params.get('invite')
    if (!invite) return
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
      }
      // Send hello DM and focus chat
      try {
        // slight delay to allow engine to start
        setTimeout(async () => {
          await sendDM(sk!, inviterHex, { t: 'Hi, I am here from now' })
          selectPeer(inviterHex)
          localStorage.setItem(ackKey, '1')
        }, 400)
      } catch {}
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
  return (
    <ToastProvider>
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
                  <button disabled={!installAvailable} title={installAvailable? 'Install the app' : 'Install prompt not available yet'} onClick={async () => {
                    const prompt = installPromptRef.current
                    if (!prompt) { setInstallStatus('idle'); return }
                    try {
                      prompt.prompt()
                      const choice = await prompt.userChoice
                      if (choice?.outcome === 'accepted') setInstallStatus('accepted')
                      else setInstallStatus('dismissed')
                    } catch {}
                  }}>Install app</button>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {installStatus === 'idle' && (installAvailable ? 'Ready to install' : 'Waiting for install prompt…')}
                    {installStatus === 'accepted' && 'Install accepted'}
                    {installStatus === 'dismissed' && 'Install dismissed'}
                    {installStatus === 'installed' && 'Installed ✓'}
                  </span>
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
        <h1 style={{ margin: 0, fontSize: 22 }}>GlobGram Alpha</h1>
        {/* <span style={{ color: 'var(--muted)' }}>Decentralized DMs over Nostr</span> */}
        <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <button title="Share invite" onClick={async () => {
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
              // @ts-ignore - Web Share API optional
              if (navigator.share) {
                // @ts-ignore
                await navigator.share({ title: 'Connect on GlobGram', text: 'Join me on GlobGram. Tap the link to start a secure chat.', url: link })
              }
            } catch {}
          }}>Connect safely with your friend</button>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>Theme</label>
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
            <span style={{ fontSize: 13 }}>A new version is available{swVersion ? ` (${swVersion})` : ''}.</span>
            <button onClick={async () => {
              try {
                const reg = await navigator.serviceWorker.getRegistration()
                if (reg?.waiting) {
                  // Tell waiting SW to activate
                  reg.waiting.postMessage({ type: 'SKIP_WAITING' })
                  // Wait a tick then reload
                  setTimeout(() => window.location.reload(), 250)
                } else {
                  window.location.reload()
                }
              } catch { window.location.reload() }
            }}>Update</button>
            <button onClick={() => setUpdateAvailable(false)} style={{ marginLeft: 'auto' }}>Dismiss</button>
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
                  <input type="checkbox" checked={powMining} onChange={(e) => setPowMining(e.target.checked)} />
                  Enable PoW mining (for relays that require NIP-13)
                </label>
                <button onClick={() => { try { localStorage.removeItem('onboarding_done') } catch {}; window.location.reload() }}>Run onboarding again</button>
              </div>
            </details>
          </div>
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
                    // @ts-ignore
                    if (navigator.share) {
                      // @ts-ignore
                      await navigator.share({ title: 'Connect on GlobGram', text: 'Join me on GlobGram. Tap the link to start a secure chat.', url: inviteUrl })
                    }
                  } catch {}
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
                  <Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
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
                  <Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
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
                <Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
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
                <Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
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
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: '92vw', maxWidth: 520, maxHeight: '80vh', overflow: 'auto', padding: 12, background: 'var(--card)', color: 'var(--fg)' }}>
        {children}
      </div>
    </div>
  )
}
