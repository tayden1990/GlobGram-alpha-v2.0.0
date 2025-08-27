import React, { useState, useRef, useEffect } from 'react'
import { Avatar, Badge, Button, Tooltip } from './components'
import { useI18n } from '../i18n'

// ========================================
// Enhanced Message Bubble
// ========================================
interface MessageBubbleProps {
  content: string
  isOwn: boolean
  timestamp: Date
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
  sender?: {
    name: string
    avatar?: string
    pubkey: string
  }
  attachments?: Array<{
    type: 'image' | 'video' | 'audio' | 'file'
    url: string
    name?: string
    size?: number
  }>
  reactions?: Array<{
    emoji: string
    count: number
    users: string[]
    hasReacted: boolean
  }>
  isEdited?: boolean
  onReact?: (emoji: string) => void
  onReply?: () => void
  onEdit?: () => void
  onDelete?: () => void
  className?: string
}

export function MessageBubble({
  content,
  isOwn,
  timestamp,
  status = 'sent',
  sender,
  attachments = [],
  reactions = [],
  isEdited = false,
  onReact,
  onReply,
  onEdit,
  onDelete,
  className = ''
}: MessageBubbleProps) {
  const { t } = useI18n()
  const [showActions, setShowActions] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  
  const bubbleRef = useRef<HTMLDivElement>(null)
  
  const statusIcons = {
    sending: '🕐',
    sent: '✓',
    delivered: '✓✓',
    read: '✓✓',
    failed: '❌'
  }
  
  return (
    <div 
      className={`
        group flex gap-3 mb-4
        ${isOwn ? 'flex-row-reverse' : 'flex-row'}
        ${className}
      `}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Avatar (only show for others' messages) */}
      {!isOwn && sender && (
        <Avatar
          src={sender.avatar}
          alt={sender.name}
          size="sm"
          fallback={sender.name.charAt(0)}
        />
      )}
      
      <div className={`flex flex-col max-w-[70%] ${isOwn ? 'items-end' : 'items-start'}`}>
        {/* Sender name (only show for others' messages in groups) */}
        {!isOwn && sender && (
          <span className="text-xs text-gray-600 mb-1 px-3">
            {sender.name}
          </span>
        )}
        
        {/* Message bubble */}
        <div
          ref={bubbleRef}
          className={`
            relative px-4 py-2 rounded-2xl max-w-full
            ${isOwn 
              ? 'bg-blue-500 text-white rounded-br-md' 
              : 'bg-gray-100 text-gray-900 rounded-bl-md'
            }
            ${attachments.length > 0 ? 'pb-1' : ''}
          `}
        >
          {/* Text content */}
          {content && (
            <div className="whitespace-pre-wrap break-words">
              {content}
              {isEdited && (
                <span className={`text-xs ml-2 ${isOwn ? 'text-blue-200' : 'text-gray-500'}`}>
                  ({t('message.edited')})
                </span>
              )}
            </div>
          )}
          
          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="mt-2 space-y-2">
              {attachments.map((attachment, index) => (
                <AttachmentPreview
                  key={index}
                  attachment={attachment}
                  className="rounded-lg overflow-hidden"
                />
              ))}
            </div>
          )}
          
          {/* Reactions */}
          {reactions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {reactions.map((reaction, index) => (
                <button
                  key={index}
                  onClick={() => onReact?.(reaction.emoji)}
                  className={`
                    flex items-center gap-1 px-2 py-1 rounded-full text-xs
                    transition-colors duration-200
                    ${reaction.hasReacted
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }
                  `}
                >
                  <span>{reaction.emoji}</span>
                  <span>{reaction.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* Message metadata */}
        <div className={`flex items-center gap-1 mt-1 text-xs text-gray-500 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
          <span>{formatTime(timestamp)}</span>
          {isOwn && (
            <span className={`${status === 'read' ? 'text-blue-500' : ''}`}>
              {statusIcons[status]}
            </span>
          )}
        </div>
      </div>
      
      {/* Message actions */}
      {showActions && (
        <div className={`
          flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity
          ${isOwn ? 'order-first mr-2' : 'order-last ml-2'}
        `}>
          <Tooltip content={t('message.react')}>
            <button
              onClick={() => setShowReactions(!showReactions)}
              className="p-1 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700"
            >
              😊
            </button>
          </Tooltip>
          
          {onReply && (
            <Tooltip content={t('message.reply')}>
              <button
                onClick={onReply}
                className="p-1 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700"
              >
                ↩️
              </button>
            </Tooltip>
          )}
          
          {isOwn && onEdit && (
            <Tooltip content={t('message.edit')}>
              <button
                onClick={onEdit}
                className="p-1 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700"
              >
                ✏️
              </button>
            </Tooltip>
          )}
          
          {isOwn && onDelete && (
            <Tooltip content={t('message.delete')}>
              <button
                onClick={onDelete}
                className="p-1 rounded-full hover:bg-gray-100 text-red-500 hover:text-red-700"
              >
                🗑️
              </button>
            </Tooltip>
          )}
        </div>
      )}
      
      {/* Reaction picker */}
      {showReactions && (
        <ReactionPicker
          onReact={(emoji) => {
            onReact?.(emoji)
            setShowReactions(false)
          }}
          onClose={() => setShowReactions(false)}
          position={isOwn ? 'left' : 'right'}
        />
      )}
    </div>
  )
}

// ========================================
// Attachment Preview Component
// ========================================
interface AttachmentPreviewProps {
  attachment: {
    type: 'image' | 'video' | 'audio' | 'file'
    url: string
    name?: string
    size?: number
  }
  className?: string
}

function AttachmentPreview({ attachment, className = '' }: AttachmentPreviewProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }
  
  switch (attachment.type) {
    case 'image':
      return (
        <div className={`relative ${className}`}>
          <img
            src={attachment.url}
            alt={attachment.name || 'Image'}
            className="max-w-full h-auto rounded-lg"
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setIsLoading(false)
              setError(true)
            }}
          />
          {isLoading && (
            <div className="absolute inset-0 bg-gray-200 animate-pulse rounded-lg flex items-center justify-center">
              <span className="text-gray-500">Loading...</span>
            </div>
          )}
          {error && (
            <div className="bg-gray-100 p-4 rounded-lg text-center text-gray-500">
              Failed to load image
            </div>
          )}
        </div>
      )
      
    case 'video':
      return (
        <video
          src={attachment.url}
          controls
          className={`max-w-full h-auto rounded-lg ${className}`}
          poster={attachment.url} // You might want a separate thumbnail
        />
      )
      
    case 'audio':
      return (
        <audio
          src={attachment.url}
          controls
          className={`w-full ${className}`}
        />
      )
      
    case 'file':
    default:
      return (
        <div className={`
          flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200
          hover:bg-gray-100 transition-colors cursor-pointer ${className}
        `}>
          <div className="flex-shrink-0 w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center">
            📄
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {attachment.name || 'Unknown file'}
            </p>
            {attachment.size && (
              <p className="text-xs text-gray-500">
                {formatFileSize(attachment.size)}
              </p>
            )}
          </div>
          <div className="flex-shrink-0 text-gray-400">
            ⬇️
          </div>
        </div>
      )
  }
}

// ========================================
// Reaction Picker Component
// ========================================
interface ReactionPickerProps {
  onReact: (emoji: string) => void
  onClose: () => void
  position?: 'left' | 'right'
}

function ReactionPicker({ onReact, onClose, position = 'right' }: ReactionPickerProps) {
  const commonEmojis = ['👍', '❤️', '😂', '😮', '😢', '😡', '👏', '🎉']
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      onClose()
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])
  
  return (
    <div 
      className={`
        absolute z-10 bg-white border border-gray-200 rounded-lg shadow-lg p-2
        ${position === 'left' ? 'right-0' : 'left-0'}
        top-full mt-1
      `}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex gap-1">
        {commonEmojis.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onReact(emoji)}
            className="p-2 hover:bg-gray-100 rounded-md transition-colors text-lg"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}

// ========================================
// Message Input Component
// ========================================
interface MessageInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onAttach?: () => void
  onRecord?: () => void
  placeholder?: string
  disabled?: boolean
  isRecording?: boolean
  className?: string
}

export function MessageInput({
  value,
  onChange,
  onSend,
  onAttach,
  onRecord,
  placeholder = 'Type a message...',
  disabled = false,
  isRecording = false,
  className = ''
}: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`
    }
  }, [value])
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !disabled) {
        onSend()
      }
    }
  }
  
  return (
    <div className={`flex items-end gap-2 p-4 bg-white border-t border-gray-200 ${className}`}>
      {/* Attach button */}
      {onAttach && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAttach}
          disabled={disabled}
          className="flex-shrink-0"
          aria-label="Attach file"
        >
          📎
        </Button>
      )}
      
      {/* Message input */}
      <div className="flex-1 relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="
            w-full resize-none rounded-2xl border border-gray-300 px-4 py-2
            focus:ring-2 focus:ring-blue-500 focus:border-blue-500
            disabled:opacity-50 disabled:cursor-not-allowed
            max-h-[120px] min-h-[40px]
          "
        />
      </div>
      
      {/* Record/Send button */}
      <div className="flex-shrink-0">
        {value.trim() ? (
          <Button
            variant="primary"
            size="sm"
            onClick={onSend}
            disabled={disabled}
            className="rounded-full aspect-square"
            aria-label="Send message"
          >
            ➤
          </Button>
        ) : onRecord ? (
          <Button
            variant={isRecording ? "danger" : "ghost"}
            size="sm"
            onClick={onRecord}
            disabled={disabled}
            className="rounded-full aspect-square"
            aria-label={isRecording ? "Stop recording" : "Record voice message"}
          >
            {isRecording ? '⏹️' : '🎤'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

// ========================================
// Typing Indicator Component
// ========================================
interface TypingIndicatorProps {
  users: Array<{ name: string; avatar?: string }>
  className?: string
}

export function TypingIndicator({ users, className = '' }: TypingIndicatorProps) {
  const { t } = useI18n()
  
  if (users.length === 0) return null
  
  const getTypingText = () => {
    if (users.length === 1) {
      return t('typing.single', { name: users[0].name })
    } else if (users.length === 2) {
      return t('typing.double', { name1: users[0].name, name2: users[1].name })
    } else {
      return t('typing.multiple', { count: users.length })
    }
  }
  
  return (
    <div className={`flex items-center gap-3 px-4 py-2 text-sm text-gray-500 ${className}`}>
      <div className="flex -space-x-1">
        {users.slice(0, 3).map((user, index) => (
          <Avatar
            key={index}
            src={user.avatar}
            alt={user.name}
            size="xs"
            fallback={user.name.charAt(0)}
            className="border-2 border-white"
          />
        ))}
      </div>
      <span>{getTypingText()}</span>
      <div className="flex gap-1">
        <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" />
        <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
        <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
      </div>
    </div>
  )
}

// ========================================
// Utility Functions
// ========================================
function formatTime(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  // Less than 1 minute
  if (diff < 60000) {
    return 'now'
  }
  
  // Less than 1 hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000)
    return `${minutes}m`
  }
  
  // Same day
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  
  // Different day
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
