// Minimal upload server stub (Node + Express)
// API:
//  POST /upload { key, mime, data(base64) } -> { url }
//  GET  /o/:key -> { mime, data }

const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')

const app = express()
app.use(cors())
app.use(bodyParser.json({ limit: '10mb' }))

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
