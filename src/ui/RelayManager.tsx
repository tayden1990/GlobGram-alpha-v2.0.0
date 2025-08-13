import { useEffect, useMemo, useState } from 'react'
import { useRelayStore } from '../state/relayStore'

export function RelayManager() {
  const relays = useRelayStore(s => s.relays)
  const addRelay = useRelayStore(s => s.addRelay)
  const removeRelay = useRelayStore(s => s.removeRelay)
  const toggleRelay = useRelayStore(s => s.toggleRelay)
  const [url, setUrl] = useState('')
  const [statuses, setStatuses] = useState<Record<string, number>>({})

  useEffect(() => {
    const urls = relays.filter(r => r.enabled).map(r => r.url)
    const sockets = new Map<string, WebSocket>()
    const update = () => {
      const st: Record<string, number> = {}
      for (const [u, ws] of sockets) st[u] = ws.readyState
      setStatuses(st)
    }
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

  return (
    <section style={{ marginTop: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card)', color: 'var(--fg)' }}>
      <h3 style={{ marginTop: 0 }}>Relays</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input placeholder="wss://..." value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
        <button onClick={() => { addRelay(url); setUrl('') }}>Add</button>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
    {relays.map(r => (
          <li key={r.url} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={r.enabled} onChange={(e) => toggleRelay(r.url, e.target.checked)} />
      <span>{badge(statuses[r.url])}</span>
      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.url}</span>
            </label>
            <button onClick={() => removeRelay(r.url)}>Remove</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
