import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LiveKitRoom, useRoomContext } from '@livekit/components-react';
import type { Room } from 'livekit-client';
import { fetchLiveKitToken } from '../livekit/token';
import { CONFIG } from '../config';
import { emitToast } from './Toast';
import SimpleConference from './SimpleConference';
import { CallErrorBoundary } from './CallErrorBoundary';
// LiveKit scenario-based configs
const livekitConfigs = {
  general: {
    connectOptions: {
      autoSubscribe: true,
      maxRetries: 3,
      peerConnectionTimeout: 15000,
      rtcConfig: {
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
        ],
        iceTransportPolicy: 'all',
      },
    },
    roomOptions: {
      adaptiveStream: true,
      dynacast: false,
      videoCaptureDefaults: {
        resolution: { width: 960, height: 540 },
        frameRate: 15,
        facingMode: 'user',
        advanced: [{ degradationPreference: 'balanced' }],
      },
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      publishDefaults: {
        red: true,
        dtx: true,
        simulcast: false,
        videoCodec: 'vp8',
        simulcastLayers: [
          { rid: 'f', scaleResolutionDownBy: 1.0, maxBitrate: 1_200_000 },
          { rid: 'h', scaleResolutionDownBy: 2.0, maxBitrate: 600_000 },
          { rid: 'q', scaleResolutionDownBy: 4.0, maxBitrate: 200_000 },
        ],
        videoEncoding: { maxBitrate: 900_000, maxFramerate: 30 },
        screenShareEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 },
        audioBitrate: 32000,
        audioStereo: false,
      },
      stopMicTrackOnMute: true,
      disconnectOnPageLeave: false,
    },
  },
  low: {
    connectOptions: {},
    roomOptions: {
      videoCaptureDefaults: { resolution: { width: 640, height: 360 }, frameRate: 15 },
      publishDefaults: {
        videoEncoding: { maxBitrate: 400_000, maxFramerate: 15 },
        screenShareEncoding: { maxBitrate: 800_000, maxFramerate: 15 },
        audioBitrate: 24000,
        simulcastLayers: [
          { rid: 'f', scaleResolutionDownBy: 1.0, maxBitrate: 400_000 },
          { rid: 'q', scaleResolutionDownBy: 4.0, maxBitrate: 100_000 },
        ],
      },
    },
  },
  high: {
    connectOptions: {},
    roomOptions: {
      videoCaptureDefaults: { resolution: { width: 1280, height: 720 }, frameRate: 30 },
      publishDefaults: {
        videoCodec: 'vp9',
        videoEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
        screenShareEncoding: { maxBitrate: 5_000_000, maxFramerate: 30 },
        audioBitrate: 48000,
        audioStereo: true,
      },
    },
  },
  mobile: {
    connectOptions: {},
    roomOptions: {
      videoCaptureDefaults: { resolution: { width: 640, height: 360 }, frameRate: 24 },
      publishDefaults: {
        videoEncoding: { maxBitrate: 800_000, maxFramerate: 24 },
        screenShareEncoding: { maxBitrate: 1_500_000, maxFramerate: 15 },
      },
      stopMicTrackOnMute: true,
      stopCameraTrackOnMute: true,
    },
  },
}


type Props = {
  roomName: string
  identity: string
  open: boolean
  onClose: () => void
  // Optional: notify parent when a call session ends (after having connected at least once)
  onEnded?: (info: { startedAt?: number; endedAt?: number; durationMs?: number; identity: string; room: string; reason?: string; hadConnected: boolean; participants?: string[]; leader?: string; iAmLeader?: boolean }) => void
}

