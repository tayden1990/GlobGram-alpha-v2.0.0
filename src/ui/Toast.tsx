import { createContext, useContext, useRef, useState } from 'react'

type Variant = 'info' | 'success' | 'error'
type Toast = { id: string; text: string; variant: Variant }

const ToastCtx = createContext<{ show: (text: string, variant?: Variant) => void } | null>(null)

export function ToastProvider({ children }: { children: any }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timerRef = useRef<Record<string, any>>({})

  const dismiss = (id: string) => {
    setToasts(t => t.filter(x => x.id !== id))
    if (timerRef.current[id]) {
      clearTimeout(timerRef.current[id])
      delete timerRef.current[id]
    }
  }

  const show = (text: string, variant: Variant = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(t => [...t, { id, text, variant }])
    timerRef.current[id] = setTimeout(() => dismiss(id), 2200)
  }

  const bgFor = (v: Variant) => v === 'success' ? '#2e7d32' : v === 'error' ? '#c62828' : 'rgba(0,0,0,0.85)'

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div style={{ position: 'fixed', bottom: 16, right: 16, display: 'grid', gap: 8, zIndex: 9999 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ background: bgFor(t.variant), color: '#fff', padding: '8px 12px', borderRadius: 8, maxWidth: 360, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1 }}>{t.text}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Close" title="Close" style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) return { show: (_: string, __?: Variant) => {} }
  return ctx
}
