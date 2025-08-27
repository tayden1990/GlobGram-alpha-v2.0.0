#!/usr/bin/env node
/* Fill missing keys in src/i18n/locales/<lang>.json from src English locale */
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', 'src', 'i18n', 'locales')
if (!fs.existsSync(dir)) {
  console.error('Directory not found:', dir)
  process.exit(1)
}
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
if (!files.includes('en.json')) {
  console.error('en.json not found in src/i18n/locales')
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

let updated = 0
for (const f of files) {
  if (f === 'en.json') continue
  const obj = read(f)
  const before = JSON.stringify(obj)
  fill(obj, en)
  const after = JSON.stringify(obj)
  if (after !== before) {
    write(f, obj)
    updated++
    console.log(`Updated ${f}`)
  } else {
    console.log(`No changes for ${f}`)
  }
}

console.log(`Done. Files updated: ${updated}`)
