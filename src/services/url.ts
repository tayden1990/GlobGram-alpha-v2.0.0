// URL helpers for constructing links that respect the app base path (GitHub Pages, etc.)

/**
 * Returns the absolute base URL of the app, including the Vite base path.
 * Example: https://user.github.io/GlobGram-alpha-v2.0.0/
 */
export function getAppBaseUrl(): string {
  const origin = window.location.origin
  // Vite injects BASE_URL at build time; defaults to '/'
  const base = (import.meta as any)?.env?.BASE_URL ?? '/'
  try {
    const url = new URL(base, origin).toString()
    // Ensure it ends with a trailing slash (URL() should already do this for path-only)
    return url
  } catch {
    // Fallback concatenation
    const normalizedBase = base.startsWith('/') ? base : `/${base}`
    return origin + (normalizedBase.endsWith('/') ? normalizedBase : normalizedBase + '/')
  }
}

/**
 * Build an invite URL for a given room that works under subpath deployments.
 */
export function buildInviteUrl(roomId: string): string {
  const baseUrl = getAppBaseUrl() // has trailing slash
  // We want .../<base>/?room=...&action=join-call
  return `${baseUrl}?room=${encodeURIComponent(roomId)}&action=join-call`
}

/** Build a call link like .../<base>/?call=<id> */
export function buildCallUrl(callId: string): string {
  const baseUrl = getAppBaseUrl()
  return `${baseUrl}?call=${encodeURIComponent(callId)}`
}

/** Build an npub invite link like .../<base>/?invite=<npub>&lang=<code> */
export function buildInviteNpubUrl(npub: string, lang: string): string {
  const baseUrl = getAppBaseUrl()
  const l = lang || 'en'
  return `${baseUrl}?invite=${encodeURIComponent(npub)}&lang=${encodeURIComponent(l)}`
}
