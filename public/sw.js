// Bump these on releases
const APP_VERSION = '2025-08-27-1'
const DEBUG = true
const CACHE_NAME = 'globgram-v2'

function scopeUrl(path) {
  try {
    return new URL(path, self.registration.scope).toString()
  } catch {
    return path
  }
}

// Handle push notifications
self.addEventListener('push', (event) => {
  if (DEBUG) console.log('[SW] Push received:', event.data?.text())
  
  const options = {
    body: 'You have a new message in GlobGram',
    icon: './branding/logo.png',
    badge: './branding/logo.png',
    tag: 'globgram-notification',
    vibrate: [200, 100, 200],
    requireInteraction: true,
    actions: [
      {
        action: 'open',
        title: 'Open App',
        icon: './branding/logo.png'
      },
      {
        action: 'close',
        title: 'Dismiss'
      }
    ],
    data: {
      url: './',
      timestamp: Date.now()
    }
  }

  if (event.data) {
    try {
      const payload = event.data.json()
      options.body = payload.body || options.body
      options.title = payload.title || 'GlobGram'
      options.data.url = payload.url || options.data.url
    } catch (e) {
      options.title = 'GlobGram'
      options.body = event.data.text() || options.body
    }
  }

  event.waitUntil(
    self.registration.showNotification('GlobGram', options)
  )
})

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  if (DEBUG) console.log('[SW] Notification clicked:', event.action)
  
  event.notification.close()

  if (event.action === 'close') {
    return
  }

  const targetUrl = event.notification.data?.url || './'
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus existing window
      for (const client of clientList) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus()
        }
      }
      // Open new window if no existing window found
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
    })
  )
})

self.addEventListener('install', (e) => {
  if (DEBUG) console.log('[SW] install')
  self.skipWaiting()
  const core = [ './', './index.html', './offline.html', './branding/logo.png',
    './locales/en.json','./locales/fa.json','./locales/es.json','./locales/fr.json','./locales/de.json','./locales/pt.json','./locales/ru.json','./locales/ar.json',
  ].map(scopeUrl)
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(core)).catch(()=>{})
  )
})

self.addEventListener('activate', (e) => {
  if (DEBUG) console.log('[SW] activate')
  e.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys()
        if (DEBUG) console.log('[SW] existing caches', keys)
        await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
      } catch {}
      await self.clients.claim()
      try {
        const clients = await self.clients.matchAll({ type: 'window' })
        for (const c of clients) c.postMessage({ type: 'VERSION', version: APP_VERSION })
      } catch {}
    })()
  )
})

self.addEventListener('message', (e) => {
  if (!e.data) return
  if (DEBUG) console.log('[SW] message', e.data)
  if (e.data.type === 'GET_VERSION') {
    try { e.source?.postMessage({ type: 'VERSION', version: APP_VERSION }) } catch {}
  } else if (e.data.type === 'SKIP_WAITING') {
    if (DEBUG) console.log('[SW] skip waiting requested')
    self.skipWaiting()
  }
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Only handle same-origin
  if (url.origin !== self.location.origin) return
  if (DEBUG) console.log('[SW] fetch', url.pathname, req.mode, req.destination)
  // For navigation requests, serve offline page on network failure
  if (req.mode === 'navigate' || (req.destination === '' && req.headers.get('accept')?.includes('text/html'))) {
    e.respondWith(
      fetch(req).catch(async () => {
        if (DEBUG) console.log('[SW] navigation failed; serving offline')
        const cache = await caches.open(CACHE_NAME)
        const offline = await cache.match(scopeUrl('./offline.html'))
        return offline || caches.match(scopeUrl('./index.html'))
      })
    )
    return
  }
  // Don't cache WebRTC/real-time communication resources
  const isRealTimeResource = url.pathname.includes('/livekit') || 
                           url.pathname.includes('/webrtc') ||
                           url.pathname.includes('/ws') ||
                           url.pathname.includes('/socket') ||
                           url.searchParams.has('sid') ||
                           req.headers.get('upgrade') === 'websocket'
  
  if (isRealTimeResource) {
    e.respondWith(fetch(req))
    return
  }
  
  e.respondWith(
    caches.match(req).then(res => res || fetch(req).then(r => {
      try {
        if (r && r.ok && r.type === 'basic') {
          const copy = r.clone()
          caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(()=>{})
        }
      } catch {}
      return r
    }).catch(()=>res))
  )
})
