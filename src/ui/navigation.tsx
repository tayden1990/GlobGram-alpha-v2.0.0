import React, { useState, useEffect } from 'react'
import { Button } from './components'
import { useI18n } from '../i18n'

// ========================================
// Enhanced Mobile Navigation
// ========================================
interface MobileNavProps {
  activeTab: 'chats' | 'rooms'
  onTabChange: (tab: 'chats' | 'rooms') => void
  chatCount?: number
  roomCount?: number
  onMenuOpen?: () => void
}

export function MobileBottomNav({ 
  activeTab, 
  onTabChange, 
  chatCount = 0, 
  roomCount = 0,
  onMenuOpen 
}: MobileNavProps) {
  const { t } = useI18n()
  
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2 z-40 safe-bottom">
      <div className="flex items-center justify-around">
        <NavButton
          icon="💬"
          label={t('tabs.chats')}
          isActive={activeTab === 'chats'}
          count={chatCount}
          onClick={() => onTabChange('chats')}
        />
        <NavButton
          icon="🏠"
          label={t('tabs.rooms')}
          isActive={activeTab === 'rooms'}
          count={roomCount}
          onClick={() => onTabChange('rooms')}
        />
        <NavButton
          icon="⚙️"
          label={t('common.settings')}
          isActive={false}
          onClick={onMenuOpen || (() => {})}
        />
      </div>
    </nav>
  )
}

interface NavButtonProps {
  icon: string
  label: string
  isActive: boolean
  count?: number
  onClick: () => void
}

function NavButton({ icon, label, isActive, count, onClick }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`
        flex flex-col items-center justify-center p-2 rounded-lg transition-all duration-200
        ${isActive 
          ? 'text-blue-600 bg-blue-50' 
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
        }
      `}
    >
      <div className="relative">
        <span className="text-xl">{icon}</span>
        {(count ?? 0) > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {(count ?? 0) > 99 ? '99+' : count}
          </span>
        )}
      </div>
      <span className="text-xs mt-1 font-medium">{label}</span>
    </button>
  )
}

// ========================================
// Enhanced Desktop Sidebar
// ========================================
interface SidebarProps {
  children: React.ReactNode
  isCollapsed: boolean
  onToggle: () => void
  title: string
  width?: number
}

export function Sidebar({ children, isCollapsed, onToggle, title, width = 280 }: SidebarProps) {
  return (
    <aside 
      className={`
        bg-white border-r border-gray-200 transition-all duration-300 ease-in-out
        ${isCollapsed ? 'w-16' : `w-[${width}px]`}
      `}
      style={{ width: isCollapsed ? '64px' : `${width}px` }}
    >
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          {!isCollapsed && (
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          )}
          <button
            onClick={onToggle}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? '→' : '←'}
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      </div>
    </aside>
  )
}

// ========================================
// Enhanced Drawer Component
// ========================================
interface DrawerProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  title?: string
  position?: 'left' | 'right'
  width?: number
}

export function Drawer({ 
  isOpen, 
  onClose, 
  children, 
  title, 
  position = 'left',
  width = 320 
}: DrawerProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }
    
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])
  
  if (!isOpen) return null
  
  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-40 drawer-overlay"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div 
        className={`
          fixed top-0 bottom-0 z-50 bg-white shadow-xl
          transform transition-transform duration-300 ease-in-out
          ${position === 'left' 
            ? `left-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}` 
            : `right-0 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`
          }
        `}
        style={{ width: `${width}px` }}
      >
        {title && (
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
              aria-label="Close drawer"
            >
              ✕
            </button>
          </div>
        )}
        <div className="h-full overflow-y-auto">
          {children}
        </div>
      </div>
    </>
  )
}

// ========================================
// Enhanced Tab Navigation
// ========================================
interface TabsProps {
  value: string
  onValueChange: (value: string) => void
  children: React.ReactNode
  className?: string
}

export function Tabs({ value, onValueChange, children, className = '' }: TabsProps) {
  return (
    <div className={`w-full ${className}`} data-value={value} data-onchange={onValueChange}>
      {children}
    </div>
  )
}

interface TabsListProps {
  children: React.ReactNode
  className?: string
}

export function TabsList({ children, className = '' }: TabsListProps) {
  return (
    <div className={`flex bg-gray-100 rounded-lg p-1 ${className}`}>
      {children}
    </div>
  )
}

interface TabsTriggerProps {
  value: string
  children: React.ReactNode
  className?: string
}

export function TabsTrigger({ value, children, className = '' }: TabsTriggerProps) {
  // This would need context or props to work with the parent Tabs component
  // For now, it's a simplified version
  return (
    <button className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${className}`}>
      {children}
    </button>
  )
}

// ========================================
// Enhanced Header Component
// ========================================
interface HeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  onBack?: () => void
  className?: string
}

export function Header({ title, subtitle, actions, onBack, className = '' }: HeaderProps) {
  return (
    <header className={`bg-white border-b border-gray-200 px-4 py-3 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
              aria-label="Go back"
            >
              ←
            </button>
          )}
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
            {subtitle && (
              <p className="text-sm text-gray-600 mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  )
}

// ========================================
// Enhanced Search Bar
// ========================================
interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  onFocus?: () => void
  onBlur?: () => void
  className?: string
}

export function SearchBar({ 
  value, 
  onChange, 
  placeholder = 'Search...', 
  onFocus, 
  onBlur,
  className = '' 
}: SearchBarProps) {
  return (
    <div className={`relative ${className}`}>
      <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
        🔍
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        className="
          w-full pl-10 pr-4 py-2 
          border border-gray-300 rounded-lg 
          bg-white text-gray-900 
          placeholder-gray-500 
          focus:ring-2 focus:ring-blue-500 focus:border-blue-500 
          transition-colors
        "
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
          aria-label="Clear search"
        >
          ✕
        </button>
      )}
    </div>
  )
}
