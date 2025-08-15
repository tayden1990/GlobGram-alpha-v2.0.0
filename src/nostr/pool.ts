import { log } from '../ui/logger'

let pool: Map<string, WebSocket> | null = null

// Track listeners to aid cleanup
const listeners = new WeakMap<WebSocket, Array<{ type: string, fn: any }>>()

function connect(urls: string[]): Map<string, WebSocket> {
  const sockets = new Map<string, WebSocket>()
  for (const u of urls) {
    try {
      const ws = new WebSocket(u)
      log(`Relay connecting: ${u}`)
      try { ws.addEventListener('open', () => log(`Relay open: ${u}`), { once: true } as any) } catch {}
      sockets.set(u, ws)
      // Auto-clean listeners when socket closes
      ws.addEventListener('close', () => {
        log(`Relay closed: ${u}`)
        const arr = listeners.get(ws)
        if (arr) {
          try { for (const l of arr) ws.removeEventListener(l.type as any, l.fn as any) } catch {}
          listeners.delete(ws)
        }
      })
    } catch {}
  }
  return sockets
}

export function getRelayPool(urls: string[]): Map<string, WebSocket> {
  if (!pool) pool = connect(urls)
  return pool
}

export function resetRelayPool(urls: string[]) {
  if (pool) {
  log(`Resetting relay pool with ${urls.length} url(s)`)
    for (const ws of pool.values()) {
      try { ws.close() } catch {}
    }
  }
  pool = connect(urls)
}

// Utility for other modules to remember added listeners for cleanup
export function trackListener(ws: WebSocket, type: string, fn: any) {
  try {
    const arr = listeners.get(ws) || []
    arr.push({ type, fn })
    listeners.set(ws, arr)
  } catch {}
}
