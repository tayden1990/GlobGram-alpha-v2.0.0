export type LogEntry = { ts: number; level: 'info'|'warn'|'error'; msg: string }

let buf: LogEntry[] = []
type Listener = (e: LogEntry) => void
const listeners = new Set<Listener>()

// Runtime minimum level filter (info < warn < error)
let minLevel: 'info'|'warn'|'error' = 'info'
const levelRank: Record<'info'|'warn'|'error', number> = { info: 0, warn: 1, error: 2 }
export function setLogMinLevel(level: 'info'|'warn'|'error') { minLevel = level }
export function getLogMinLevel(): 'info'|'warn'|'error' { return minLevel }

export function log(msg: string, level: 'info'|'warn'|'error' = 'info') {
  try {
    if (levelRank[level] < levelRank[minLevel]) return
  } catch {}
  const e: LogEntry = { ts: Date.now(), level, msg }
  buf.push(e)
  // No in-memory cap per user request; persist to storage for full-history export
  try { persistLog(e) } catch {}
  try { listeners.forEach(l => l(e)) } catch {}
}

export function getLogs(): LogEntry[] { return buf.slice() }
export function clearLogs() { buf = [] }
export function onLog(l: Listener) { listeners.add(l); return () => listeners.delete(l) }

// Seed with a startup entry
log('App started', 'info')

// --- Persistence (IndexedDB with graceful fallback) ---

type PersistedLog = { id?: number; ts: number; level: 'info'|'warn'|'error'; msg: string }
let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === 'undefined') {
    // Fallback marker: no IDB available
    dbPromise = Promise.reject(new Error('indexedDB unavailable'))
    return dbPromise
  }
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open('globgram-logs', 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error || new Error('openDB error'))
    } catch (e) { reject(e as any) }
  })
  return dbPromise
}

async function persistLog(e: LogEntry) {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite')
      const os = tx.objectStore('entries')
      const req = os.add({ ts: e.ts, level: e.level, msg: e.msg } as PersistedLog)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error || new Error('add error'))
    })
  } catch {
    // Fallback: best-effort append to localStorage chunk (may be size-limited)
    try {
      const line = `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] ${e.msg}\n`
      const key = 'logs_fallback_text'
      const prev = localStorage.getItem(key) || ''
      localStorage.setItem(key, prev + line)
    } catch {}
  }
}

export async function getPersistedLogsText(filter: 'all'|'info'|'warn'|'error' = 'all'): Promise<string> {
  // If IDB is available, stream all entries into a single string
  try {
    const db = await openDB()
    return await new Promise<string>((resolve, reject) => {
      const tx = db.transaction('entries', 'readonly')
      const os = tx.objectStore('entries')
      const req = os.openCursor()
      const parts: string[] = []
      req.onsuccess = (ev: any) => {
        const cursor: IDBCursorWithValue | null = ev.target.result
        if (!cursor) { resolve(parts.join('')); return }
        const v = cursor.value as PersistedLog
        if (filter === 'all' || v.level === filter) {
          parts.push(`${new Date(v.ts).toISOString()} [${v.level.toUpperCase()}] ${v.msg}\n`)
        }
        cursor.continue()
      }
      req.onerror = () => reject(req.error || new Error('cursor error'))
    })
  } catch {
    // Fallback to localStorage aggregated string
    try {
      const txt = localStorage.getItem('logs_fallback_text') || ''
      // Filter in-memory buffer with the provided filter (exclude 'all' case as it's handled above)
      const mem = (buf || []).filter(e => e.level === filter)
      const extra = filter === 'all' ? (buf || []).map(e => `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] ${e.msg}\n`).join('') : mem.map(e => `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] ${e.msg}\n`).join('')
      return txt + extra
    } catch { return '' }
  }
}

export async function clearPersistedLogs(): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite')
      const os = tx.objectStore('entries')
      const req = os.clear()
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error || new Error('clear error'))
    })
  } catch {
    try { localStorage.removeItem('logs_fallback_text') } catch {}
  }
}
