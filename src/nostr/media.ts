import { bytesToBase64, dataURLToBytes, sha256Hex } from './utils'

export type EncryptedMedia = {
  v: 1
  alg: 'AES-GCM-256'
  iv: string // base64
  keySalt: string // base64
  ct: string // base64
  mime: string
  sha256: string // hex of plaintext
}

async function deriveKey(password: string, salt: Uint8Array) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  // ensure ArrayBuffer for salt
  const saltBuf = new Uint8Array(salt).buffer
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: saltBuf as unknown as BufferSource, iterations: 100_000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function encryptDataURL(dataUrl: string, password: string): Promise<EncryptedMedia> {
  const { bytes, mime } = dataURLToBytes(dataUrl)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(password, salt)
  const hash = await sha256Hex(bytes)
  const ivBuf = new Uint8Array(iv).buffer
  const ptBuf = new Uint8Array(bytes).buffer
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBuf as unknown as BufferSource }, key, ptBuf))
  return { v: 1, alg: 'AES-GCM-256', iv: bytesToBase64(iv), keySalt: bytesToBase64(salt), ct: bytesToBase64(ct), mime, sha256: hash }
}
