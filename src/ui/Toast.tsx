import { createContext, useContext, useEffect, useRef, useState } from 'react'

type Variant = 'info' | 'success' | 'error' | 'warning'
type Toast = { id: string; text: string; variant: Variant }

const ToastCtx = createContext<{ show: (text: string, variant?: Variant) => void } | null>(null)

// Lightweight event emitter so non-React modules can trigger toasts without importing React
export function emitToast(text: string, variant: Variant = 'info') {
  try {
    window.dispatchEvent(new CustomEvent('app:toast', { detail: { text, variant } }))
  } catch {}
}

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
    timerRef.current[id] = setTimeout(() => dismiss(id), variant === 'error' ? 5000 : 3000)
  }

  const getToastStyles = (variant: Variant) => {
    const baseStyles = 'flex items-start gap-3 p-4 rounded-xl shadow-lg border max-w-md transition-all duration-300 bg-white'
    
    switch (variant) {
      case 'success':
        return `${baseStyles} border-green-200 border-l-4 border-l-green-500`
      case 'error':
        return `${baseStyles} border-red-200 border-l-4 border-l-red-500`
      case 'warning':
        return `${baseStyles} border-yellow-200 border-l-4 border-l-yellow-500`
      default:
        return `${baseStyles} border-blue-200 border-l-4 border-l-blue-500`
    }
  }

  const getIcon = (variant: Variant) => {
    switch (variant) {
      case 'success': return '✅'
      case 'error': return '❌'
      case 'warning': return '⚠️'
      default: return 'ℹ️'
    }
  }

  // Listen for global toast events
  useEffect(() => {
    const onToast = (e: Event) => {
      try {
        const ce = e as CustomEvent
        const d = ce.detail as { text?: string; variant?: Variant }
        if (d && typeof d.text === 'string') show(d.text, d.variant)
      } catch {}
    }
    window.addEventListener('app:toast', onToast as any)
    return () => window.removeEventListener('app:toast', onToast as any)
  }, [])

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`${getToastStyles(t.variant)} pointer-events-auto animate-in slide-in-from-right`}>
            <span className="text-lg">{getIcon(t.variant)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 whitespace-pre-wrap break-words">
                {t.text}
              </p>
            </div>
            <button 
              onClick={() => dismiss(t.id)} 
              className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none"
              aria-label="Close notification"
            >
              ×
            </button>
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
