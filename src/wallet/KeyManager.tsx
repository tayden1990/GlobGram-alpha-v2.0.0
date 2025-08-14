import { useEffect, useRef, useState } from 'react'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { bytesToHex, hexToBytes } from '../nostr/utils'
import { useChatStore } from '../state/chatStore'
import { useToast } from '../ui/Toast'

export function KeyManager() {
  const [sk, setSk] = useState<string | null>(null)
  const [pk, setPk] = useState<string | null>(null)
  const [showQR, setShowQR] = useState(false)
  const setMyPubkey = useChatStore(s => s.setMyPubkey)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const { show } = useToast()

  useEffect(() => {
    const stored = localStorage.getItem('nostr_sk')
    if (stored) {
      setSk(stored)
  const pub = getPublicKey(hexToBytes(stored))
  setPk(pub)
  setMyPubkey(pub)
    }
  }, [])

  const create = () => {
    const secret = generateSecretKey() // Uint8Array
    const hexd = bytesToHex(secret)
    const pub = getPublicKey(secret)
    localStorage.setItem('nostr_sk', hexd)
    setSk(hexd)
    setPk(pub)
  setMyPubkey(pub)
  }

  const exportKeys = async () => {
    if (!sk || !pk) return
  const nsec = nip19.nsecEncode(hexToBytes(sk))
  const npub = nip19.npubEncode(pk)
  await navigator.clipboard.writeText(`${npub}\n${nsec}`)
  show('Copied npub and nsec', 'success')
  }

  const copyNpub = async () => {
    if (!pk) return
    const npub = nip19.npubEncode(pk)
  try { await navigator.clipboard.writeText(npub); show('npub copied', 'success') } catch { show('Copy failed', 'error') }
  }

  const copyNsec = async () => {
    if (!sk) return
    const ok = confirm('Copy your nsec to clipboard? Keep it secret!')
    if (!ok) return
    const nsec = nip19.nsecEncode(hexToBytes(sk))
  try { await navigator.clipboard.writeText(nsec); show('nsec copied', 'success') } catch { show('Copy failed', 'error') }
  }

  const shareNpub = async () => {
    if (!pk) return
    const npub = nip19.npubEncode(pk)
    // Use Web Share API if available; fallback to copy
    try {
      // @ts-ignore
      if (navigator.share) {
        // @ts-ignore
  await navigator.share({ title: 'My Nostr npub', text: npub })
      } else {
  await navigator.clipboard.writeText(npub)
  show('npub copied (sharing unsupported)', 'success')
      }
    } catch {}
  }

  const copyHexPubkey = async () => {
    if (!pk) return
  try { await navigator.clipboard.writeText(pk); show('pubkey (hex) copied', 'success') } catch { show('Copy failed', 'error') }
  }

  const downloadQR = () => {
    if (!pk) return
    const canvas = qrCanvasRef.current
  if (!canvas) { show('QR not ready', 'error'); return }
    try {
      const npub = nip19.npubEncode(pk)
      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `npub-qr-${npub.slice(0, 12)}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
  } catch { show('Failed to export QR', 'error') }
  }

  const copyQRToClipboard = async () => {
    const canvas = qrCanvasRef.current
  if (!canvas) { show('QR not ready', 'error'); return }
    try {
      const toBlob = (): Promise<Blob> => new Promise((resolve, reject) => {
        try { canvas.toBlob(b => b ? resolve(b) : reject(new Error('blob')),'image/png') } catch (e) { reject(e) }
      })
      const blob = await toBlob()
      // @ts-ignore - ClipboardItem may not be typed in older TS libs
      if (navigator.clipboard && typeof window.ClipboardItem !== 'undefined') {
        // @ts-ignore
  await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
  show('QR copied to clipboard', 'success')
      } else {
        // Fallback: open image in a new tab for manual copy
        const url = URL.createObjectURL(blob)
        window.open(url, '_blank')
      }
  } catch { show('Copy failed', 'error') }
  }

  const downloadBackup = () => {
    if (!sk || !pk) return
    const nsec = nip19.nsecEncode(hexToBytes(sk))
    const npub = nip19.npubEncode(pk)
    const payload = {
      version: 1,
      createdAt: new Date().toISOString(),
      npub,
      nsec,
      pubkey: pk,
      secretHex: sk,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `globgram-key-backup-${npub.slice(0, 12)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  // Render QR locally when modal opens (lazy-load qrcode)
  useEffect(() => {
    if (!showQR || !pk) return
    const npub = nip19.npubEncode(pk)
    const canvas = qrCanvasRef.current
    if (!canvas) return
    ;(async () => {
      try {
        const q = await import('qrcode')
        const toCanvas = (q as any).toCanvas || (q as any).default?.toCanvas
        if (typeof toCanvas === 'function') {
          toCanvas(canvas, npub, { width: 220 })
        }
      } catch {}
    })()
  }, [showQR, pk])

  // Password-encrypted backup using AES-GCM + PBKDF2
  const exportEncrypted = async () => {
    if (!sk || !pk) return
    const password = prompt('Set a password to encrypt your backup:')
    if (!password) return
    const enc = new TextEncoder()
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['encrypt'])
    const payload = JSON.stringify({ version: 2, pubkey: pk, secretHex: sk })
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(payload)))
    const bundle = {
      v: 2,
      kdf: 'PBKDF2-SHA256-100000',
      cipher: 'AES-GCM-256',
      salt: Array.from(salt),
      iv: Array.from(iv),
      data: Array.from(ciphertext),
    }
    const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `globgram-key-encrypted.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const importEncrypted = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const obj = JSON.parse(text)
        if (!(obj && obj.v === 2 && Array.isArray(obj.salt) && Array.isArray(obj.iv) && Array.isArray(obj.data))) throw new Error('Invalid backup')
        const password = prompt('Enter password to decrypt backup:')
        if (!password) return
        const enc = new TextEncoder()
        const salt = new Uint8Array(obj.salt)
        const iv = new Uint8Array(obj.iv)
        const data = new Uint8Array(obj.data)
        const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
        const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['decrypt'])
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
        const decoded = JSON.parse(new TextDecoder().decode(new Uint8Array(plaintext)))
        if (!decoded?.secretHex || !/^[0-9a-fA-F]{64}$/.test(decoded.secretHex)) throw new Error('Invalid key inside backup')
        const pub = getPublicKey(hexToBytes(decoded.secretHex))
        localStorage.setItem('nostr_sk', decoded.secretHex)
        setSk(decoded.secretHex)
        setPk(pub)
        setMyPubkey(pub)
  show('Encrypted backup imported', 'success')
      } catch {
  show('Failed to decrypt backup', 'error')
      }
    }
    input.click()
  }

  const nsecToHex = (n: string): string | null => {
    try {
      const dec: any = nip19.decode(n)
      if (dec.type === 'nsec') return bytesToHex(dec.data as Uint8Array)
      return null
    } catch {
      return null
    }
  }

  const importNsec = async () => {
    const input = prompt('Paste nsec or hex secret key:')
    if (!input) return
    let secretHex = input.trim()
    try {
      if (secretHex.startsWith('nsec')) {
        const hex = nsecToHex(secretHex)
        if (!hex) throw new Error('Invalid nsec')
        secretHex = hex
      }
    } catch {}
    // basic hex validation
    if (!/^[0-9a-fA-F]{64}$/.test(secretHex)) {
  show('Invalid key format', 'error')
      return
    }
    const pub = getPublicKey(hexToBytes(secretHex))
    localStorage.setItem('nostr_sk', secretHex)
    setSk(secretHex)
    setPk(pub)
    setMyPubkey(pub)
  }

  const importFromFile = async (file?: File) => {
    try {
      const f = file || fileInputRef.current?.files?.[0]
      if (!f) return
      const text = await f.text()
      let secretHex: string | null = null
      // Try JSON first
      try {
        const obj = JSON.parse(text)
        if (obj) {
          if (typeof obj.secretHex === 'string') secretHex = obj.secretHex
          else if (typeof obj.hex === 'string') secretHex = obj.hex
          else if (typeof obj.nsec === 'string') {
            secretHex = nsecToHex(obj.nsec)
          }
        }
      } catch {
        // Try simple text: either nsec on a line or hex
        const trimmed = text.trim()
        if (trimmed.startsWith('nsec')) {
          secretHex = nsecToHex(trimmed)
        } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
          secretHex = trimmed
        } else {
          // maybe two lines npub + nsec
          const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
          const maybeNsec = lines.find(l => l.startsWith('nsec'))
          if (maybeNsec) secretHex = nsecToHex(maybeNsec)
        }
      }
      if (!secretHex || !/^[0-9a-fA-F]{64}$/.test(secretHex)) {
  show('Could not read a valid key from the selected file', 'error')
        return
      }
      const pub = getPublicKey(hexToBytes(secretHex))
      localStorage.setItem('nostr_sk', secretHex)
      setSk(secretHex)
      setPk(pub)
      setMyPubkey(pub)
  show('Account imported from file', 'success')
    } catch (e) {
  show('Failed to import file', 'error')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const clear = () => {
    localStorage.removeItem('nostr_sk')
    setSk(null)
    setPk(null)
  setMyPubkey(null)
  }

  return (
    <section style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
      <h2>Keys</h2>
      {pk ? (
        <div>
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div><b>pubkey (hex):</b> <span style={{ fontFamily: 'monospace' }}>{pk}</span></div>
              <button onClick={copyHexPubkey}>Copy hex</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div><b>npub:</b> <span style={{ fontFamily: 'monospace' }}>{nip19.npubEncode(pk)}</span></div>
              <button onClick={copyNpub}>Copy</button>
              <button onClick={() => setShowQR(true)}>Show QR</button>
              <button onClick={shareNpub}>Share</button>
            </div>
            <div><b>secret:</b> {sk?.slice(0, 8)}… <button onClick={copyNsec} style={{ marginLeft: 8 }}>Copy nsec</button></div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <button onClick={clear}>Forget</button>
              <button onClick={exportKeys}>Copy npub/nsec</button>
              <button onClick={downloadBackup}>Export npub/nsec (file)</button>
              <button onClick={exportEncrypted}>Export (encrypted)</button>
            </div>
          </div>
      {showQR && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
              <div style={{ background: '#fff', padding: 16, borderRadius: 8, width: 320, textAlign: 'center' }}>
                <h3 style={{ marginTop: 0 }}>My npub QR</h3>
        <canvas ref={qrCanvasRef} style={{ width: 220, height: 220, borderRadius: 4 }} />
                <div style={{ fontSize: 12, marginTop: 8, wordBreak: 'break-all' }}>{nip19.npubEncode(pk)}</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                  <button onClick={copyQRToClipboard}>Copy to clipboard</button>
                  <button onClick={downloadQR}>Download PNG</button>
                  <button onClick={() => setShowQR(false)}>Close</button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={create}>Generate new key</button>
          <button onClick={importNsec}>Import nsec</button>
          <input ref={fileInputRef} type="file" accept="application/json,.json,.txt" style={{ display: 'none' }} onChange={() => importFromFile()} />
          <button onClick={() => fileInputRef.current?.click()}>Import from file</button>
          <button onClick={importEncrypted}>Import encrypted</button>
        </div>
      )}
    </section>
  )
}
