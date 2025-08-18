import { useEffect, useState } from 'react'
import Logo from './Logo'

import { memo } from 'react'
import { useI18n } from '../i18n'

function SplashImpl() {
  const { t } = useI18n()
  const already = (() => { try { return sessionStorage.getItem('splash_done') === '1' } catch { return false } })()
  const [show, setShow] = useState(!already)
  useEffect(() => {
    if (already) return
    try { sessionStorage.setItem('splash_done', '1') } catch {}
    const id = setTimeout(() => setShow(false), 1100) // short, non-blocking splash
    const onVis = () => { if (document.visibilityState === 'hidden') setShow(false) }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearTimeout(id); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  if (!show) return null
  return (
    <div className="splash-overlay" role="status" aria-label={t('common.loading')}>
      <div className="splash-card">
        <Logo size={84} animated />
        <div className="splash-text">{t('common.loading')}</div>
      </div>
    </div>
  )
}

export default memo(SplashImpl)
