import { useEffect, useMemo, useState } from 'react'
import { useRelayStore } from '../state/relayStore'
import { getCachedRelayInfo, type RelayInfo } from '../nostr/nip11'

function toHttpBase(u: string) {
  return u.replace(/\/+$/, '').replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:')
}
async function fetchNip11Info(wsUrl: string, force = false) {
  const base = toHttpBase(wsUrl)
  const urls = [`${base}/.well-known/nostr.json`, `${base}/nip11`]
  let lastErr: any
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: { Accept: 'application/nostr+json' },
        mode: 'cors',
        cache: force ? 'reload' : 'default',
      })
      const text = await r.text()
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return JSON.parse(text)
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(`NIP-11 fetch failed: ${lastErr?.message || 'unknown'}`)
}

export function RelayManager() {
  const relays = useRelayStore(s => s.relays)
  const addRelay = useRelayStore(s => s.addRelay)
  const removeRelay = useRelayStore(s => s.removeRelay)
  const toggleRelay = useRelayStore(s => s.toggleRelay)
  const [url, setUrl] = useState('')
  const [statuses, setStatuses] = useState<Record<string, number>>({})
  const [infos, setInfos] = useState<Record<string, RelayInfo | { error: string } | undefined>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const urls = relays.filter(r => r.enabled).map(r => r.url)
    const sockets = new Map<string, WebSocket>()
    const update = () => {
      const st: Record<string, number> = {}
      for (const [u, ws] of sockets) st[u] = ws.readyState
      setStatuses(st)
    }
    // prime cached nip11
    const cached: Record<string, RelayInfo | { error: string } | undefined> = {}
    for (const u of urls) {
      const c = getCachedRelayInfo(u)
      if (c) cached[u] = c
    }
    if (Object.keys(cached).length) setInfos(prev => ({ ...prev, ...cached }))
    for (const u of urls) {
      try {
        const ws = new WebSocket(u)
        sockets.set(u, ws)
        ws.onopen = update
        ws.onclose = update
        ws.onerror = update
      } catch {}
    }
    const id = setInterval(update, 3000)
    return () => {
      clearInterval(id)
      for (const ws of sockets.values()) try { ws.close() } catch {}
    }
  }, [relays.map(r => `${r.url}:${r.enabled}`).join(',')])

  const badge = (rs?: number) => rs === WebSocket.OPEN ? '🟢' : rs === WebSocket.CONNECTING ? '🟡' : '🔴'
  const short = (s?: string, n = 64) => (s && s.length > n) ? (s.slice(0, n - 1) + '…') : (s || '')

  const loadInfo = async (u: string, force = false) => {
    try {
      setInfos(prev => ({ ...prev, [u]: prev[u] }))
      const info = await fetchNip11Info(u, force)
      setInfos(prev => ({ ...prev, [u]: info as RelayInfo }))
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed'
      setInfos(prev => ({ ...prev, [u]: { error: msg } }))
    }
  }

  return (
    <section style={{ marginTop: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card)', color: 'var(--fg)' }}>
      <h3 style={{ marginTop: 0 }}>Relays</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input placeholder="wss://..." value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
        <button onClick={() => { addRelay(url); setUrl('') }}>Add</button>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {relays.map(r => {
          const info = infos[r.url]
          const isOpen = !!expanded[r.url]
          return (
            <li key={r.url} style={{ padding: '8px 0', borderTop: '1px solid var(--border' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                  <input type="checkbox" checked={r.enabled} onChange={(e) => toggleRelay(r.url, e.target.checked)} />
                  <span>{badge(statuses[r.url])}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.url}</span>
                </label>
                <button onClick={() => setExpanded(prev => ({ ...prev, [r.url]: !prev[r.url] }))}>{isOpen ? 'Hide' : 'Details'}</button>
                <button onClick={() => loadInfo(r.url, true)}>Refresh</button>
                <button onClick={() => removeRelay(r.url)}>Remove</button>
              </div>
              {isOpen && (
                <div style={{ marginTop: 6, marginLeft: 28, fontSize: 13, color: 'var(--muted)' }}>
                  {info && 'error' in (info as any) ? (
                    <div style={{ color: 'var(--danger)' }}>NIP-11: {(info as any).error}</div>
                  ) : info ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 4, columnGap: 8 }}>
                      <div style={{ opacity: .7 }}>Name</div><div>{short((info as any).name, 80) || '—'}</div>
                      <div style={{ opacity: .7 }}>Desc</div><div>{short((info as any).description, 120) || '—'}</div>
                      <div style={{ opacity: .7 }}>Pubkey</div><div style={{ fontFamily: 'monospace' }}>{short((info as any).pubkey, 80) || '—'}</div>
                      <div style={{ opacity: .7 }}>NIPs</div><div>{Array.isArray((info as any).supported_nips) ? (info as any).supported_nips.join(', ') : '—'}</div>
                      <div style={{ opacity: .7 }}>Software</div><div>{short((info as any).software, 80) || '—'}</div>
                      <div style={{ opacity: .7 }}>Version</div><div>{short((info as any).version, 40) || '—'}</div>
                    </div>
                  ) : (
                    <div>
                      <button onClick={() => loadInfo(r.url)}>Load NIP-11</button>
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
