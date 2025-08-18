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
  // Try ads.json first
  try {
    const url = `${base}ads.json`
    const r = await fetch(url, { cache: 'no-store' })
    if (r.ok) {
      const data = (await r.json()) as AdsFile
      const items = Array.isArray((data as any)?.ads) ? (data as any).ads as AdConfig[] : []
      for (const ad of items) {
        if (ad.active === false) continue
  const place = (ad.placement || 'top') as 'top'
  if (placement && place !== placement) continue
        if (!isNowWithin(ad.startsAt, ad.endsAt)) continue
        if (Array.isArray(ad.locales) && ad.locales.length && locale && !ad.locales.includes(locale)) continue
        const url = ad.url || extractFirstUrl(ad.text)
        const displayText = stripUrls(ad.text)
        if (!displayText) continue
        out.push({ id: ad.id || displayText.slice(0, 32), text: ad.text, displayText, url: url || null })
      }
    }
  } catch {}
  // Fallback to ad.txt if nothing
  if (!out.length) {
    try {
      const r = await fetch(`${base}ad.txt`, { cache: 'no-store' })
      if (r.ok) {
        const text = (await r.text()).trim()
        if (text) {
          out.push({ id: 'ad.txt', text, displayText: stripUrls(text), url: extractFirstUrl(text) })
        }
      }
    } catch {}
  }
  return out
}
