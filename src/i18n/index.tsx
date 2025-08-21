import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type Messages = Record<string, string>

type I18nContextType = {
  locale: string
  setLocale: (loc: string) => void
  t: (key: string, vars?: Record<string, string | number>) => string
  messages: Messages
  availableLocales: { code: string; name: string }[]
}

const I18nContext = createContext<I18nContextType | null>(null)

const LOCALE_STORAGE_KEY = 'app_locale'

// Expose a global translator for non-React modules (engine, utils) to use safely
let currentT: (key: string, vars?: Record<string, string | number>) => string = (k, vars) => {
  if (!vars) return k
  return Object.keys(vars).reduce((out, v) => out.replace(new RegExp(`{${v}}`, 'g'), String(vars[v]!)), k)
}
export function tGlobal(key: string, vars?: Record<string, string | number>) {
  try {
    return currentT(key, vars)
  } catch {
    return key
  }
}

// Supported locales and a stable loader that fetches from public/locales for offline caching
const SUPPORTED_LOCALES = ['en','fa','es','fr','de','pt','ru','ar'] as const
type LocaleCode = typeof SUPPORTED_LOCALES[number]
const basePath = (import.meta as any)?.env?.BASE_URL || '/'
const fetchLocale = async (code: LocaleCode): Promise<{ default: Messages }> => {
  const url = `${basePath}locales/${code}.json?v=${Date.now()}`
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`Failed to load locale ${code}`)
    const j = (await r.json()) as Messages
    return { default: j || {} }
  } catch {
    return { default: {} }
  }
}
const loaders: Record<string, () => Promise<{ default: Messages }>> = Object.fromEntries(
  (SUPPORTED_LOCALES as readonly string[]).map(code => [code, () => fetchLocale(code as LocaleCode)])
) as Record<string, () => Promise<{ default: Messages }>>

const localeNames: Record<string, string> = {
  en: 'English',
  fa: 'فارسی',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  ru: 'Русский',
  ar: 'العربية',
}
// Simple flag emojis for each locale (best-effort picks for language, not political)
const localeFlags: Record<string, string> = {
  en: '🇺🇸', // English
  fa: '🇮🇷', // Persian (Farsi)
  es: '🇪🇸', // Spanish
  fr: '🇫🇷', // French
  de: '🇩🇪', // German
  pt: '🇵🇹', // Portuguese
  ru: '🇷🇺', // Russian
  ar: '🇸🇦', // Arabic
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<string>(() => {
  const supported = SUPPORTED_LOCALES as unknown as string[]
    // URL override: ?lang=xx
    try {
      const urlLang = new URLSearchParams(window.location.search).get('lang')
      if (urlLang && supported.includes(urlLang)) {
        try { localStorage.setItem(LOCALE_STORAGE_KEY, urlLang) } catch {}
        return urlLang
      }
    } catch {}
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored) return stored
    const nav = typeof navigator !== 'undefined' ? navigator.language || (navigator as any).userLanguage : 'en'
    const base = (nav || 'en').split('-')[0].toLowerCase()
    return supported.includes(base) ? base : 'en'
  })
  const [messages, setMessages] = useState<Messages>({})
  // Fallback to English for any missing keys to avoid showing raw keys
  const [fallbackMessages, setFallbackMessages] = useState<Messages>({})

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
  const loadFn = loaders[locale] || loaders['en']
        const mod = await loadFn()
        if (!active) return
        setMessages(mod.default || {})
      } catch {
        if (!active) return
        setMessages({})
      }
    }
    load()
    return () => { active = false }
  }, [locale])

  // Load English as a fallback once (and refresh if basePath changes implicitly)
  useEffect(() => {
    let active = true
    const loadFallback = async () => {
      try {
        const mod = await loaders['en']()
        if (!active) return
        setFallbackMessages(mod.default || {})
      } catch {
        if (!active) return
        setFallbackMessages({})
      }
    }
    loadFallback()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply text direction for RTL languages
  useEffect(() => {
    const rtlLocales = new Set(['fa', 'ar'])
    const dir = rtlLocales.has(locale) ? 'rtl' : 'ltr'
    try { document.documentElement.setAttribute('dir', dir) } catch {}
    try {
      document.documentElement.classList.toggle('rtl', dir === 'rtl')
    } catch {}
  }, [locale])

  const setLocale = (loc: string) => {
    setLocaleState(loc)
    try { localStorage.setItem(LOCALE_STORAGE_KEY, loc) } catch {}
  }

  const t = useMemo(() => {
    const format = (key: string, vars?: Record<string, string | number>) => {
    const hasPrimary = Object.prototype.hasOwnProperty.call(messages, key)
    const val = hasPrimary ? messages[key] : fallbackMessages[key]
    if (typeof val === 'undefined') {
        if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn(`[i18n] Missing key for locale "${locale}":`, key)
        }
      }
      const template = val ?? key
      if (!vars) return template
      return Object.keys(vars).reduce((out, k) => out.replace(new RegExp(`{${k}}`, 'g'), String(vars[k]!)), template)
    }
    return format
  }, [messages, fallbackMessages, locale])

  const value: I18nContextType = {
    locale,
    setLocale,
    t,
    messages,
  availableLocales: (SUPPORTED_LOCALES as unknown as string[]).map(code => ({
      code,
      name: `${localeFlags[code] ? localeFlags[code] + ' ' : ''}${localeNames[code] || code}`.trim(),
    })),
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  // Update global translator whenever hook consumers render under provider
  try { currentT = ctx.t } catch {}
  return ctx
}
