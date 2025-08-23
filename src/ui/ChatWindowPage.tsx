import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useChatStore } from '../state/chatStore'
import { useContactStore } from '../state/contactStore'
import { useNavigationStore } from '../state/navigationStore'
import { sendDM, sendTyping } from '../nostr/engine'
import { getObject, parseMemUrl } from '../services/upload'
import { blobToDataURL, dataURLSize, MAX_ATTACHMENT_BYTES, prepareBlobForSend } from '../nostr/utils'
import { useToast } from './Toast'
import { THUMB_SIZE, PRELOAD_ROOT_MARGIN } from './constants'
import { log } from './logger'
import { useI18n } from '../i18n'
import { CONFIG } from '../config'
import { useIsMobile } from './useIsMobile'

export function ChatWindowPage() {
  const { t } = useI18n()
  const isMobile = useIsMobile(900)
  const selectedPeer = useChatStore(s => s.selectedPeer)
  const conversations = useChatStore(s => s.conversations)
  const myPubkey = useChatStore(s => s.myPubkey)
  const removeMessage = useChatStore(s => s.removeMessage)
  const updateMessage = useChatStore(s => s.updateMessage)
  const clearConversation = useChatStore(s => s.clearConversation)
  const blocked = useChatStore(s => s.blocked)
  const setBlocked = useChatStore(s => s.setBlocked)
  const aliases = useContactStore(s => s.aliases)
  const { goBack, chatBackTitle } = useNavigationStore()

  const msgs = useMemo(() => (selectedPeer ? conversations[selectedPeer] ?? [] : []), [conversations, selectedPeer])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<string[]>([])
  const [recording, setRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [cameraOn, setCameraOn] = useState(false)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  const [videoRecording, setVideoRecording] = useState(false)
  const videoRecorderRef = useRef<MediaRecorder | null>(null)
  const videoChunksRef = useRef<Blob[]>([])
  const videoStreamRef = useRef<MediaStream | null>(null)
  const [encOn, setEncOn] = useState(false)
  const [encPass, setEncPass] = useState('')
  const { show } = useToast()
  const [visibleCount, setVisibleCount] = useState<number>(50)
  const loadingMoreRef = useRef(false)
  const topSentinelRef = useRef<HTMLDivElement | null>(null)
  const [isPreloading, setIsPreloading] = useState(false)
  const [lightbox, setLightbox] = useState<null | { type: 'image'|'video'|'audio'|'file'; src: string; name?: string }>(null)
  const footerRef = useRef<HTMLElement | null>(null)
  const [footerH, setFooterH] = useState<number>(180)
  const [preparing, setPreparing] = useState(false)
  const [prepProgress, setPrepProgress] = useState(0)
  const [sending, setSending] = useState(false)
  type SendProg = { stage: 'idle'|'uploading'|'publishing'|'done'; uploaded: number; total: number; fileProgress?: { current: number; total: number; fileIndex: number } }
  const [sendProg, setSendProg] = useState<SendProg>({ stage: 'idle', uploaded: 0, total: 0, fileProgress: undefined })

  // اگر هیچ chat انتخاب نشده، به صفحه اصلی برگرد
  useEffect(() => {
    if (!selectedPeer) {
      goBack()
    }
  }, [selectedPeer, goBack])

  if (!selectedPeer) {
    return null
  }

  const peerName = aliases[selectedPeer] || chatBackTitle || `${selectedPeer.slice(0, 10)}…`

  // Format bytes for progress display
  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const handleSendMessage = async () => {
    if (navigator.vibrate) try { navigator.vibrate(15) } catch {}
    const sk = localStorage.getItem('nostr_sk')
    if (!sk) return
    if (blocked[selectedPeer]) { 
      show(t('errors.contactBlocked')!, 'error'); 
      return 
    }
    const p = (encOn && (attachment || attachments.length)) ? encPass : undefined
    if (encOn && (attachment || attachments.length) && !p) { 
      show(t('errors.enterMediaPassphrase')!, 'error'); 
      return 
    }

    // Prevent sending large media without a configured upload backend
    try {
      const hasBackend = Boolean(((import.meta as any).env?.VITE_UPLOAD_BASE_URL) || CONFIG.UPLOAD_BASE_URL)
      if (!hasBackend) {
        const inlineLimit = 128 * 1024
        const sizes: number[] = []
        if (attachment?.startsWith('data:')) sizes.push(dataURLSize(attachment))
        for (const a of attachments) if (a.startsWith('data:')) sizes.push(dataURLSize(a))
        const anyTooLarge = sizes.some(s => s > inlineLimit)
        if (anyTooLarge) {
          show('Cannot send large media without an upload server. Configure an upload server or send a smaller file.', 'error')
          return
        }
      }
    } catch {}

    setSending(true)
    setSendProg({ stage: 'uploading', uploaded: 0, total: 0, fileProgress: undefined })
    
    await sendDM(sk, selectedPeer, { 
      t: text || undefined, 
      a: attachment || undefined, 
      as: attachments.length ? attachments : undefined, 
      p 
    }, {
      onProgress: ({ stage, uploaded, totalUploads, fileProgress }) => {
        setSendProg({ stage, uploaded: uploaded ?? 0, total: totalUploads ?? 0, fileProgress })
      }
    })

    setText('')
    setAttachment(null)
    setAttachments([])
    setSending(false)
    setSendProg({ stage: 'idle', uploaded: 0, total: 0, fileProgress: undefined })
  }

  return (
    <div className="chat-window-page" style={{ 
      height: '100vh', 
      background: 'var(--bg)', 
      color: 'var(--fg)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <header style={{ 
        padding: '12px 16px', 
        background: 'var(--card)', 
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        <button 
          onClick={goBack}
          style={{ 
            background: 'transparent', 
            border: 'none', 
            fontSize: '20px',
            cursor: 'pointer',
            padding: '8px',
            color: 'var(--accent)'
          }}
          title="بازگشت"
        >
          ←
        </button>
        
        {/* Avatar */}
        <div style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          background: 'var(--accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: '16px',
          fontWeight: 'bold'
        }}>
          {peerName.charAt(0).toUpperCase()}
        </div>
        
        <div style={{ flex: 1 }}>
          <h1 style={{ 
            margin: 0, 
            fontSize: '18px', 
            fontWeight: '600',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {peerName}
          </h1>
        </div>

        {/* Menu button */}
        <button 
          style={{ 
            background: 'transparent', 
            border: 'none', 
            fontSize: '20px',
            cursor: 'pointer',
            padding: '8px'
          }}
          title="منو"
        >
          ⋮
        </button>
      </header>

      {/* Messages Area */}
      <div style={{ 
        flex: 1, 
        overflowY: 'auto',
        padding: '16px',
        background: 'var(--bg)'
      }}>
        {msgs.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            color: 'var(--muted)', 
            fontSize: '16px',
            marginTop: '40px'
          }}>
            {t('chat.empty')}
          </div>
        ) : (
          <div>
            {msgs.map((msg, index) => {
              const isFromMe = msg.from === myPubkey
              return (
                <div 
                  key={msg.id}
                  style={{
                    display: 'flex',
                    justifyContent: isFromMe ? 'flex-end' : 'flex-start',
                    marginBottom: '12px'
                  }}
                >
                  <div style={{
                    maxWidth: '70%',
                    padding: '12px 16px',
                    borderRadius: '18px',
                    background: isFromMe ? 'var(--accent)' : 'var(--card)',
                    color: isFromMe ? '#fff' : 'var(--fg)',
                    wordBreak: 'break-word'
                  }}>
                    {msg.text && (
                      <div style={{ fontSize: '16px', lineHeight: '1.4' }}>
                        {msg.text}
                      </div>
                    )}
                    {msg.attachment && (
                      <div style={{ marginTop: msg.text ? '8px' : '0' }}>
                        {msg.attachment.startsWith('data:image/') ? (
                          <img 
                            src={msg.attachment} 
                            alt="attachment" 
                            style={{ 
                              maxWidth: '100%', 
                              borderRadius: '8px',
                              cursor: 'pointer'
                            }}
                            onClick={() => setLightbox({ type: 'image', src: msg.attachment! })}
                          />
                        ) : (
                          <div style={{ 
                            padding: '8px', 
                            background: 'rgba(0,0,0,0.1)', 
                            borderRadius: '8px',
                            fontSize: '14px'
                          }}>
                            📎 {msg.name || 'فایل ضمیمه'}
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ 
                      fontSize: '12px', 
                      opacity: 0.7, 
                      marginTop: '4px',
                      textAlign: isFromMe ? 'left' : 'right'
                    }}>
                      {new Date(msg.ts * 1000).toLocaleTimeString('fa-IR', { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div style={{ 
        padding: '16px', 
        background: 'var(--card)', 
        borderTop: '1px solid var(--border)' 
      }}>
        {/* Attachment Preview */}
        {(attachment || attachments.length > 0) && (
          <div style={{ 
            marginBottom: '12px',
            padding: '8px',
            background: 'var(--bg)',
            borderRadius: '8px',
            fontSize: '14px'
          }}>
            {attachment && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                📎 فایل ضمیمه
                <button 
                  onClick={() => setAttachment(null)}
                  style={{ 
                    background: 'transparent', 
                    border: 'none', 
                    cursor: 'pointer',
                    fontSize: '16px'
                  }}
                >
                  ✖️
                </button>
              </div>
            )}
            {attachments.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                📎 {attachments.length} فایل ضمیمه
                <button 
                  onClick={() => setAttachments([])}
                  style={{ 
                    background: 'transparent', 
                    border: 'none', 
                    cursor: 'pointer',
                    fontSize: '16px'
                  }}
                >
                  ✖️
                </button>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <textarea 
            rows={1}
            placeholder={t('input.placeholder')!} 
            value={text} 
            onChange={async (e) => {
              setText(e.target.value)
              const sk = localStorage.getItem('nostr_sk')
              if (sk && e.target.value.trim()) {
                try { await sendTyping(sk, selectedPeer) } catch {}
              }
            }} 
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!text && !attachment && attachments.length === 0) return
                await handleSendMessage()
              }
            }} 
            style={{ 
              flex: 1, 
              resize: 'none', 
              border: '1px solid var(--border)', 
              borderRadius: '20px',
              padding: '12px 16px',
              fontSize: '16px',
              background: 'var(--bg)',
              color: 'var(--fg)',
              minHeight: '20px',
              maxHeight: '100px',
              overflowY: 'auto'
            }} 
          />
          
          {/* Attach button */}
          <input 
            id="cw-file" 
            type="file" 
            multiple 
            style={{ display: 'none' }} 
            onChange={async (e) => {
              const files = Array.from(e.target.files || [])
              const urls: string[] = []
              for (const file of files) {
                if (file.size > MAX_ATTACHMENT_BYTES) { 
                  show(t('errors.fileTooLarge')!, 'error'); 
                  continue 
                }
                setPreparing(true); 
                setPrepProgress(0)
                const url = await prepareBlobForSend(file, { onProgress: (p) => setPrepProgress(p) })
                if (dataURLSize(url) > MAX_ATTACHMENT_BYTES) { 
                  show(t('errors.encodedFileTooLarge')!, 'error'); 
                  continue 
                }
                urls.push(url)
              }
              if (urls.length === 1) { setAttachment(urls[0]) }
              if (urls.length > 1) { setAttachments(urls) }
              setPreparing(false); 
              setPrepProgress(1)
              try { (e.target as HTMLInputElement).value = '' } catch {}
            }} 
          />
          
          <button 
            onClick={() => (document.getElementById('cw-file') as HTMLInputElement)?.click()}
            style={{ 
              padding: '12px', 
              background: 'var(--card)', 
              border: '1px solid var(--border)', 
              borderRadius: '50%',
              cursor: 'pointer',
              fontSize: '16px'
            }}
            title={t('chat.attachFiles')!}
          >
            📎
          </button>

          <button 
            onClick={handleSendMessage}
            disabled={preparing || sending || (!text && !attachment && attachments.length === 0)}
            style={{ 
              padding: '12px 16px', 
              background: 'var(--accent)', 
              color: '#fff', 
              border: 'none', 
              borderRadius: '20px',
              cursor: preparing || sending || (!text && !attachment && attachments.length === 0) ? 'not-allowed' : 'pointer',
              fontSize: '16px',
              opacity: preparing || sending || (!text && !attachment && attachments.length === 0) ? 0.5 : 1
            }}
          >
            {sending ? '...' : t('common.send')}
          </button>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div 
          onClick={() => setLightbox(null)} 
          style={{ 
            position: 'fixed', 
            inset: 0, 
            background: 'rgba(0,0,0,0.8)', 
            zIndex: 9999, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center' 
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh' }}>
            {lightbox.type === 'image' && (
              <img 
                src={lightbox.src} 
                alt="image" 
                style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', display: 'block' }} 
              />
            )}
            {lightbox.type === 'video' && (
              <video 
                controls 
                autoPlay 
                src={lightbox.src} 
                style={{ maxWidth: '90vw', maxHeight: '90vh' }} 
              />
            )}
            {lightbox.type === 'audio' && (
              <audio 
                controls 
                src={lightbox.src} 
                style={{ width: '80vw' }} 
              />
            )}
          </div>
          <button 
            onClick={() => setLightbox(null)} 
            style={{ 
              position: 'fixed', 
              top: 16, 
              right: 16, 
              fontSize: '18px', 
              background: 'var(--card)', 
              color: 'var(--fg)', 
              border: '1px solid var(--border)', 
              borderRadius: 6, 
              padding: '6px 10px', 
              cursor: 'pointer' 
            }}
          >
            ✖
          </button>
        </div>
      )}
    </div>
  )
}
