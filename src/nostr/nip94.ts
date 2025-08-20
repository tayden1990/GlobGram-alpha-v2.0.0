import { finalizeEvent, type EventTemplate } from 'nostr-tools'
import { hexToBytes } from './utils'
import { useRelayStore } from '../state/relayStore'
import { log } from '../ui/logger'

export type Nip94Params = {
  url: string
  mime?: string
  ox?: string
  x?: string
  size?: number | string
  dim?: string // "WxH"
  alt?: string
  summary?: string
  thumb?: string
  image?: string
  service?: string // e.g., "nip96"
  caption?: string
}

export function buildNip94Template(p: Nip94Params): EventTemplate {
  const tags: string[][] = []
  // Order per spec: url, m, x, ox, size, dim, ...
  tags.push(['url', p.url])
  if (p.mime) tags.push(['m', p.mime])
  if (p.x) tags.push(['x', p.x])
  if (p.ox) tags.push(['ox', p.ox])
  if (p.size != null) tags.push(['size', String(p.size)])
  if (p.dim) tags.push(['dim', p.dim])
  if (p.thumb) tags.push(['thumb', p.thumb])
  if (p.image) tags.push(['image', p.image])
  if (p.summary) tags.push(['summary', p.summary])
  if (p.alt) tags.push(['alt', p.alt])
  if (p.service) tags.push(['service', p.service])
  return { kind: 1063 as any, created_at: Math.floor(Date.now()/1000), content: p.caption || '', tags }
}

export function buildFromServerNip94(nip94: any): EventTemplate | null {
  try {
    // Expect { tags: [...], content: "" } shape
    if (!nip94 || !Array.isArray(nip94.tags)) return null
    const content = typeof nip94.content === 'string' ? nip94.content : ''
    const tags: string[][] = nip94.tags.filter((t: any) => Array.isArray(t) && typeof t[0] === 'string' && typeof t[1] === 'string')
    return { kind: 1063 as any, created_at: Math.floor(Date.now()/1000), content, tags }
  } catch {
    return null
  }
}

export async function publishNip94(template: EventTemplate): Promise<string | null> {
  try {
    const sk = localStorage.getItem('nostr_sk')
    if (!sk) { log('NIP-94 publish skipped: no local secret key', 'warn'); return null }
    const evt = finalizeEvent(template, hexToBytes(sk))
    const msg = JSON.stringify(['EVENT', evt])
    const urls = useRelayStore.getState().relays.filter(r => r.enabled).map(r => r.url)
    let sent = 0
    for (const u of urls) {
      try {
        const ws = (window as any).__relayPool?.get(u) as WebSocket | undefined
        if (ws && ws.readyState === ws.OPEN) { ws.send(msg); sent++ }
      } catch {}
    }
    // Fallback: if pool isn’t on window, scan RelayStore’s pool if available
    if (sent === 0) {
      try {
        const pool: Map<string, WebSocket> = (await import('./pool')).getRelayPool(urls)
        for (const [u, ws] of pool.entries()) {
          if (ws.readyState === ws.OPEN) { ws.send(msg); sent++ }
        }
      } catch {}
    }
    log(`NIP-94 published to ${sent} relays`)
    return evt.id
  } catch (e) {
    log(`NIP-94 publish failed: ${(e as any)?.message || e}`, 'error')
    return null
  }
}
