#!/usr/bin/env node
/* Fill missing keys in public/locales/<lang>.json from en.json */
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', 'public', 'locales')
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
if (!files.includes('en.json')) {
  console.error('en.json not found in public/locales')
  process.exit(1)
}

const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
const write = (f, obj) => fs.writeFileSync(path.join(dir, f), JSON.stringify(obj, null, '\t'))

const en = read('en.json')

function fill(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {}
      fill(dst[k], v)
    } else {
      if (!(k in dst)) dst[k] = v
    }
  }
}

let totalFilled = 0
for (const f of files) {
  if (f === 'en.json') continue
  const before = JSON.stringify(read(f))
  const obj = JSON.parse(before)
  fill(obj, en)
  const after = JSON.stringify(obj)
  if (after !== before) {
    write(f, obj)
    const filled = (JSON.parse(after), 1) // marker; actual counts not easily tracked here
    totalFilled += 1
    console.log(`Updated ${f}`)
  } else {
    console.log(`No changes for ${f}`)
  }
}

console.log(`Done. Locales synced with en.json (files updated: ${totalFilled}).`)
