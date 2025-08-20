import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './ui/App'
import { I18nProvider } from './i18n'
import './ui/styles.css'

const root = createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
)
// PWA service worker registration (disabled in dev to prevent caching during HMR)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const isDev = !!(import.meta as any).env?.DEV || location.hostname === 'localhost'
    if (isDev) {
      // Unregister any existing SWs to avoid stale caches during development
      navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister().catch(()=>{}))).catch(()=>{})
    } else {
      const swUrl = (import.meta as any).env?.BASE_URL ? `${(import.meta as any).env.BASE_URL}sw.js` : 'sw.js'
      navigator.serviceWorker.register(swUrl).catch(()=>{})
    }
  })
}
// Update theme-color based on data-theme
const themeMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
const applyThemeColor = () => {
  const t = document.documentElement.getAttribute('data-theme')
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = t ? t === 'dark' : prefersDark
  if (themeMeta) themeMeta.content = dark ? '#0f1115' : '#1976d2'
}
applyThemeColor()
new MutationObserver(applyThemeColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyThemeColor)
