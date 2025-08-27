import React, { useState } from 'react'
import { Modal, Button, Card, CardHeader, CardBody, Avatar, Badge } from './components'
import { useI18n } from '../i18n'
import { useSettingsStore } from './settingsStore'

// ========================================
// Enhanced Settings Modal
// ========================================
interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<'general' | 'privacy' | 'notifications' | 'appearance' | 'advanced'>('general')
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" title={t('settings.title')}>
      <div className="flex h-[600px]">
        {/* Settings Navigation */}
        <div className="w-1/3 border-r border-gray-200 pr-4">
          <nav className="space-y-1">
            <SettingsNavItem
              icon="⚙️"
              label={t('settings.general')}
              isActive={activeTab === 'general'}
              onClick={() => setActiveTab('general')}
            />
            <SettingsNavItem
              icon="🔒"
              label={t('settings.privacy')}
              isActive={activeTab === 'privacy'}
              onClick={() => setActiveTab('privacy')}
            />
            <SettingsNavItem
              icon="🔔"
              label={t('settings.notifications')}
              isActive={activeTab === 'notifications'}
              onClick={() => setActiveTab('notifications')}
            />
            <SettingsNavItem
              icon="🎨"
              label={t('settings.appearance')}
              isActive={activeTab === 'appearance'}
              onClick={() => setActiveTab('appearance')}
            />
            <SettingsNavItem
              icon="🔧"
              label={t('settings.advanced')}
              isActive={activeTab === 'advanced'}
              onClick={() => setActiveTab('advanced')}
            />
          </nav>
        </div>
        
        {/* Settings Content */}
        <div className="flex-1 pl-6 overflow-y-auto">
          {activeTab === 'general' && <GeneralSettings />}
          {activeTab === 'privacy' && <PrivacySettings />}
          {activeTab === 'notifications' && <NotificationSettings />}
          {activeTab === 'appearance' && <AppearanceSettings />}
          {activeTab === 'advanced' && <AdvancedSettings />}
        </div>
      </div>
    </Modal>
  )
}

// ========================================
// Settings Navigation Item
// ========================================
interface SettingsNavItemProps {
  icon: string
  label: string
  isActive: boolean
  onClick: () => void
  badge?: string
}