export function CallPanel({ roomName, identity, open, onClose, onEnded }: Props) {
  const [qualityMode, setQualityMode] = useState<'general'|'low'|'high'|'mobile'>('general');
  const room = useMemo(() => {
    const prefix = (CONFIG.LIVEKIT_ROOM_PREFIX || 'globgram').trim()
    return prefix ? `${prefix}-${roomName}` : roomName
  }, [roomName])

  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle'|'fetching-token'|'connecting'|'connected'|'disconnected'|'error'>('idle')
  const [logs, setLogs] = useState<string[]>([])
  const [showDebug, setShowDebug] = useState(false)
  const [connectKey, setConnectKey] = useState(0) // force remount to reconnect

  // Add global error handler for LiveKit WebRTC errors
  useEffect(() => {
    const originalConsoleError = console.error;
    console.error = (...args) => {
      const message = args.join(' ');
      // Suppress known harmless LiveKit cleanup errors
      if (message.includes('removeTrack') || 
          message.includes('RTCRtpSender') ||
          message.includes('could not removeTrack')) {
        console.warn('[LiveKit Cleanup Warning]:', ...args);
        return;
      }
      originalConsoleError(...args);
    };

    // Global unhandled error suppression for specific LiveKit errors
    const handleError = (event: ErrorEvent) => {
      if (event.error?.message?.includes('removeTrack') ||
          event.error?.message?.includes('RTCRtpSender')) {
        event.preventDefault();
        console.warn('[LiveKit Error Suppressed]:', event.error);
        return false;
      }
    };

    window.addEventListener('error', handleError);

    return () => {
      console.error = originalConsoleError;
      window.removeEventListener('error', handleError);
    };
  }, []);
  const [tokenMeta, setTokenMeta] = useState<{ iss?: string; sub?: string; room?: string } | null>(null)
  const [checkRunning, setCheckRunning] = useState(false)
  const [checkResult, setCheckResult] = useState<any>(null)
  const [checkAutoDone, setCheckAutoDone] = useState(false)
  const [lkRoom, setLkRoom] = useState<Room | null>(null)
  const [micOn, setMicOn] = useState<boolean | null>(null)
  const [camOn, setCamOn] = useState<boolean | null>(null)
  const [screenOn, setScreenOn] = useState<boolean | null>(null)
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([])
  const [selectedOutput, setSelectedOutput] = useState<string | ''>('')
  const pttActiveRef = useRef(false)
  const pttPrevMicRef = useRef<boolean | null>(null)
  // Legacy pin/layout removed; SimpleConference provides the UI
  // Track call lifecycle for summary
  const startedAtRef = useRef<number | null>(null)
  const endedSentRef = useRef(false)
  const hadConnectedRef = useRef(false)
  const participantsRef = useRef<Set<string>>(new Set())
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Helper component to bind LiveKit Room from context when inside LiveKitRoom
  function RoomBinder({ onReady }: { onReady: (room: Room | null) => void }) {
    const ctxRoom = useRoomContext() as unknown as Room | undefined
    useEffect(() => {
      onReady(ctxRoom ?? null)
    }, [ctxRoom])
    return null
  }

  const addLog = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString()
    setLogs(l => [...l, `[${ts}] ${line}`].slice(-300))
    try { console.log('[CallPanel]', line) } catch {}
  }, [])

  // Helper to emit onEnded once
  const emitEndedOnce = useCallback((reason?: string) => {
    if (endedSentRef.current) return
    endedSentRef.current = true
    const startedAt = startedAtRef.current || undefined
    const endedAt = Date.now()
    const durationMs = startedAt ? Math.max(0, endedAt - startedAt) : undefined
    const plist = Array.from(participantsRef.current)
    const leader = plist.length ? plist.slice().sort((a,b)=>a.localeCompare(b))[0] : undefined
    const iAmLeader = leader ? (leader === identity) : true
    try {
      onEnded?.({ startedAt, endedAt, durationMs, identity, room, reason, hadConnected: hadConnectedRef.current, participants: plist, leader, iAmLeader })
    } catch {}
  }, [identity, room, onEnded])

  useEffect(() => {
    let stop = false
    async function run() {
      if (!open) return
      setStatus('idle')
      setError(null)
      setToken(null)
      if (!CONFIG.LIVEKIT_ENABLED) { setError('LiveKit disabled'); addLog('LiveKit disabled via config'); setStatus('error'); return }
      if (!CONFIG.LIVEKIT_WS_URL) { setError('LIVEKIT_WS_URL not set'); addLog('Missing LIVEKIT_WS_URL'); setStatus('error'); return }
      try {
        setStatus('fetching-token')
        addLog(`Fetching token for identity="${identity}" room="${room}"`)
        const t = await fetchLiveKitToken(identity, room)
        if (!stop) {
          setToken(t)
          addLog('Token fetched successfully')
          setStatus('connecting')
          // Decode token payload for debugging (iss=sub=apiKey/id, sub=identity, grants room)
          try {
            const parts = t.split('.')
            if (parts.length >= 2) {
              const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0))))
              const grantRoom = payload?.video?.room || payload?.grants?.room || undefined
              setTokenMeta({ iss: payload?.iss, sub: payload?.sub, room: grantRoom })
              addLog(`Token meta iss=${payload?.iss || '?'} sub=${payload?.sub || '?'} room=${grantRoom || '?'} `)
            }
          } catch (e) {
            addLog('Token decode failed')
          }
        }
      } catch (e: any) {
        const msg = e?.message || 'Failed to get token'
        if (!stop) { setError(msg); setStatus('error') }
        addLog(`Token error: ${msg}`)
      }
    }
    run()
    return () => { stop = true }
  }, [open, identity, room])

  // Build Worker /check URL based on token endpoint and WS URL
  const buildCheckUrl = useCallback(() => {
    try {
      if (!CONFIG.LIVEKIT_TOKEN_ENDPOINT) return null
      const u = new URL(CONFIG.LIVEKIT_TOKEN_ENDPOINT)
      u.pathname = u.pathname.replace(/\/token$/, '/check')
      u.search = ''
      if (CONFIG.LIVEKIT_WS_URL) u.searchParams.set('ws', CONFIG.LIVEKIT_WS_URL)
      return u.toString()
    } catch {
      return null
    }
  }, [])

  const runPreflight = useCallback(async (auto = false) => {
    const url = buildCheckUrl()
    if (!url) { addLog('Preflight: token endpoint not set'); return }
    try {
      setCheckRunning(true)
      setCheckResult(null)
      addLog(`Preflight: GET ${url}`)
      const res = await fetch(url, { credentials: 'omit' })
      const body = await res.json().catch(async () => ({ raw: await res.text() }))
      const result = { ok: body?.ok === true, status: res.status, host: body?.host, body }
      setCheckResult(result)
      addLog(`Preflight: ${result.ok ? 'OK' : 'FAIL'} status=${res.status} host=${result.host || '?'} `)
      if (result.ok) emitToast?.('LiveKit keys match host', 'success')
      else emitToast?.('LiveKit key/host check failed', 'error')
    } catch (e: any) {
      setCheckResult({ ok: false, error: e?.message || String(e) })
      addLog(`Preflight error: ${e?.message || e}`)
    } finally {
      setCheckRunning(false)
      if (auto) setCheckAutoDone(true)
    }
  }, [buildCheckUrl, addLog])

  // Auto-run preflight once on specific auth errors
  useEffect(() => {
    const err = (error || '').toLowerCase()
    if (status === 'error' && !checkAutoDone && (err.includes('invalid api key') || err.includes('authentication'))) {
      runPreflight(true)
    }
  }, [status, error, checkAutoDone, runPreflight])

  // Helpers to infer local participant media states
  const refreshLocalStates = useCallback(() => {
    try {
      const room = lkRoom as any
      const lp = room?.localParticipant
      if (!lp) return
      const pubs: any[] = Array.from(lp?.trackPublications?.values?.() || [])
      const micPub = pubs.find(p => String(p?.source || '').toLowerCase().includes('micro'))
      const camPub = pubs.find(p => String(p?.source || '').toLowerCase().includes('camera'))
      const scrPub = pubs.find(p => String(p?.source || '').toLowerCase().includes('screen'))
      setMicOn(micPub ? !micPub.isMuted : null)
      setCamOn(camPub ? !camPub.isMuted : null)
      setScreenOn(scrPub ? !scrPub.isMuted : null)
    } catch {}
  }, [lkRoom])

  // Observe room/participant events to keep UI in sync
  useEffect(() => {
    if (!lkRoom) return
    refreshLocalStates()
    const lp: any = (lkRoom as any).localParticipant
    if (!lp) return
    const onMuted = () => refreshLocalStates()
    const onUnmuted = () => refreshLocalStates()
    try {
      lp.on?.('trackMuted', onMuted)
      lp.on?.('trackUnmuted', onUnmuted)
      lp.on?.('trackPublished', refreshLocalStates)
      lp.on?.('trackUnpublished', refreshLocalStates)
    } catch {}
    return () => {
      try {
        lp.off?.('trackMuted', onMuted)
        lp.off?.('trackUnmuted', onUnmuted)
        lp.off?.('trackPublished', refreshLocalStates)
        lp.off?.('trackUnpublished', refreshLocalStates)
      } catch {}
    }
  }, [lkRoom, refreshLocalStates])

  // Track participants join/leave for summary and pinning
  useEffect(() => {
    if (!lkRoom) return
    function addP(p: any) { try { if (p?.identity) participantsRef.current.add(String(p.identity)) } catch {} }
    function delP(p: any) { try { if (p?.identity) participantsRef.current.delete(String(p.identity)) } catch {} }
    try {
      // seed current
      participantsRef.current.clear()
      const lp: any = (lkRoom as any).localParticipant
      if (lp?.identity) participantsRef.current.add(String(lp.identity))
      const parts: any[] = Array.from((lkRoom as any)?.participants?.values?.() || [])
      for (const p of parts) addP(p)
      // subscribe
      ;(lkRoom as any).on?.('participantConnected', addP)
      ;(lkRoom as any).on?.('participantDisconnected', delP)
    } catch {}
    return () => {
      try {
        ;(lkRoom as any).off?.('participantConnected', addP)
        ;(lkRoom as any).off?.('participantDisconnected', delP)
      } catch {}
    }
  }, [lkRoom])

  // Enumerate audio output devices (speakers) after connect
  useEffect(() => {
    let stopped = false
    async function loadOutputs() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (stopped) return
        const outs = devices.filter(d => d.kind === 'audiooutput')
        setAudioOutputs(outs)
      } catch (e) {
        addLog('Enumerate devices failed (audiooutput)')
      }
    }
    if (lkRoom) loadOutputs()
    return () => { stopped = true }
  }, [lkRoom, addLog])

  // Push-to-talk: hold Space to unmute mic, release to restore
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!lkRoom || status !== 'connected') return
      if (e.code !== 'Space') return
      // skip when typing in inputs
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as any).isContentEditable)) return
      if (pttActiveRef.current) return
      pttActiveRef.current = true
      ;(async () => {
        try {
          const lp: any = (lkRoom as any).localParticipant
          const pubs: any[] = Array.from(lp?.trackPublications?.values?.() || [])
          const micPub = pubs.find(p => String(p?.source || '').toLowerCase().includes('micro'))
          const isOn = micPub ? !micPub.isMuted : false
          pttPrevMicRef.current = isOn
          if (!isOn) {
            await lp.setMicrophoneEnabled(true)
            setMicOn(true)
            addLog('PTT: mic temporary unmuted')
          }
        } catch (err: any) {
          emitToast?.(`Push-to-talk failed: ${err?.message || err}`, 'error')
        }
      })()
    }
    function onKeyUp(e: KeyboardEvent) {
      if (!lkRoom || status !== 'connected') return
      if (e.code !== 'Space') return
      if (!pttActiveRef.current) return
      pttActiveRef.current = false
      ;(async () => {
        try {
          const lp: any = (lkRoom as any).localParticipant
          if (pttPrevMicRef.current === false) {
            await lp.setMicrophoneEnabled(false)
            setMicOn(false)
            addLog('PTT: mic restored to muted')
          }
        } catch (err: any) {
          emitToast?.(`Push-to-talk restore failed: ${err?.message || err}`, 'error')
        } finally {
          pttPrevMicRef.current = null
        }
      })()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [lkRoom, status, addLog])

  if (!open) return null
  return (
    <div role="dialog" aria-modal className="call-panel-overlay" style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 99999, display: 'flex', alignItems: 'stretch', justifyContent: 'stretch' }}>
      <div ref={panelRef as any} className="call-panel" style={{ width: '100vw', height: '100vh', background: '#0b0b0c', color: '#fff', borderRadius: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
  {/* Top/status bars removed for a minimal, clean UI */}

        {showDebug && (
          <div style={{ padding: 12, background: '#0e0e11', color: '#bbb', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12, maxHeight: 160, overflow: 'auto', borderBottom: '1px solid #222' }}>
            <div style={{ marginBottom: 6 }}>
              <strong>Token meta:</strong> iss={tokenMeta?.iss || '?'} · sub={tokenMeta?.sub || '?'} · grant.room={tokenMeta?.room || '?'}
            </div>
            {logs.length === 0 ? <div>No logs yet.</div> : logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}

  {/* Legacy inline controls removed; in-video toolbar is used */}

        {error && (
          <div style={{ padding: 12, color: '#f88', fontSize: 14 }}>
            Error: {error}
            {String(error).toLowerCase().includes('invalid api key') && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#faa' }}>
                Hint: The server URL and the token's API key must belong to the same LiveKit project. Ensure your Worker secrets (LIVEKIT_API_KEY/SECRET) match the project for {CONFIG.LIVEKIT_WS_URL}, and re-deploy the Worker.
              </div>
            )}
            {checkResult && (
              <div style={{ marginTop: 8, padding: 8, background: '#1a1212', border: '1px solid #442', borderRadius: 6, color: '#f5bbbb' }}>
                <div><strong>Preflight:</strong> {checkResult.ok ? 'OK' : 'FAILED'} {checkResult.status ? `(status ${checkResult.status})` : ''}</div>
                {checkResult.host && <div>Host: {String(checkResult.host)}</div>}
                {checkResult.error && <div>Error: {String(checkResult.error)}</div>}
                {checkResult.body && checkResult.body.error && <div>Detail: {String(checkResult.body.error)}</div>}
              </div>
            )}
          </div>
        )}
        {!error && !token && (
          <div style={{ padding: 12, color: '#aaa' }}>{status === 'fetching-token' ? 'Fetching token…' : 'Connecting…'}</div>
        )}
  {/* Quality selector UI */}
  {token && status !== 'error' && (
    <>
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
        <label style={{ color: '#fff', fontSize: 13, marginRight: 6 }}>Quality:</label>
        <select value={qualityMode} onChange={e => setQualityMode(e.target.value as any)} style={{ fontSize: 13, padding: 2 }}>
          <option value="general">General</option>
          <option value="low">Low-bandwidth</option>
          <option value="high">High-quality</option>
          <option value="mobile">Mobile</option>
        </select>
      </div>
      <CallErrorBoundary>
        <LiveKitRoom
          token={token}
          serverUrl={CONFIG.LIVEKIT_WS_URL}
          connectOptions={{
            ...livekitConfigs[qualityMode].connectOptions,
            // Always include required connect options
            autoSubscribe: true,
            maxRetries: 3,
            peerConnectionTimeout: 15000,
            rtcConfig: {
              iceServers: [
                { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
              ],
              iceTransportPolicy: 'all',
            },
          }}
          options={{
            ...livekitConfigs[qualityMode].roomOptions,
            videoCaptureDefaults: livekitConfigs[qualityMode].roomOptions?.videoCaptureDefaults
              ? {
                  ...livekitConfigs[qualityMode].roomOptions.videoCaptureDefaults,
                  facingMode: 'user' as 'user', // ensure correct type
                }
              : undefined,
            publishDefaults: (() => {
              const pd = livekitConfigs[qualityMode].roomOptions?.publishDefaults;
              if (!pd) return undefined;
              const { videoCodec, ...rest } = pd as any;
              return videoCodec
                ? { ...rest, videoCodec: videoCodec as 'vp8' | 'vp9' | 'h264' | 'av1' | 'h265' }
                : rest;
            })(),
          }}
          audio={true}
          video={true}
          onConnected={() => {
            setStatus('connected')
            addLog('Connected to LiveKit')
            if (!startedAtRef.current) startedAtRef.current = Date.now()
            hadConnectedRef.current = true
          }}
          onDisconnected={() => {
            setStatus('disconnected')
            setLkRoom(null)
            addLog('Disconnected from LiveKit')
            if (hadConnectedRef.current) emitEndedOnce('disconnected')
          }}
          onError={(e: any) => { 
            const msg = e?.message || String(e);
            // Filter out known harmless LiveKit cleanup errors
            if (msg.includes('removeTrack') || msg.includes('RTCRtpSender')) {
              addLog(`LiveKit cleanup warning (ignored): ${msg}`);
              return; // Don't treat as fatal error
            }
            setError(msg); 
            setStatus('error'); 
            addLog(`LiveKit error: ${msg}`);
          }}
          data-lk-theme="default"
        >
          <RoomBinder onReady={setLkRoom} />
          {/* header / controls remain above */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <SimpleConference 
              roomId={roomName}
              onLeave={() => { try { emitEndedOnce('hangup') } catch {} ; onClose() }} 
            />
          </div>
        </LiveKitRoom>
      </CallErrorBoundary>
    </>
  )}
      </div>
    </div>
  )
}
 
