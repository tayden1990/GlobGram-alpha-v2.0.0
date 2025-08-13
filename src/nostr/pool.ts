let pool: Map<string, WebSocket> | null = null

function connect(urls: string[]): Map<string, WebSocket> {
  const sockets = new Map<string, WebSocket>()
  for (const u of urls) {
    try {
      const ws = new WebSocket(u)
      sockets.set(u, ws)
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
    for (const ws of pool.values()) {
      try { ws.close() } catch {}
    }
  }
  pool = connect(urls)
}
