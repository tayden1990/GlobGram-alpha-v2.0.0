import { AccessToken } from 'livekit-server-sdk'

export interface Env {
  LIVEKIT_API_KEY: string
  LIVEKIT_API_SECRET: string
  LIVEKIT_WS_URL?: string
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization'
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
    try {
      const { pathname, searchParams } = new URL(req.url)
      if (pathname === '/check') {
        // Optional: ws param overrides environment; expects wss://<host>
        const ws = (searchParams.get('ws') || env.LIVEKIT_WS_URL || '').trim()
        if (!ws) return Response.json({ ok: false, error: 'LIVEKIT_WS_URL missing; set env or pass ?ws=' }, { status: 400, headers: cors })
        if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return Response.json({ ok: false, error: 'Server not configured (missing API key/secret)' }, { status: 500, headers: cors })
        const httpBase = ws.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\/$/, '')
        const adminAT = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { ttl: '60s' })
        // Grant list permission for REST ListRooms (some deployments require roomList explicitly)
        adminAT.addGrant({ roomAdmin: true, roomList: true } as any)
        const adminToken = await adminAT.toJwt()
        const url = `${httpBase}/twirp/livekit.RoomService/ListRooms`
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${adminToken}` }, body: '{}' })
        const text = await r.text()
        if (r.ok) return Response.json({ ok: true, host: httpBase, status: r.status, body: safeJson(text), iss: env.LIVEKIT_API_KEY, hint: 'Keys match host; proceed to join' }, { headers: cors })
        return Response.json({ ok: false, host: httpBase, status: r.status, body: safeJson(text), iss: env.LIVEKIT_API_KEY, error: 'REST check failed; likely key/host mismatch or missing roomList grant' }, { status: 502, headers: cors })
      }
      if (pathname !== '/token') return new Response('Not found', { status: 404, headers: cors })

      const room = (searchParams.get('room') || 'default').slice(0, 128)
      const identity = (searchParams.get('identity') || 'guest').slice(0, 128)
      if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return new Response('Server not configured', { status: 500, headers: cors })

      // TODO: Add NIP-98 or your auth here if desired.

      const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { identity, ttl: '1h' })
      at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true })
      const token = await at.toJwt()
      return Response.json({ token }, { headers: { 'content-type': 'application/json', ...cors } })
    } catch (e: any) {
      return new Response(`Error: ${e?.message || 'unknown'}`, { status: 500, headers: cors })
    }
  }
}

function safeJson(text: string) {
  try { return JSON.parse(text) } catch { return text }
}
