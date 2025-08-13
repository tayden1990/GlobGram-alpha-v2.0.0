self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open('globgram-v1').then(cache => cache.addAll(['/','/index.html'])).catch(()=>{}))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim())
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  e.respondWith(
    caches.match(req).then(res => res || fetch(req).then(r => {
      const copy = r.clone()
      caches.open('globgram-v1').then(c => c.put(req, copy)).catch(()=>{})
      return r
    }).catch(()=>res))
  )
})
