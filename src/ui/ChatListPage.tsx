import { useMemo, useState } from 'react'
import { refreshSubscriptions } from '../nostr/engine'
import { useChatStore } from '../state/chatStore'
import { useContactStore } from '../state/contactStore'
import { useNavigationStore } from '../state/navigationStore'
import { nip19 } from 'nostr-tools'
import { bytesToHex } from '../nostr/utils'
import { QRScan } from './QRScan'
import { useToast } from './Toast'
import { log } from './logger'
import { useI18n } from '../i18n'

export function ChatListPage() {
  const { t } = useI18n()
  const { show } = useToast()
  const conversations = useChatStore(s => s.conversations)
  const selected = useChatStore(s => s.selectedPeer)
  const selectPeer = useChatStore(s => s.selectPeer)
  const [newPeer, setNewPeer] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
  const aliases = useContactStore(s => s.aliases)
  const setAlias = useContactStore(s => s.setAlias)
  const lastRead = useChatStore(s => s.lastRead)
  const navigateTo = useNavigationStore(s => s.navigateTo)

  const peers = useMemo(() => {
    const keys = Object.keys(conversations)
    return keys.sort((a, b) => {
      const la = conversations[a]?.[conversations[a].length - 1]?.ts ?? 0
      const lb = conversations[b]?.[conversations[b].length - 1]?.ts ?? 0
      return lb - la
    })
  }, [conversations])

  // pull-to-refresh when at top
  const ptrRef = useState({ y0: 0, pulling: false })[0]
  const listRef = (el: HTMLDivElement | null) => {
    if (!el) return
    let startY = 0
    el.addEventListener('touchstart', (e) => {
      if (el.scrollTop === 0) { startY = e.touches[0].clientY; ptrRef.y0 = startY; ptrRef.pulling = true }
      else ptrRef.pulling = false
    }, { passive: true })
    el.addEventListener('touchmove', (e) => {
      if (!ptrRef.pulling) return
      const dy = e.touches[0].clientY - startY
      if (dy > 80) {
        if (navigator.vibrate) try { navigator.vibrate(30) } catch {}
        ptrRef.pulling = false
        refreshSubscriptions()
      }
    }, { passive: true })
  }

  const handleChatSelect = (pk: string) => {
    selectPeer(pk)
    const chatTitle = aliases[pk] || `${pk.slice(0, 10)}…`
    navigateTo('chatWindow', chatTitle)
  }

  const handleNewChat = () => {
    let pk = newPeer.trim()
    if (!pk) return
    try {
      if (pk.startsWith('npub')) {
        const dec = nip19.decode(pk)
        pk = typeof dec.data === 'string' ? dec.data : bytesToHex(dec.data as Uint8Array)
      }
    } catch {}
    if (!/^[0-9a-fA-F]{64}$/.test(pk)) { 
      show(t('errors.invalidPubkey')!, 'error'); 
      try { log('ChatList.newChat.invalid') } catch {}; 
      return 
    }
    selectPeer(pk)
    const chatTitle = aliases[pk] || `${pk.slice(0, 10)}…`
    navigateTo('chatWindow', chatTitle)
    try { log(`ChatList.newChat ${pk.slice(0, 12)}…`) } catch {}
    setNewPeer('')
  }

  return (
    <div className="chat-list-page" style={{ 
      height: '100vh', 
      background: 'var(--bg)', 
      color: 'var(--fg)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <header style={{ 
        padding: '16px 20px', 
        background: 'var(--card)', 
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>
          {t('tabs.chats')}
        </h1>
        <button 
          onClick={() => navigateTo('settings')}
          style={{ 
            padding: '8px', 
            background: 'transparent', 
            border: 'none', 
            fontSize: '18px',
            cursor: 'pointer'
          }}
          title={t('tabs.settings') || 'تنظیمات'}
        >
          ⚙️
        </button>
      </header>

      {/* New Chat Input */}
      <div style={{ 
        padding: '16px 20px', 
        background: 'var(--card)', 
        borderBottom: '1px solid var(--border)' 
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input 
            placeholder={t('fab.newChatPrompt')!} 
            value={newPeer} 
            onChange={(e) => setNewPeer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleNewChat()
              }
            }}
            style={{ 
              flex: 1, 
              padding: '12px', 
              border: '1px solid var(--border)', 
              borderRadius: '24px',
              background: 'var(--bg)',
              color: 'var(--fg)',
              fontSize: '16px'
            }} 
          />
          <button 
            onClick={handleNewChat}
            style={{ 
              padding: '12px 16px', 
              background: 'var(--accent)', 
              color: '#fff', 
              border: 'none', 
              borderRadius: '24px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            {t('fab.startNewChat')}
          </button>
          <button 
            title={t('fab.scanQR')!} 
            aria-label={t('fab.scanQR')!} 
            onClick={() => { 
              try { log('ChatList.qr.open') } catch {}; 
              setQrOpen(true) 
            }}
            style={{ 
              padding: '12px', 
              background: 'var(--card)', 
              border: '1px solid var(--border)', 
              borderRadius: '24px',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            📷
          </button>
        </div>
      </div>

      {/* QR Scanner */}
      {qrOpen && (
        <QRScan 
          onResult={(text) => {
            setQrOpen(false)
            try { log(`ChatList.qr.result ${String(text).slice(0,64)}`) } catch {}
            try {
              if (text.startsWith('npub')) {
                const dec = nip19.decode(text)
                const pk = typeof dec.data === 'string' ? dec.data : bytesToHex(dec.data as Uint8Array)
                if (/^[0-9a-fA-F]{64}$/.test(pk)) {
                  selectPeer(pk)
                  const chatTitle = aliases[pk] || `${pk.slice(0, 10)}…`
                  navigateTo('chatWindow', chatTitle)
                }
              }
            } catch (e: any) { 
              try { log(`ChatList.qr.error: ${e?.message||e}`) } catch {} 
            }
          }} 
          onClose={() => { 
            try { log('ChatList.qr.close') } catch {}; 
            setQrOpen(false) 
          }} 
        />
      )}

      {/* Chat List */}
      <div ref={listRef} style={{ 
        flex: 1, 
        overflowY: 'auto',
        background: 'var(--bg)'
      }}>
        {peers.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            color: 'var(--muted)', 
            fontSize: '16px',
            padding: '40px 20px'
          }}>
            {t('chat.empty')}
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {peers.map(pk => {
              const msgs = conversations[pk]
              const last = msgs[msgs.length - 1]
              const name = aliases[pk]
              const unread = msgs.filter(m => m.ts > (lastRead[pk] || 0)).length
              
              return (
                <li 
                  key={pk} 
                  style={{ 
                    padding: '16px 20px', 
                    cursor: 'pointer', 
                    background: selected === pk ? 'var(--selected)' : 'var(--bg)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }} 
                  onClick={() => handleChatSelect(pk)}
                >
                  {/* Avatar */}
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: '18px',
                    fontWeight: 'bold'
                  }}>
                    {name ? name.charAt(0).toUpperCase() : pk.slice(0, 2)}
                  </div>
                  
                  {/* Chat Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      marginBottom: '4px'
                    }}>
                      <h3 style={{ 
                        margin: 0, 
                        fontSize: '16px', 
                        fontWeight: '600',
                        fontFamily: name ? 'inherit' : 'monospace',
                        color: 'var(--fg)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {name || `${pk.slice(0, 10)}…`}
                      </h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {unread > 0 && (
                          <span style={{ 
                            background: 'var(--accent)', 
                            color: '#fff', 
                            borderRadius: '12px', 
                            padding: '2px 8px', 
                            fontSize: '12px',
                            fontWeight: 'bold',
                            minWidth: '20px',
                            textAlign: 'center'
                          }}>
                            {unread}
                          </span>
                        )}
                        <button 
                          title={t('chat.editAlias')!} 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            const v = prompt(t('chat.aliasForContact')!, name || ''); 
                            if (v !== null) setAlias(pk, v) 
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            fontSize: '14px',
                            cursor: 'pointer',
                            opacity: 0.7,
                            padding: '4px'
                          }}
                        >
                          ✏️
                        </button>
                      </div>
                    </div>
                    {last && (
                      <div style={{ 
                        color: 'var(--muted)', 
                        fontSize: '14px', 
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis', 
                        whiteSpace: 'nowrap' 
                      }}>
                        {last.text ||
                          (last.attachments && last.attachments.length > 0
                            ? `[${last.attachments.map(a => 
                                a.startsWith('data:image/') ? t('chat.kind.image') : 
                                a.startsWith('data:video/') ? t('chat.kind.video') : 
                                a.startsWith('data:audio/') ? t('chat.kind.audio') : 
                                t('chat.kind.file')
                              ).join(', ')}]`
                            : (last.attachment?.startsWith('data:image/') ? `[${t('chat.kind.image')}]`
                            : last.attachment?.startsWith('data:video/') ? `[${t('chat.kind.video')}]`
                            : last.attachment?.startsWith('data:audio/') ? `[${t('chat.kind.audio')}]`
                            : last.attachment ? `[${t('chat.kind.file')}]` : ''))}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
