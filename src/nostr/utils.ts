export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function blobToDataURL(blob: Blob, onProgress?: (progress01: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.onprogress = (e: ProgressEvent<FileReader>) => {
      if (onProgress && e.lengthComputable && e.total > 0) {
        try { onProgress(Math.min(1, Math.max(0, e.loaded / e.total))) } catch {}
      }
    }
    reader.readAsDataURL(blob)
  })
}

export function dataURLSize(dataUrl: string): number {
  // approximate decoded bytes length from base64 data URL
  const comma = dataUrl.indexOf(',')
  if (comma === -1) return 0
  const b64 = dataUrl.slice(comma + 1)
  const padding = (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0)
  return Math.floor((b64.length * 3) / 4) - padding
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i])
  // btoa expects binary string
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function dataURLToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const comma = dataUrl.indexOf(',')
  if (comma === -1) return { bytes: new Uint8Array(), mime: 'application/octet-stream' }
  const header = dataUrl.slice(0, comma)
  const mimeMatch = header.match(/^data:([^;]+);/)
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream'
  const b64 = dataUrl.slice(comma + 1)
  return { bytes: base64ToBytes(b64), mime }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes) // ensure underlying buffer is ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return bytesToHex(new Uint8Array(digest))
}

// Max attachment size: 10 MB
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

// Downscale and recompress an image blob to fit under max bytes
export async function downscaleImage(
  blob: Blob,
  opts: { maxBytes?: number; maxDimension?: number; mime?: 'image/webp' | 'image/jpeg' } = {}
): Promise<Blob> {
  const maxBytes = opts.maxBytes ?? MAX_ATTACHMENT_BYTES
  if (blob.size <= maxBytes) return blob
  const maxDim = opts.maxDimension ?? 2048
  const targetMime = opts.mime ?? 'image/jpeg'

  const loadImage = (b: Blob) => new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(b)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })

  let img: HTMLImageElement
  try { img = await loadImage(blob) } catch { return blob }
  let { width, height } = img
  const scale = Math.min(1, maxDim / Math.max(width, height))
  width = Math.max(1, Math.floor(width * scale))
  height = Math.max(1, Math.floor(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return blob
  ctx.drawImage(img, 0, 0, width, height)

  const qualities = [0.92, 0.85, 0.75, 0.6, 0.5]
  let smallest: Blob | null = null
  for (const q of qualities) {
    const out: Blob = await new Promise((r) => canvas.toBlob((b) => r(b || blob), targetMime, q))
    if (!smallest || out.size < smallest.size) smallest = out
    if (out.size <= maxBytes) return out
  }
  return smallest || blob
}

// Prepare any blob (image/audio/video/other) for sending: compress image if possible, then produce data URL with progress
export async function prepareBlobForSend(blob: Blob, opts?: { onProgress?: (p01: number) => void }): Promise<string> {
  let working = blob
  try {
    if (working.type?.startsWith('image/')) {
      working = await downscaleImage(working, { maxBytes: MAX_ATTACHMENT_BYTES, maxDimension: 2048, mime: 'image/jpeg' })
    }
  } catch {}
  const url = await blobToDataURL(working, opts?.onProgress)
  if (dataURLSize(url) > MAX_ATTACHMENT_BYTES) {
    throw new Error('Encoded data exceeds 10 MB limit')
  }
  return url
}
