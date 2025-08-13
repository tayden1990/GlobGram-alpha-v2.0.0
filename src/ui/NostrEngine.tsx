import { useEffect, useRef } from 'react'
import { startNostrEngine } from '../nostr/engine'
import { useChatStore } from '../state/chatStore'
import { useRelayStore } from '../state/relayStore'

export function NostrEngine() {
  const startedRef = useRef<string | null>(null)
  const myPubkey = useChatStore(s => s.myPubkey)
  const relays = useRelayStore(s => s.relays)
  useEffect(() => {
    const sk = localStorage.getItem('nostr_sk')
    if (!sk) return
    if (startedRef.current === sk) return
    startedRef.current = sk
    startNostrEngine(sk)
  }, [myPubkey])

  // Ask for notification permission once
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission().catch(() => {}) } catch {}
    }
  }, [])

  // Show notifications for new incoming messages
  useEffect(() => {
    const unsub = useChatStore.subscribe((s, prev) => {
      if (!s.myPubkey) return
      if (!('Notification' in window) || Notification.permission !== 'granted') return
      // find new messages by comparing lengths
      const prevKeys = Object.keys(prev.conversations)
      const currKeys = Object.keys(s.conversations)
      const keys = Array.from(new Set([...prevKeys, ...currKeys]))
      for (const k of keys) {
        const a = prev.conversations[k] || []
        const b = s.conversations[k] || []
        if (b.length > a.length) {
          const newMsgs = b.slice(a.length)
          for (const m of newMsgs) {
            if (m.from !== s.myPubkey) {
              try { new Notification('New message', { body: m.text || (m.attachment?.startsWith('data:image/') ? '[image]' : '[audio]') }) } catch {}
            }
          }
        }
      }
    }) as unknown as () => void
    return () => { try { unsub() } catch {} }
  }, [relays])
  return null
}
