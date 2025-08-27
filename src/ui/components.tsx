import React, { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react'

// ========================================
// Enhanced Button Component
// ========================================
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  fullWidth?: boolean
}

export function Button({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  isLoading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  className = '',
  disabled,
  ...props 
}: ButtonProps) {
  const baseClass = 'btn'
  const variantClass = `btn-${variant}`
  const sizeClass = size !== 'md' ? `btn-${size}` : ''
  const fullWidthClass = fullWidth ? 'w-full' : ''
  
  const classes = [baseClass, variantClass, sizeClass, fullWidthClass, className]
    .filter(Boolean)
    .join(' ')

  return (
    <button 
      className={classes}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <LoadingSpinner size="sm" />}
      {!isLoading && leftIcon && leftIcon}
      <span>{children}</span>
      {!isLoading && rightIcon && rightIcon}
    </button>
  )
}

// ========================================
// Enhanced Input Component
// ========================================
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  fullWidth?: boolean
}

export function Input({ 
  label, 
  error, 
  leftIcon, 
  rightIcon, 
  fullWidth = true,
  className = '',
  id,
  ...props 
}: InputProps) {
  const inputId = id || `input-${Math.random().toString(36).slice(2)}`
  
  return (
    <div className={`form-group ${fullWidth ? 'w-full' : ''}`}>
      {label && (
        <label htmlFor={inputId} className="form-label">
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted">
            {leftIcon}
          </div>
        )}
        <input
          id={inputId}
          className={`input ${leftIcon ? 'pl-10' : ''} ${rightIcon ? 'pr-10' : ''} ${className}`}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted">
            {rightIcon}
          </div>
        )}
      </div>
      {error && <span className="form-error">{error}</span>}
    </div>
  )
}

// ========================================
// Enhanced Card Component
// ========================================
interface CardProps {
  children: ReactNode
  className?: string
  hover?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

export function Card({ children, className = '', hover = false, padding = 'md' }: CardProps) {
  const hoverClass = hover ? 'hover:shadow-md hover:border-gray-300' : ''
  const paddingClass = padding !== 'none' ? `p-${padding}` : ''
  
  return (
    <div className={`card ${hoverClass} ${paddingClass} ${className}`}>
      {children}
    </div>
  )
}

export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card-header ${className}`}>{children}</div>
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card-body ${className}`}>{children}</div>
}

export function CardFooter({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card-footer ${className}`}>{children}</div>
}

// ========================================
// Enhanced Avatar Component
// ========================================
interface AvatarProps {
  src?: string
  alt?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  fallback?: string
  status?: 'online' | 'offline' | 'away' | 'busy'
  className?: string
}

export function Avatar({ 
  src, 
  alt = '', 
  size = 'md', 
  fallback, 
  status,
  className = '' 
}: AvatarProps) {
  const sizeClasses = {
    xs: 'w-6 h-6 text-xs',
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-base',
    lg: 'w-12 h-12 text-lg',
    xl: 'w-16 h-16 text-xl'
  }
  
  const statusColors = {
    online: 'bg-green-500',
    offline: 'bg-gray-400',
    away: 'bg-yellow-500',
    busy: 'bg-red-500'
  }
  
  return (
    <div className={`relative inline-block ${className}`}>
      <div className={`
        ${sizeClasses[size]} 
        rounded-full 
        overflow-hidden 
        bg-gray-200 
        flex 
        items-center 
        justify-center 
        font-medium 
        text-gray-600
      `}>
        {src ? (
          <img src={src} alt={alt} className="w-full h-full object-cover" />
        ) : (
          <span>{fallback || alt.charAt(0).toUpperCase()}</span>
        )}
      </div>
      {status && (
        <div className={`
          absolute 
          bottom-0 
          right-0 
          w-3 
          h-3 
          rounded-full 
          border-2 
          border-white 
          ${statusColors[status]}
        `} />
      )}
    </div>
  )
}

// ========================================
// Enhanced Badge Component
// ========================================
interface BadgeProps {
  children: ReactNode
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Badge({ children, variant = 'default', size = 'md', className = '' }: BadgeProps) {
  const baseClass = 'inline-flex items-center justify-center rounded-full font-medium'
  
  const variantClasses = {
    default: 'bg-gray-100 text-gray-800',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    error: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800'
  }
  
  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-4 py-2 text-base'
  }
  
  return (
    <span className={`${baseClass} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}>
      {children}
    </span>
  )
}

// ========================================
// Enhanced Loading Spinner
// ========================================
interface LoadingSpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

export function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
  const sizeClasses = {
    xs: 'w-3 h-3',
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6'
  }
  
  return (
    <div className={`loading-spinner ${sizeClasses[size]} ${className}`} />
  )
}

// ========================================
// Enhanced Skeleton Loader
// ========================================
interface SkeletonProps {
  width?: string | number
  height?: string | number
  className?: string
  variant?: 'text' | 'circular' | 'rectangular'
}

export function Skeleton({ 
  width, 
  height, 
  className = '', 
  variant = 'rectangular' 
}: SkeletonProps) {
  const variantClass = variant === 'circular' ? 'rounded-full' : 
                      variant === 'text' ? 'rounded' : 'rounded-md'
  
  const style = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height || (variant === 'text' ? '1em' : '20px')
  }
  
  return (
    <div 
      className={`skeleton ${variantClass} ${className}`}
      style={style}
    />
  )
}

// ========================================
// Enhanced Modal Component
// ========================================
interface ModalProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  className?: string
}

export function Modal({ 
  isOpen, 
  onClose, 
  children, 
  title, 
  size = 'md',
  className = '' 
}: ModalProps) {
  if (!isOpen) return null
  
  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-full mx-4'
  }
  
  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className={`
          bg-white 
          rounded-2xl 
          shadow-xl 
          w-full 
          ${sizeClasses[size]} 
          max-h-[90vh] 
          overflow-hidden
          ${className}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
            <button 
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>
        )}
        <div className={title ? 'p-6' : 'p-0'}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ========================================
// Enhanced Tooltip Component
// ========================================
interface TooltipProps {
  children: ReactNode
  content: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}

export function Tooltip({ 
  children, 
  content, 
  position = 'top',
  className = '' 
}: TooltipProps) {
  return (
    <div className={`relative group ${className}`}>
      {children}
      <div className={`
        absolute 
        z-50 
        invisible 
        group-hover:visible 
        opacity-0 
        group-hover:opacity-100 
        transition-all 
        duration-200 
        bg-gray-900 
        text-white 
        text-sm 
        rounded-lg 
        px-3 
        py-2 
        whitespace-nowrap
        ${position === 'top' ? 'bottom-full mb-2 left-1/2 transform -translate-x-1/2' :
          position === 'bottom' ? 'top-full mt-2 left-1/2 transform -translate-x-1/2' :
          position === 'left' ? 'right-full mr-2 top-1/2 transform -translate-y-1/2' :
          'left-full ml-2 top-1/2 transform -translate-y-1/2'}
      `}>
        {content}
        <div className={`
          absolute 
          w-2 
          h-2 
          bg-gray-900 
          transform 
          rotate-45
          ${position === 'top' ? 'top-full left-1/2 transform -translate-x-1/2 -mt-1' :
            position === 'bottom' ? 'bottom-full left-1/2 transform -translate-x-1/2 -mb-1' :
            position === 'left' ? 'left-full top-1/2 transform -translate-y-1/2 -ml-1' :
            'right-full top-1/2 transform -translate-y-1/2 -mr-1'}
        `} />
      </div>
    </div>
  )
}
