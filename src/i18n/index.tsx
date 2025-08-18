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

// Statically declare supported locales and dynamic imports so bundlers include json
const loaders: Record<string, () => Promise<{ default: Messages }>> = {
  en: () => import('./locales/en.json'),
  fa: () => import('./locales/fa.json'),
  es: () => import('./locales/es.json'),
  fr: () => import('./locales/fr.json'),
  de: () => import('./locales/de.json'),
  pt: () => import('./locales/pt.json'),
  ru: () => import('./locales/ru.json'),
  ar: () => import('./locales/ar.json'),
}

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
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored) return stored
    const nav = typeof navigator !== 'undefined' ? navigator.language || (navigator as any).userLanguage : 'en'
    const base = (nav || 'en').split('-')[0].toLowerCase()
    const supported = Object.keys(loaders)
    return supported.includes(base) ? base : 'en'
  })
  const [messages, setMessages] = useState<Messages>({})

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
      const val = messages[key]
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
  }, [messages, locale])

  const value: I18nContextType = {
    locale,
    setLocale,
    t,
    messages,
    availableLocales: Object.keys(loaders).map(code => ({
      code,
      name: `${localeFlags[code] ? localeFlags[code] + ' ' : ''}${localeNames[code] || code}`.trim(),
    })),
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
