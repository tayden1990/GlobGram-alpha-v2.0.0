import React, { useState } from 'react'

type Props = {
  size?: number
  animated?: boolean
  title?: string
  style?: React.CSSProperties
}

export function Logo({ size = 64, animated = false, title = 'GlobGram', style }: Props) {
  const [src, setSrc] = useState<string>('/branding/logo.png')
  const cls = animated ? 'app-logo app-logo-anim' : 'app-logo'
  return (
    <img
      src={src}
      onError={() => setSrc('/icons/icon.svg')}
      alt={title}
      width={size}
      height={size}
      className={cls}
      style={{ width: size, height: size, display: 'inline-block', ...style }}
    />
  )
}

export default Logo
