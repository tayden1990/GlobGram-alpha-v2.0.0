// Bump these on releases
const APP_VERSION = '2025-08-20-1'
const DEBUG = true
const CACHE_NAME = 'globgram-v2'

function scopeUrl(path) {
  try {
    return new URL(path, self.registration.scope).toString()
  } catch {
    return path
  }
}

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
