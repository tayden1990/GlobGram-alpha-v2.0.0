// Minimal upload server stub (Node + Express, ESM)
// API:
//  POST /upload { key, mime, data(base64) } -> { url }
//  GET  /o/:key -> { mime, data }

import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'

const app = express()
// CORS: allow preflight and Authorization header for both /upload and /o/:key
const corsConfig = {
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
}
app.use(cors(corsConfig))
// Handle OPTIONS preflight explicitly to avoid path-to-regexp '*' issues on some versions
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*')
    res.header('Vary', 'Origin')
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    return res.sendStatus(200)
  }
  return next()
})
// Raise limit for larger files; align with client MAX_ATTACHMENT_BYTES (10MB) or higher if desired
app.use(bodyParser.json({ limit: '25mb' }))

// Optional bearer auth for simple protection when exposed beyond localhost
const AUTH_TOKEN = process.env.UPLOAD_AUTH_TOKEN || ''
app.use((req, res, next) => {
  if (!AUTH_TOKEN) return next()
  const h = req.get('authorization') || req.get('Authorization') || ''
  const ok = h.toLowerCase().startsWith('bearer ') && h.slice(7).trim() === AUTH_TOKEN
  if (!ok) return res.status(401).json({ error: 'Unauthorized' })
  next()
})

const store = new Map() // key -> { mime, data }

app.post('/upload', (req, res) => {
  const { key, mime, data } = req.body || {}
  if (!key || !mime || !data) return res.status(400).json({ error: 'Missing fields' })
  console.log(`[POST] /upload key=${key} mime=${mime} bytes=${(data?.length||0)} store.size(before)=${store.size}`)
  // Store under both raw and encoded variants to be robust to client encoding
  const rawKey = String(key)
  const encKey = encodeURIComponent(rawKey)
  store.set(rawKey, { mime, data })
  store.set(encKey, { mime, data })
  const url = `${req.protocol}://${req.get('host')}/o/${encodeURIComponent(key)}`
  console.log(`[POST] -> 200 url=${url} store.size(after)=${store.size}`)
  res.json({ url })
})

app.get('/o/:key', (req, res) => {
  const key = req.params.key
  // Try exact, decoded, and re-encoded variants
  const dec = decodeURIComponent(key)
  const v = store.get(key) || store.get(dec) || store.get(encodeURIComponent(dec))
  if (!v) {
    console.log(`[GET] /o key=${key} -> 404 store.size=${store.size}`)
    return res.status(404).json({ error: 'Not found' })
  }
  console.log(`[GET] /o key=${key} -> 200 mime=${v.mime} size=${(v.data?.length||0)} store.size=${store.size}`)
  res.json(v)
})

// Optional HEAD for existence check
app.head('/o/:key', (req, res) => {
  const key = req.params.key
  const dec = decodeURIComponent(key)
  const v = store.get(key) || store.get(dec) || store.get(encodeURIComponent(dec))
  if (!v) return res.sendStatus(404)
  res.setHeader('Content-Type', v.mime || 'application/octet-stream')
  return res.sendStatus(200)
})

const port = process.env.PORT || 8787
app.listen(port, () => console.log(`Upload server listening on http://localhost:${port}`))
