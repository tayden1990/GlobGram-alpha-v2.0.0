export type AdConfig = {
  id: string
  text: string
  url?: string
  active?: boolean
  locales?: string[]
  startsAt?: string
  endsAt?: string
  placement?: 'top'
}

export type AdsFile = {
  version: number
  ads: AdConfig[]
}

export type PreparedAd = {
  id: string
  text: string
  displayText: string
  url: string | null
}

export const extractFirstUrl = (s: string | null | undefined): string | null => {
  if (!s) return null
  try {
    const m = s.match(/https?:\/\/[^\s]+/)
    return m ? m[0] : null
  } catch { return null }
}

export const stripUrls = (s: string | null | undefined): string => {
  if (!s) return ''
  try {
    return s.replace(/https?:\/\/[^\s]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  } catch { return String(s) }
}

const isNowWithin = (start?: string, end?: string): boolean => {
  const now = Date.now()
  const s = start ? Date.parse(start) : NaN
  const e = end ? Date.parse(end) : NaN
  if (!isNaN(s) && now < s) return false
  if (!isNaN(e) && now > e) return false
  return true
}

export async function loadPreparedAds(locale?: string, placement: 'top' = 'top'): Promise<PreparedAd[]> {
  const out: PreparedAd[] = []
  const base = (import.meta as any)?.env?.BASE_URL || '/'
  // Try ads.json from multiple candidate paths to be resilient to base path issues
  const candidates = Array.from(new Set([`${base}ads.json`, '/ads.json', 'ads.json']))
  let loaded = false
  for (const u of candidates) {
    try {
      const r = await fetch(u, { cache: 'no-store' })
      if (!r.ok) continue
      const data = (await r.json()) as AdsFile
      const items = Array.isArray((data as any)?.ads) ? (data as any).ads as AdConfig[] : []
      for (const ad of items) {
        if (ad.active === false) continue
        const place = (ad.placement || 'top') as 'top'
        if (placement && place !== placement) continue
        if (!isNowWithin(ad.startsAt, ad.endsAt)) continue
        if (Array.isArray(ad.locales) && ad.locales.length && locale) {
          const locs = ad.locales.map(l => (l || '').toLowerCase())
          const cur = (locale || '').toLowerCase()
          const root = cur.split('-')[0]
          const allowAll = locs.includes('all')
          const matches = allowAll || locs.includes(cur) || (root && locs.includes(root))
          if (!matches) continue
        }
        const url = ad.url || extractFirstUrl(ad.text)
        const displayText = stripUrls(ad.text)
        if (!displayText) continue
        out.push({ id: ad.id || displayText.slice(0, 32), text: ad.text, displayText, url: url || null })
      }
      loaded = true
      break
    } catch (e) {
      // non-fatal, try next path
      try { console.warn('Ads: failed to load', u) } catch {}
    }
  }
  if (!loaded) {
    try { console.warn('Ads: ads.json not found in any path', candidates) } catch {}
  }
  return out
}
