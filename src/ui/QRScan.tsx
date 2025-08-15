import { useEffect, useRef, useState } from 'react'
import { log } from './logger'

// Minimal QR scan using native BarcodeDetector if available (Chromium). Falls back to input file if not.
export function QRScan({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [supported, setSupported] = useState<boolean>(false)

  useEffect(() => {
    // @ts-ignore
  const ok = !!(window as any).BarcodeDetector
  setSupported(ok)
  try { log(`QRScan.supported=${ok}`) } catch {}
  }, [])

  useEffect(() => {
    let stream: MediaStream | null = null
    let detector: any = null
    let raf = 0
  const start = async () => {
      try {
    if (!supported) return
    try { log('QRScan.camera.start') } catch {}
        // @ts-ignore
        detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        const tick = async () => {
          raf = requestAnimationFrame(tick)
          if (!videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            const text = codes?.[0]?.rawValue
            if (text) {
        try { log(`QRScan.camera.detected: ${String(text).slice(0, 64)}`) } catch {}
              onResult(text)
            }
      } catch (e: any) { try { log(`QRScan.camera.detect.error: ${e?.message||e}`) } catch {} }
        }
        tick()
    } catch (e: any) { try { log(`QRScan.camera.start.error: ${e?.message||e}`) } catch {} }
    }
    start()
    return () => {
      cancelAnimationFrame(raf)
      if (stream) stream.getTracks().forEach(t => t.stop())
    }
  }, [supported])

  const onFile = async (file?: File) => {
    try {
      const f = file
      if (!f) return
      try { log(`QRScan.file.selected name=${f.name} size=${f.size}`) } catch {}
      const url = URL.createObjectURL(f)
      // @ts-ignore
      if (window.BarcodeDetector) {
        // @ts-ignore
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        const img = new Image()
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = reject
          img.src = url
        })
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        // @ts-ignore
        const codes = await detector.detect(canvas)
        const text = codes?.[0]?.rawValue
        if (text) { try { log(`QRScan.file.detected: ${String(text).slice(0, 64)}`) } catch {}; onResult(text) }
      }
      URL.revokeObjectURL(url)
    } catch (e: any) { try { log(`QRScan.file.error: ${e?.message||e}`) } catch {} }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 10000 }}>
      <div style={{ background: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--border)', padding: 16, borderRadius: 8, width: 360 }}>
        <h3 style={{ marginTop: 0 }}>Scan npub QR</h3>
        {supported ? (
          <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', borderRadius: 8, background: '#000' }} />
        ) : (
          <div>
            <p>QR scanning not supported. Pick a photo with a QR code:</p>
            <input type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0] || undefined)} />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={() => { try { log('QRScan.close') } catch {}; onClose() }}>Close</button>
        </div>
      </div>
    </div>
  )
}
