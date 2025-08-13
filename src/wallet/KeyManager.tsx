import { useEffect, useRef, useState } from 'react'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { bytesToHex, hexToBytes } from '../nostr/utils'
import { useChatStore } from '../state/chatStore'

export function KeyManager() {
  const [sk, setSk] = useState<string | null>(null)
  const [pk, setPk] = useState<string | null>(null)
  const setMyPubkey = useChatStore(s => s.setMyPubkey)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
    alert('Copied npub and nsec to clipboard')
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
        alert('Encrypted backup imported')
      } catch {
        alert('Failed to decrypt backup')
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
      alert('Invalid key format')
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
        alert('Could not read a valid key from the selected file')
        return
      }
      const pub = getPublicKey(hexToBytes(secretHex))
      localStorage.setItem('nostr_sk', secretHex)
      setSk(secretHex)
      setPk(pub)
      setMyPubkey(pub)
      alert('Account imported from file')
    } catch (e) {
      alert('Failed to import file')
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
          <div><b>pubkey:</b> {pk}</div>
          <div><b>secret:</b> {sk?.slice(0, 8)}…</div>
          <button onClick={clear}>Forget</button>
          <button onClick={exportKeys} style={{ marginLeft: 8 }}>Copy npub/nsec</button>
          <button onClick={downloadBackup} style={{ marginLeft: 8 }}>Export npub/nsec (file)</button>
          <button onClick={exportEncrypted} style={{ marginLeft: 8 }}>Export (encrypted)</button>
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
