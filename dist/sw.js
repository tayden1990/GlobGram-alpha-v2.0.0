// Bump these on releases
const APP_VERSION = '2025-08-15-1'
const CACHE_NAME = 'globgram-v2'

function scopeUrl(path) {
  try {
    return new URL(path, self.registration.scope).toString()
  } catch {
    return path
  }
}

self.addEventListener('install', (e) => {
  self.skipWaiting()
  const core = [ './', './index.html' ].map(scopeUrl)
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(core)).catch(()=>{})
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys()
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
  if (e.data.type === 'GET_VERSION') {
    try { e.source?.postMessage({ type: 'VERSION', version: APP_VERSION }) } catch {}
  } else if (e.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  e.respondWith(
    caches.match(req).then(res => res || fetch(req).then(r => {
      try {
        const copy = r.clone()
        caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(()=>{})
      } catch {}
      return r
    }).catch(()=>res))
  )
})
