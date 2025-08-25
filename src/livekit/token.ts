import { CONFIG } from '../config'

// Tiny contract
// input: identity (string), room (string)
// output: JWT string suitable for livekit-client.connect
export async function fetchLiveKitToken(identity: string, room: string, extraHeaders?: Record<string, string>): Promise<string> {
  if (!CONFIG.LIVEKIT_TOKEN_ENDPOINT) throw new Error('LiveKit token endpoint not configured')
  const url = new URL(CONFIG.LIVEKIT_TOKEN_ENDPOINT)
  url.searchParams.set('room', room)
  url.searchParams.set('identity', identity)
  const headers: Record<string, string> = { 'accept': 'application/json' }
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers[k] = v
  }
  const res = await fetch(url.toString(), { headers, credentials: 'omit' })
  if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`)
  const data = await res.json().catch(() => ({} as any))
  const token = data?.token || data?.accessToken || data?.jwt
  if (!token) throw new Error('Token not present in response')
  return token
}
