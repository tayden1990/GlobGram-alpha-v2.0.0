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
app.options('*', cors(corsConfig))
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
  store.set(key, { mime, data })
  const url = `${req.protocol}://${req.get('host')}/o/${encodeURIComponent(key)}`
  res.json({ url })
})

app.get('/o/:key', (req, res) => {
  const key = req.params.key
  const v = store.get(key)
  if (!v) return res.status(404).json({ error: 'Not found' })
  res.json(v)
})

const port = process.env.PORT || 8787
app.listen(port, () => console.log(`Upload server listening on http://localhost:${port}`))
