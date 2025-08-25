import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LiveKitRoom, VideoConference, useRoomContext, ParticipantTile, useTracks } from '@livekit/components-react'
import type { Room } from 'livekit-client'
import { Track } from 'livekit-client'
import { fetchLiveKitToken } from '../livekit/token'
import { CONFIG } from '../config'
import { emitToast } from './Toast'
import { IconInvite } from './icons'
import CallGallery from './CallGallery';

type Props = {
  roomName: string
  identity: string
  open: boolean
  onClose: () => void
  // Optional: notify parent when a call session ends (after having connected at least once)
  onEnded?: (info: { startedAt?: number; endedAt?: number; durationMs?: number; identity: string; room: string; reason?: string; hadConnected: boolean; participants?: string[]; leader?: string; iAmLeader?: boolean }) => void
}

export function CallPanel({ roomName, identity, open, onClose, onEnded }: Props) {
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
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const hasAdvancedLayout = typeof ParticipantTile !== 'undefined' && typeof useTracks === 'function'
  const [layoutMode, setLayoutMode] = useState<'auto'|'gallery'|'speaker'|'screens'>('auto')
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
  <div className="call-topbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#121216', borderBottom: '1px solid #222', gap: 8 }}>
          <strong>Call: {room}</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              title="Copy invite link"
              onClick={async () => {
                let link = ''
                try {
                  const base = (import.meta as any).env?.BASE_URL || '/'
                  const u = new URL(base, window.location.origin)
                  u.searchParams.set('call', roomName)
                  link = u.toString()
                } catch {
                  link = `${window.location.origin}?call=${encodeURIComponent(roomName)}`
                }
                try {
                  await navigator.clipboard.writeText(link)
                  emitToast?.('Invite link copied', 'success')
                  addLog('Invite link copied to clipboard')
                } catch {
                  addLog('Clipboard failed, showing prompt')
                  prompt('Copy this link', link)
                }
              }}
              style={{ background: 'transparent', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            ><IconInvite size={16} /> Invite</button>
            <button
              title={showDebug ? 'Hide debug' : 'Show debug'}
              onClick={() => setShowDebug(v => !v)}
              style={{ background: 'transparent', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}
            >{showDebug ? 'Debug−' : 'Debug+'}</button>
            {/* Layout and fullscreen controls moved to in-video toolbar */}
            <button onClick={() => { try { emitEndedOnce('closed') } catch {} ; onClose() }} style={{ background: 'transparent', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>✖</button>
          </div>
        </div>
  <div className="call-statusbar" style={{ padding: '8px 12px', background: '#0f0f12', borderBottom: '1px solid #222', fontSize: 13, color: '#ddd', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>Status: {status}{error ? ` – ${error}` : ''}</span>
          {(status === 'error' || status === 'disconnected') && (
            <button
              onClick={() => {
                addLog('Manual reconnect requested')
                setError(null)
                setStatus('fetching-token')
                setToken(null)
                setConnectKey(k => k + 1)
              }}
              style={{ background: 'transparent', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}
            >Reconnect</button>
          )}
          {(status === 'error') && (
            <button
              disabled={checkRunning}
              onClick={() => runPreflight(false)}
              style={{ background: 'transparent', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', opacity: checkRunning ? 0.6 : 1 }}
            >{checkRunning ? 'Checking…' : 'Run Check'}</button>
          )}
          <span style={{ opacity: 0.8 }}>Server: {CONFIG.LIVEKIT_WS_URL}</span>
          <span style={{ opacity: 0.8 }}>Identity: {identity.slice(0, 10)}…</span>
          <span style={{ opacity: 0.8 }}>Room: {room}</span>
        </div>

        {showDebug && (
          <div style={{ padding: 12, background: '#0e0e11', color: '#bbb', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12, maxHeight: 160, overflow: 'auto', borderBottom: '1px solid #222' }}>
            <div style={{ marginBottom: 6 }}>
              <strong>Token meta:</strong> iss={tokenMeta?.iss || '?'} · sub={tokenMeta?.sub || '?'} · grant.room={tokenMeta?.room || '?'}
            </div>
            {logs.length === 0 ? <div>No logs yet.</div> : logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}

        {/* Lightweight custom controls */}
  <div className="call-controls" style={{ padding: '8px 12px', background: '#0f0f12', borderBottom: '1px solid #222', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            title="Toggle microphone"
            onClick={async () => {
              try {
                if (!lkRoom) return
                const lp: any = lkRoom.localParticipant as any
                const pubs: any[] = Array.from(lp?.trackPublications?.values?.() || [])
                const micPub = pubs.find(p => String(p?.source || '').toLowerCase().includes('micro'))
                const enabled = micPub ? !micPub.isMuted : false
                const next = !enabled
                await lp.setMicrophoneEnabled(next)
                setMicOn(next)
                addLog(`Mic -> ${next ? 'on' : 'off'}`)
              } catch (e: any) { addLog(`Mic toggle error: ${e?.message || e}`) }
            }}
            style={{ background: micOn ? '#1f3a1f' : 'transparent', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
          >{micOn ? '🎤 Mic On' : '🎤 Mic Off'}</button>
          <button
            title="Toggle camera"
            onClick={async () => {
              try {
                if (!lkRoom) return
                const lp: any = lkRoom.localParticipant as any
                const pubs: any[] = Array.from(lp?.trackPublications?.values?.() || [])
                const camPub = pubs.find(p => String(p?.source || '').toLowerCase().includes('camera'))
                const enabled = camPub ? !camPub.isMuted : false
                const next = !enabled
                await lp.setCameraEnabled(next)
                setCamOn(next)
                addLog(`Camera -> ${next ? 'on' : 'off'}`)
              } catch (e: any) { addLog(`Camera toggle error: ${e?.message || e}`); emitToast?.(`Camera toggle failed: ${e?.message || e}`, 'error') }
            }}
            style={{ background: camOn ? '#1f3a1f' : 'transparent', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
          >{camOn ? '🎥 Cam On' : '🎥 Cam Off'}</button>
          <button
            title="Toggle screen share"
            onClick={async () => {
              try {
                if (!lkRoom) return
                const lp: any = lkRoom.localParticipant as any
                // No direct getter across browsers; try enable true first if no screen track
                const pubs: any[] = Array.from(lp?.trackPublications?.values?.() || [])
                const screenPub = pubs.find(p => String(p?.source || '').toLowerCase().includes('screenshare'))
                const desired = !screenPub || screenPub.isMuted
                await lp.setScreenShareEnabled(desired)
                setScreenOn(desired)
                addLog(`ScreenShare -> ${desired ? 'on' : 'off'}`)
              } catch (e: any) { addLog(`Screen share error: ${e?.message || e}`); emitToast?.(`Screen share failed: ${e?.message || e}`, 'error') }
            }}
            style={{ background: screenOn ? '#1f3a1f' : 'transparent', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
          >{screenOn ? '🖥️ Share On' : '🖥️ Share Off'}</button>
          <span style={{ width: 1, height: 18, background: '#333', display: 'inline-block', margin: '0 6px' }} />
          {/* Audio output selector */}
          <label style={{ fontSize: 12, opacity: 0.9 }}>Output:</label>
          <select
            value={selectedOutput}
            onChange={async (e) => {
              const id = e.target.value
              setSelectedOutput(id)
              try {
                if (lkRoom && id) {
                  await lkRoom.switchActiveDevice('audiooutput', id)
                  addLog(`Audio output -> ${id}`)
                }
              } catch (err: any) {
                emitToast?.(`Switch output failed: ${err?.message || err}`, 'error')
              }
            }}
            style={{ background: 'transparent', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '4px 6px' }}
          >
            <option value="">System default</option>
            {audioOutputs.map(d => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
            ))}
          </select>
          <span style={{ width: 1, height: 18, background: '#333', display: 'inline-block', margin: '0 6px' }} />
          <button
            title="Switch to front (selfie) camera"
            onClick={async () => {
              try {
                if (!lkRoom) return
                const devices = await navigator.mediaDevices.enumerateDevices()
                const cams = devices.filter(d => d.kind === 'videoinput')
                // Prefer labels indicating front/user
                const cand = cams.find(d => /front|user/i.test(d.label)) || cams[0]
                if (cand?.deviceId) {
                  await lkRoom.switchActiveDevice('videoinput', cand.deviceId)
                  addLog(`Switched camera -> front (${cand.label || cand.deviceId})`)
                } else {
                  addLog('No camera devices found')
                }
              } catch (e: any) { addLog(`Switch to front error: ${e?.message || e}`) }
            }}
            style={{ background: 'transparent', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
          >↔️ Front</button>
          <button
            title="Switch to back (environment) camera"
            onClick={async () => {
              try {
                if (!lkRoom) return
                const devices = await navigator.mediaDevices.enumerateDevices()
                const cams = devices.filter(d => d.kind === 'videoinput')
                const cand = cams.find(d => /back|rear|environment/i.test(d.label)) || cams[1] || cams[0]
                if (cand?.deviceId) {
                  await lkRoom.switchActiveDevice('videoinput', cand.deviceId)
                  addLog(`Switched camera -> back (${cand.label || cand.deviceId})`)
                } else {
                  addLog('No camera devices found')
                }
              } catch (e: any) { addLog(`Switch to back error: ${e?.message || e}`) }
            }}
            style={{ background: 'transparent', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
          >↔️ Back</button>
        </div>

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
  {token && status !== 'error' && (
          <LiveKitRoom
            token={token}
            serverUrl={CONFIG.LIVEKIT_WS_URL}
            connectOptions={{ autoSubscribe: true }}
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
            onError={(e: any) => { const msg = e?.message || String(e); setError(msg); setStatus('error'); addLog(`LiveKit error: ${msg}`) }}
            data-lk-theme="default"
          >
            <RoomBinder onReady={setLkRoom} />
            {/* header / controls remain above */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <CallGallery onHangup={() => { try { emitEndedOnce('hangup') } catch {} ; onClose() }} />
            </div>
          </LiveKitRoom>
        )}
      </div>
    </div>
  )
}

function CallTiles({ pinnedId, onPin, layoutMode }: { pinnedId: string | null; onPin: (id: string | null) => void; layoutMode: 'auto'|'gallery'|'speaker'|'screens' }) {
  const screenRefs = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }])
  const camRefs = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }])
  // If pinned, prefer pinned screen share, else pinned camera
  const pinned = useMemo(() => {
    if (!pinnedId) return null
    return (
      screenRefs.find((r) => (r.participant?.identity === pinnedId)) ||
      camRefs.find((r) => (r.participant?.identity === pinnedId)) ||
      null
    )
  }, [pinnedId, screenRefs, camRefs])

  const mode = useMemo(() => {
    if (layoutMode !== 'auto') return layoutMode
    if (pinned || screenRefs.length > 0) return 'speaker'
    return 'gallery'
  }, [layoutMode, pinned, screenRefs.length])

  const gridStyle = (count: number): React.CSSProperties => {
    const cols = count <= 1 ? 1 : count === 2 ? 2 : count <= 4 ? 2 : count <= 9 ? 3 : 4
    return { display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 8 }
  }

  const Tile = ({ tr }: { tr: any }) => (
    <div onClick={() => onPin(tr?.participant?.identity || null)} style={{ position: 'relative', cursor: 'pointer', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
      <ParticipantTile trackRef={tr} style={{ width: '100%', height: '100%' }} />
    </div>
  )

  return (
    <div style={{ display: 'grid', gridTemplateRows: mode==='gallery' ? '1fr' : '1fr auto', minHeight: 0, gap: 8, padding: 8 }}>
      <div style={{ minHeight: 0 }}>
        {mode === 'speaker' ? (
          pinned ? (
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              <ParticipantTile trackRef={pinned} style={{ width: '100%', height: '100%' }} />
              <button onClick={() => onPin(null)} style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '4px 8px' }}>Unpin</button>
            </div>
          ) : screenRefs.length > 0 ? (
            <div style={{ width: '100%', height: '100%', ...gridStyle(screenRefs.length) }}>
              {screenRefs.map((tr) => (
                <Tile key={tr.publication?.trackSid || tr.participant?.identity || Math.random()} tr={tr} />
              ))}
            </div>
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#bbb' }}>No screen share</div>
          )
        ) : mode === 'screens' ? (
          <div style={{ width: '100%', height: '100%', ...gridStyle(screenRefs.length || 1) }}>
            {(screenRefs.length ? screenRefs : camRefs).map((tr) => (
              <Tile key={tr.publication?.trackSid || tr.participant?.identity || Math.random()} tr={tr} />
            ))}
          </div>
        ) : (
          <div style={{ width: '100%', height: '100%', ...gridStyle(camRefs.length || 1) }}>
            {camRefs.map((tr) => (
              <Tile key={tr.publication?.trackSid || tr.participant?.identity || Math.random()} tr={tr} />
            ))}
          </div>
        )}
      </div>
      {mode !== 'gallery' && (
        <div style={{ minHeight: 160, maxHeight: 240, overflow: 'auto', borderTop: '1px solid #222', paddingTop: 8 }}>
          <div style={{ ...gridStyle(camRefs.length || 1) }}>
            {camRefs.map((tr) => (
              <Tile key={tr.publication?.trackSid || tr.participant?.identity || Math.random()} tr={tr} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
