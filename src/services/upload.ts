// Demo in-memory upload service. In production, replace with your backend or storage provider.
const store = new Map<string, { mime: string; data: string }>() // data: base64 of encrypted blob

export async function putObject(key: string, mime: string, base64Data: string): Promise<string> {
  store.set(key, { mime, data: base64Data })
  // return a pseudo-URL token
  return `mem://${key}`
}

export async function getObject(key: string): Promise<{ mime: string; base64Data: string } | null> {
  const v = store.get(key)
  if (!v) return null
  return { mime: v.mime, base64Data: v.data }
}

export function parseMemUrl(url: string): string | null {
  if (!url.startsWith('mem://')) return null
  return url.slice('mem://'.length)
}
