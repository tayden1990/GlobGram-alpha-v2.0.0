import { useMemo, useState } from 'react'
import { refreshSubscriptions } from '../nostr/engine'
import { useChatStore } from '../state/chatStore'
import { useContactStore } from '../state/contactStore'
import { nip19 } from 'nostr-tools'
import { bytesToHex } from '../nostr/utils'
import { QRScan } from './QRScan'
import { useToast } from './Toast'
import { log } from './logger'
import { useI18n } from '../i18n'

interface WhatsAppHomePageProps {
  onChatSelect: (peer: string) => void
  onSettingsOpen: () => void
  onNewChatOpen: () => void
  onQRScanOpen: () => void
}

export function WhatsAppHomePage({ onChatSelect, onSettingsOpen, onNewChatOpen, onQRScanOpen }: WhatsAppHomePageProps) {
  const { t } = useI18n()
  const { show } = useToast()
  const conversations = useChatStore(s => s.conversations)
  const aliases = useContactStore(s => s.aliases)
  const setAlias = useContactStore(s => s.setAlias)
  const lastRead = useChatStore(s => s.lastRead)
  const [searchText, setSearchText] = useState('')

  const peers = useMemo(() => {
    const keys = Object.keys(conversations)
    const filtered = searchText
      ? keys.filter(pk => {
          const name = aliases[pk] || pk.slice(0, 10)
          return name.toLowerCase().includes(searchText.toLowerCase())
        })
      : keys
    
    return filtered.sort((a, b) => {
      const la = conversations[a]?.[conversations[a].length - 1]?.ts ?? 0
      const lb = conversations[b]?.[conversations[b].length - 1]?.ts ?? 0
      return lb - la
    })
  }, [conversations, aliases, searchText])

  const formatLastMessage = (last: any) => {
    if (last.text) return last.text
    if (last.attachments && last.attachments.length > 0) {
      return `📎 ${last.attachments.length} فایل`
    }
    if (last.attachment) {
      if (last.attachment.startsWith('data:image/')) return '📷 عکس'
      if (last.attachment.startsWith('data:video/')) return '🎥 ویدیو'
      if (last.attachment.startsWith('data:audio/')) return '🎵 صدا'
      return '📎 فایل'
    }
    return ''
  }

  const formatTime = (timestamp: number) => {
    const now = new Date()
    const msgDate = new Date(timestamp * 1000)
    
    if (now.toDateString() === msgDate.toDateString()) {
      return msgDate.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
    }
    
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (yesterday.toDateString() === msgDate.toDateString()) {
      return 'دیروز'
    }
    
    return msgDate.toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="whatsapp-home">
      {/* Header */}
      <div className="wa-header">
        <h1>گلوب گرام</h1>
        <div className="wa-header-actions">
          <button className="wa-icon-btn" onClick={onQRScanOpen} title="اسکن QR">
            📷
          </button>
          <button className="wa-icon-btn" onClick={onNewChatOpen} title="چت جدید">
            ✏️
          </button>
          <button className="wa-icon-btn" onClick={onSettingsOpen} title="تنظیمات">
            ⚙️
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="wa-search">
        <div className="wa-search-input">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="جستجو در چت‌ها..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
      </div>

      {/* Chat List */}
      <div className="wa-chat-list">
        {peers.length === 0 && !searchText && (
          <div className="wa-empty-state">
            <div className="empty-icon">💬</div>
            <h3>هنوز چت‌ای نداری!</h3>
            <p>با کلیک روی دکمه چت جدید شروع کن</p>
            <button className="wa-primary-btn" onClick={onNewChatOpen}>
              شروع چت جدید
            </button>
          </div>
        )}

        {peers.length === 0 && searchText && (
          <div className="wa-empty-state">
            <div className="empty-icon">🔍</div>
            <p>چت‌ای پیدا نشد</p>
          </div>
        )}

        {peers.map(pk => {
          const msgs = conversations[pk]
          const last = msgs[msgs.length - 1]
          const name = aliases[pk] || `${pk.slice(0, 8)}...`
          const unread = msgs.filter(m => m.ts > (lastRead[pk] || 0)).length
          
          return (
            <div
              key={pk}
              className="wa-chat-item"
              onClick={() => onChatSelect(pk)}
            >
              <div className="wa-avatar">
                <div className="avatar-circle">
                  {name.charAt(0).toUpperCase()}
                </div>
              </div>
              
              <div className="wa-chat-content">
                <div className="wa-chat-header">
                  <span className="wa-chat-name">{name}</span>
                  {last && (
                    <span className="wa-chat-time">
                      {formatTime(last.ts)}
                    </span>
                  )}
                </div>
                
                <div className="wa-chat-footer">
                  <span className="wa-last-message">
                    {last ? formatLastMessage(last) : 'هنوز پیامی نفرستاده‌ای'}
                  </span>
                  {unread > 0 && (
                    <span className="wa-unread-badge">{unread}</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
