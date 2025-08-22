import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useChatStore } from '../state/chatStore'
import { useContactStore } from '../state/contactStore'
import { sendDM } from '../nostr/engine'
import { blobToDataURL, dataURLSize, MAX_ATTACHMENT_BYTES, prepareBlobForSend } from '../nostr/utils'
import { useToast } from './Toast'
import { log } from './logger'
import { useI18n } from '../i18n'

interface WhatsAppChatPageProps {
  peer: string
  onBack: () => void
  onSettingsOpen: () => void
}

export function WhatsAppChatPage({ peer, onBack, onSettingsOpen }: WhatsAppChatPageProps) {
  const { t } = useI18n()
  const { show } = useToast()
  const conversations = useChatStore(s => s.conversations)
  const myPubkey = useChatStore(s => s.myPubkey)
  const markRead = useChatStore(s => s.markRead)
  const aliases = useContactStore(s => s.aliases)
  const setAlias = useContactStore(s => s.setAlias)
  
  const [message, setMessage] = useState('')
  const [attachment, setAttachment] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  const msgs = useMemo(() => conversations[peer] ?? [], [conversations, peer])
  const peerName = aliases[peer] || `${peer.slice(0, 8)}...`

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  // Mark as read when opening chat
  useEffect(() => {
    markRead(peer)
  }, [peer, markRead])

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000)
    return date.toLocaleTimeString('fa-IR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  const formatDate = (timestamp: number) => {
    const now = new Date()
    const msgDate = new Date(timestamp * 1000)
    
    if (now.toDateString() === msgDate.toDateString()) {
      return 'امروز'
    }
    
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (yesterday.toDateString() === msgDate.toDateString()) {
      return 'دیروز'
    }
    
    return msgDate.toLocaleDateString('fa-IR')
  }

  const handleSendMessage = async () => {
    if (!message.trim() && !attachment) return
    if (!myPubkey) return
    
    setSending(true)
    try {
      if (attachment) {
        await sendDM(peer, message.trim(), { a: attachment })
      } else {
        await sendDM(peer, message.trim(), {})
      }
      setMessage('')
      setAttachment(null)
    } catch (error: any) {
      show('خطا در ارسال پیام: ' + (error.message || error), 'error')
    } finally {
      setSending(false)
    }
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    
    if (file.size > MAX_ATTACHMENT_BYTES) {
      show(`حجم فایل باید کمتر از ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} مگابایت باشد`, 'error')
      return
    }
    
    try {
      const dataUrl = await prepareBlobForSend(file)
      setAttachment(dataUrl)
    } catch (error: any) {
      show('خطا در بارگذاری فایل: ' + (error.message || error), 'error')
    }
    
    // Reset input
    event.target.value = ''
  }

  const removeAttachment = () => {
    setAttachment(null)
  }

  const editAlias = () => {
    const newName = prompt('نام جدید را وارد کن:', peerName)
    if (newName !== null) {
      setAlias(peer, newName.trim())
    }
  }

  // Group messages by date
  const messageGroups = useMemo(() => {
    const groups: { [date: string]: typeof msgs } = {}
    msgs.forEach(msg => {
      const dateKey = formatDate(msg.ts)
      if (!groups[dateKey]) groups[dateKey] = []
      groups[dateKey].push(msg)
    })
    return groups
  }, [msgs])

  const emojis = ['😀', '😂', '😍', '🥰', '😘', '🤗', '🤔', '😊', '😎', '🥳', '👍', '👏', '🙏', '❤️', '💕', '🔥']

  return (
    <div className="whatsapp-chat">
      {/* Chat Header */}
      <div className="wa-chat-header-bar">
        <div className="wa-chat-header-left">
          <button className="wa-back-btn" onClick={onBack}>
            ←
          </button>
          <div className="wa-avatar-small">
            <div className="avatar-circle-small">
              {peerName.charAt(0).toUpperCase()}
            </div>
          </div>
          <div className="wa-chat-info">
            <h3 className="wa-chat-title">{peerName}</h3>
            <p className="wa-chat-status">آنلاین</p>
          </div>
        </div>
        <div className="wa-chat-header-right">
          <button className="wa-icon-btn" onClick={editAlias} title="ویرایش نام">
            ✏️
          </button>
          <button className="wa-icon-btn" onClick={onSettingsOpen} title="تنظیمات">
            ⚙️
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="wa-messages-container" ref={scrollerRef}>
        {Object.keys(messageGroups).length === 0 && (
          <div className="wa-empty-chat">
            <div className="empty-chat-icon">💬</div>
            <p>هنوز پیامی رد و بدل نشده</p>
            <p className="empty-chat-hint">اولین پیامت رو بفرست!</p>
          </div>
        )}

        {Object.entries(messageGroups).map(([date, messages]) => (
          <div key={date} className="wa-message-group">
            <div className="wa-date-separator">
              <span>{date}</span>
            </div>
            
            {messages.map((msg, index) => {
              const isMyMessage = msg.from === myPubkey
              const prevMsg = index > 0 ? messages[index - 1] : null
              const nextMsg = index < messages.length - 1 ? messages[index + 1] : null
              
              const isFirstInGroup = !prevMsg || prevMsg.from !== msg.from
              const isLastInGroup = !nextMsg || nextMsg.from !== msg.from
              
              return (
                <div
                  key={msg.id}
                  className={`wa-message ${isMyMessage ? 'wa-message-sent' : 'wa-message-received'} ${
                    isFirstInGroup ? 'wa-message-first' : ''
                  } ${isLastInGroup ? 'wa-message-last' : ''}`}
                >
                  <div className="wa-message-content">
                    {msg.attachment && (
                      <div className="wa-message-media">
                        {msg.attachment.startsWith('data:image/') && (
                          <img src={msg.attachment} alt="عکس" className="wa-message-image" />
                        )}
                        {msg.attachment.startsWith('data:video/') && (
                          <video src={msg.attachment} controls className="wa-message-video" />
                        )}
                        {msg.attachment.startsWith('data:audio/') && (
                          <audio src={msg.attachment} controls className="wa-message-audio" />
                        )}
                        {!msg.attachment.startsWith('data:image/') && 
                         !msg.attachment.startsWith('data:video/') && 
                         !msg.attachment.startsWith('data:audio/') && (
                          <div className="wa-message-file">
                            📎 فایل ضمیمه
                          </div>
                        )}
                      </div>
                    )}
                    
                    {msg.text && (
                      <div className="wa-message-text">
                        {msg.text}
                      </div>
                    )}
                    
                    <div className="wa-message-meta">
                      <span className="wa-message-time">{formatTime(msg.ts)}</span>
                      {isMyMessage && (
                        <span className={`wa-message-status ${
                          msg.status === 'delivered' ? 'delivered' : 
                          msg.status === 'failed' ? 'failed' : 'sent'
                        }`}>
                          {msg.status === 'delivered' ? '✓✓' : 
                           msg.status === 'failed' ? '!' : '✓'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Attachment Preview */}
      {attachment && (
        <div className="wa-attachment-preview">
          <div className="wa-attachment-content">
            {attachment.startsWith('data:image/') && (
              <img src={attachment} alt="پیش‌نمایش" className="wa-attachment-image" />
            )}
            {attachment.startsWith('data:video/') && (
              <video src={attachment} className="wa-attachment-video" />
            )}
            {!attachment.startsWith('data:image/') && !attachment.startsWith('data:video/') && (
              <div className="wa-attachment-file">📎 فایل انتخاب شده</div>
            )}
          </div>
          <button className="wa-remove-attachment" onClick={removeAttachment}>
            ✕
          </button>
        </div>
      )}

      {/* Emoji Picker */}
      {showEmojiPicker && (
        <div className="wa-emoji-picker">
          {emojis.map(emoji => (
            <button
              key={emoji}
              className="wa-emoji-btn"
              onClick={() => {
                setMessage(prev => prev + emoji)
                setShowEmojiPicker(false)
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="wa-input-area">
        <div className="wa-input-container">
          <button 
            className="wa-emoji-toggle" 
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          >
            😊
          </button>
          
          <input
            type="text"
            className="wa-message-input"
            placeholder="پیام بنویس..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !sending && handleSendMessage()}
            disabled={sending}
          />
          
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="wa-file-input"
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
            aria-label="انتخاب فایل"
          />
          
          <button 
            className="wa-attach-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            📎
          </button>
          
          <button
            className={`wa-send-btn ${(!message.trim() && !attachment) ? 'disabled' : ''}`}
            onClick={handleSendMessage}
            disabled={sending || (!message.trim() && !attachment)}
          >
            {sending ? '...' : '➤'}
          </button>
        </div>
      </div>
    </div>
  )
}