function SettingsNavItem({ icon, label, isActive, onClick, badge }: SettingsNavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors
        ${isActive 
          ? 'bg-blue-50 text-blue-700 border border-blue-200' 
          : 'text-gray-700 hover:bg-gray-50'
        }
      `}
    >
      <span className="text-lg">{icon}</span>
      <span className="flex-1 font-medium">{label}</span>
      {badge && (
        <Badge variant="error" size="sm">
          {badge}
        </Badge>
      )}
    </button>
  )
}

// ========================================
// General Settings
// ========================================
function GeneralSettings() {
  const { t, locale, setLocale, availableLocales } = useI18n()
  const [autoStart, setAutoStart] = useState(false)
  const [minimizeToTray, setMinimizeToTray] = useState(true)
  
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('settings.general')}</h3>
        
        <div className="space-y-4">
          {/* Language Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('settings.language')}
            </label>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {availableLocales.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>
          
          {/* Auto Start */}
          <SettingToggle
            label={t('settings.autoStart')}
            description={t('settings.autoStartDesc')}
            checked={autoStart}
            onChange={setAutoStart}
          />
          
          {/* Minimize to Tray */}
          <SettingToggle
            label={t('settings.minimizeToTray')}
            description={t('settings.minimizeToTrayDesc')}
            checked={minimizeToTray}
            onChange={setMinimizeToTray}
          />
        </div>
      </div>
    </div>
  )
}

// ========================================
// Privacy Settings
// ========================================
function PrivacySettings() {
  const { t } = useI18n()
  const [readReceipts, setReadReceipts] = useState(true)
  const [onlineStatus, setOnlineStatus] = useState(true)
  const [blockUnknown, setBlockUnknown] = useState(false)
  
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('settings.privacy')}</h3>
        
        <div className="space-y-4">
          <SettingToggle
            label={t('settings.readReceipts')}
            description={t('settings.readReceiptsDesc')}
            checked={readReceipts}
            onChange={setReadReceipts}
          />
          
          <SettingToggle
            label={t('settings.onlineStatus')}
            description={t('settings.onlineStatusDesc')}
            checked={onlineStatus}
            onChange={setOnlineStatus}
          />
          
          <SettingToggle
            label={t('settings.blockUnknown')}
            description={t('settings.blockUnknownDesc')}
            checked={blockUnknown}
            onChange={setBlockUnknown}
          />
        </div>
      </div>
      
      <div className="border-t border-gray-200 pt-6">
        <h4 className="text-md font-medium text-gray-900 mb-3">{t('settings.dataManagement')}</h4>
        <div className="space-y-3">
          <Button variant="secondary" size="sm">
            {t('settings.exportData')}
          </Button>
          <Button variant="danger" size="sm">
            {t('settings.deleteAccount')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ========================================
// Notification Settings
// ========================================
function NotificationSettings() {
  const { t } = useI18n()
  const [desktopNotifications, setDesktopNotifications] = useState(true)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [messagePreview, setMessagePreview] = useState(true)
  
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('settings.notifications')}</h3>
        
        <div className="space-y-4">
          <SettingToggle
            label={t('settings.desktopNotifications')}
            description={t('settings.desktopNotificationsDesc')}
            checked={desktopNotifications}
            onChange={setDesktopNotifications}
          />
          
          <SettingToggle
            label={t('settings.soundEnabled')}
            description={t('settings.soundEnabledDesc')}
            checked={soundEnabled}
            onChange={setSoundEnabled}
          />
          
          <SettingToggle
            label={t('settings.messagePreview')}
            description={t('settings.messagePreviewDesc')}
            checked={messagePreview}
            onChange={setMessagePreview}
          />
        </div>
      </div>
    </div>
  )
}

// ========================================
// Appearance Settings
// ========================================
function AppearanceSettings() {
  const { t } = useI18n()
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system')
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>('medium')
  const [compactMode, setCompactMode] = useState(false)
  
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('settings.appearance')}</h3>
        
        <div className="space-y-4">
          {/* Theme Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              {t('settings.theme')}
            </label>
            <div className="grid grid-cols-3 gap-3">
              <ThemeOption
                label={t('settings.themeSystem')}
                value="system"
                selected={theme === 'system'}
                onClick={() => setTheme('system')}
                preview="🖥️"
              />
              <ThemeOption
                label={t('settings.themeLight')}
                value="light"
                selected={theme === 'light'}
                onClick={() => setTheme('light')}
                preview="☀️"
              />
              <ThemeOption
                label={t('settings.themeDark')}
                value="dark"
                selected={theme === 'dark'}
                onClick={() => setTheme('dark')}
                preview="🌙"
              />
            </div>
          </div>
          
          {/* Font Size */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('settings.fontSize')}
            </label>
            <select
              value={fontSize}
              onChange={(e) => setFontSize(e.target.value as any)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="small">{t('settings.fontSizeSmall')}</option>
              <option value="medium">{t('settings.fontSizeMedium')}</option>
              <option value="large">{t('settings.fontSizeLarge')}</option>
            </select>
          </div>
          
          <SettingToggle
            label={t('settings.compactMode')}
            description={t('settings.compactModeDesc')}
            checked={compactMode}
            onChange={setCompactMode}
          />
        </div>
      </div>
    </div>
  )
}

// ========================================
// Advanced Settings
// ========================================
function AdvancedSettings() {
  const { t } = useI18n()
  const { powMining, setPowMining } = useSettingsStore()
  const [enableLogs, setEnableLogs] = useState(false)
  const [betaFeatures, setBetaFeatures] = useState(false)
  
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('settings.advanced')}</h3>
        
        <div className="space-y-4">
          <SettingToggle
            label={t('settings.powMining')}
            description={t('settings.powMiningDesc')}
            checked={powMining}
            onChange={setPowMining}
          />
          
          <SettingToggle
            label={t('settings.enableLogs')}
            description={t('settings.enableLogsDesc')}
            checked={enableLogs}
            onChange={setEnableLogs}
          />
          
          <SettingToggle
            label={t('settings.betaFeatures')}
            description={t('settings.betaFeaturesDesc')}
            checked={betaFeatures}
            onChange={setBetaFeatures}
          />
        </div>
      </div>
      
      <div className="border-t border-gray-200 pt-6">
        <h4 className="text-md font-medium text-gray-900 mb-3">{t('settings.troubleshooting')}</h4>
        <div className="space-y-3">
          <Button variant="secondary" size="sm">
            {t('settings.clearCache')}
          </Button>
          <Button variant="secondary" size="sm">
            {t('settings.resetSettings')}
          </Button>
          <Button variant="secondary" size="sm">
            {t('settings.exportLogs')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ========================================
// Setting Toggle Component
// ========================================
interface SettingToggleProps {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

function SettingToggle({ label, description, checked, onChange, disabled = false }: SettingToggleProps) {
  return (
    <div className="flex items-start justify-between py-2">
      <div className="flex-1">
        <h4 className="text-sm font-medium text-gray-900">{label}</h4>
        {description && (
          <p className="text-sm text-gray-600 mt-1">{description}</p>
        )}
      </div>
      <div className="ml-4">
        <button
          type="button"
          onClick={() => !disabled && onChange(!checked)}
          disabled={disabled}
          className={`
            relative inline-flex h-6 w-11 items-center rounded-full transition-colors
            ${checked 
              ? 'bg-blue-600' 
              : 'bg-gray-200'
            }
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <span
            className={`
              inline-block h-4 w-4 transform rounded-full bg-white transition-transform
              ${checked ? 'translate-x-6' : 'translate-x-1'}
            `}
          />
        </button>
      </div>
    </div>
  )
}

