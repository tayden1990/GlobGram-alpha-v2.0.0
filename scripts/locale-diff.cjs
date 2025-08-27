#!/usr/bin/env node
/* Compare keys in public/locales/<lang>.json against en.json */
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', 'public', 'locales')
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
if (!files.includes('en.json')) {
  console.error('en.json not found in public/locales')
  process.exit(1)
}

const load = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
const flatten = (obj, pfx = '') => {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = pfx ? `${pfx}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key))
    } else {
      out[key] = true
    }
  }
  return out
}

const base = flatten(load('en.json'))
let totalMissing = 0
let totalExtra = 0

for (const f of files) {
  if (f === 'en.json') continue
  const data = flatten(load(f))
  const missing = Object.keys(base).filter(k => !data[k])
  const extra = Object.keys(data).filter(k => !base[k])
  totalMissing += missing.length
  totalExtra += extra.length
  console.log(`\n== ${f} ==`)
  console.log(`missing: ${missing.length}`)
  if (missing.length) console.log(missing.join('\n'))
  console.log(`extra: ${extra.length}`)
  if (extra.length) console.log(extra.join('\n'))
}

console.log(`\nSummary: missing=${totalMissing}, extra=${totalExtra}`)