// ========================================
// Theme Option Component
// ========================================
interface ThemeOptionProps {
  label: string
  value: string
  selected: boolean
  onClick: () => void
  preview: string
}

function ThemeOption({ label, value, selected, onClick, preview }: ThemeOptionProps) {
  return (
    <button
      onClick={onClick}
      className={`
        flex flex-col items-center p-3 rounded-lg border-2 transition-colors
        ${selected 
          ? 'border-blue-500 bg-blue-50' 
          : 'border-gray-200 hover:border-gray-300'
        }
      `}
    >
      <span className="text-2xl mb-2">{preview}</span>
      <span className="text-xs font-medium text-gray-700">{label}</span>
    </button>
  )
}

// ========================================
// User Profile Settings
// ========================================
interface UserProfileSettingsProps {
  isOpen: boolean
  onClose: () => void
  user: {
    name: string
    avatar?: string
    pubkey: string
    bio?: string
  }
}

export function UserProfileSettings({ isOpen, onClose, user }: UserProfileSettingsProps) {
  const { t } = useI18n()
  const [name, setName] = useState(user.name)
  const [bio, setBio] = useState(user.bio || '')
  const [avatar, setAvatar] = useState(user.avatar || '')
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" title={t('profile.editProfile')}>
      <div className="space-y-6">
        {/* Avatar Section */}
        <div className="flex items-center gap-4">
          <Avatar
            src={avatar}
            alt={name}
            size="xl"
            fallback={name.charAt(0)}
          />
          <div className="space-y-2">
            <Button variant="secondary" size="sm">
              {t('profile.changeAvatar')}
            </Button>
            <Button variant="ghost" size="sm">
              {t('profile.removeAvatar')}
            </Button>
          </div>
        </div>
        
        {/* Name Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('profile.displayName')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        
        {/* Bio Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('profile.bio')}
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder={t('profile.bioPlaceholder')}
          />
        </div>
        
        {/* Public Key Display */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('profile.publicKey')}
          </label>
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
            <code className="text-xs text-gray-600 break-all">
              {user.pubkey}
            </code>
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary">
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
