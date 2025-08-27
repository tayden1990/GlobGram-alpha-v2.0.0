import React, { useState, useEffect } from 'react';
import { usePresenceStore } from '../state/presenceStore';
import { useI18n } from '../i18n';
import { IconShare, IconLink, IconInvite, IconUser } from './icons';

// Simple copy icon component
const IconCopy = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="m5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

type Props = {
  roomId: string;
  onClose?: () => void;
};

export function CallShareModal({ roomId, onClose }: Props) {
  const { t } = useI18n();
  const presenceStore = usePresenceStore();
  const generateShareableLink = presenceStore.generateShareableLink;
  const activeCalls = presenceStore.activeCalls || {};
  const call = activeCalls[roomId];
  const [copied, setCopied] = useState(false);
  const [shareLink, setShareLink] = useState<string>('');
  
  // Generate share link in useEffect to avoid state updates during render
  useEffect(() => {
    if (call?.shareableLink) {
      setShareLink(call.shareableLink);
    } else {
      const link = generateShareableLink 
        ? generateShareableLink(roomId) 
        : `${window.location.origin}?room=${encodeURIComponent(roomId)}&action=join-call`;
      setShareLink(link);
    }
  }, [call?.shareableLink, generateShareableLink, roomId]);
  
  const inviteMessage = `🎥 ${t('call.joinCallInvite')} GlobGram!\n\n${t('call.clickToJoin')}:\n${shareLink}\n\n${t('call.shareMessage')}`;
  
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  const shareNative = async () => {
    if ('share' in navigator && navigator.share) {
      try {
        await navigator.share({
          title: t('call.shareCallTitle'),
          text: inviteMessage,
          url: shareLink,
        });
      } catch (err) {
        console.error('Share failed:', err);
      }
    } else {
      copyToClipboard(inviteMessage);
    }
  };
  
  return (
    <div className="call-share-overlay" style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10001,
      backdropFilter: 'blur(4px)'
    }}>
      <div className="call-share-modal" style={{
        background: 'var(--card)',
        borderRadius: 16,
        padding: 24,
        minWidth: 320,
        maxWidth: 500,
        width: '90vw',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
        border: '1px solid var(--border)',
        position: 'relative'
      }}>
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              background: 'none',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              color: 'var(--muted)',
              padding: 4
            }}
            aria-label={t('common.close')}
          >
            ✖
          </button>
        )}
        
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #10b981, #059669)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px'
          }}>
            <IconShare size={24} color="white" />
          </div>
          <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>
            {t('call.shareCall')}
          </h3>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
            {t('call.inviteOthersToJoin')}
          </p>
        </div>
        
        {/* Room info */}
        <div style={{
          background: 'var(--bg)',
          borderRadius: 8,
          padding: 12,
          margin: '0 0 20px',
          fontSize: 12,
          color: 'var(--muted)',
          textAlign: 'center'
        }}>
          <div><strong>{t('call.room')}:</strong> {roomId.slice(0, 12)}...</div>
          <div><strong>{t('call.participants')}:</strong> {call?.participants.length || 0}</div>
        </div>
        
        {/* Shareable link */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 14 }}>
            <IconLink size={16} style={{ marginRight: 6 }} />
            {t('call.shareableLink')}
          </label>
          <div style={{
            display: 'flex',
            gap: 8,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflow: 'hidden'
          }}>
            <input
              value={shareLink}
              readOnly
              style={{
                flex: 1,
                padding: 12,
                border: 'none',
                background: 'transparent',
                fontSize: 12,
                fontFamily: 'monospace'
              }}
            />
            <button
              onClick={() => copyToClipboard(shareLink)}
              style={{
                padding: '8px 12px',
                background: copied ? '#10b981' : 'var(--accent)',
                color: 'white',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                fontWeight: 600
              }}
            >
              <IconCopy size={14} />
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          </div>
        </div>
        
        {/* Invite message */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 14 }}>
            <IconInvite size={16} style={{ marginRight: 6 }} />
            {t('call.inviteMessage')}
          </label>
          <textarea
            value={inviteMessage}
            readOnly
            style={{
              width: '100%',
              height: 80,
              padding: 12,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg)',
              fontSize: 12,
              fontFamily: 'inherit',
              resize: 'none'
            }}
          />
        </div>
        
        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={() => copyToClipboard(inviteMessage)}
            style={{
              padding: '12px 20px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--fg)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <IconCopy size={16} />
            {t('call.copyInvite')}
          </button>
          
          <button
            onClick={shareNative}
            style={{
              padding: '12px 20px',
              borderRadius: 8,
              border: 'none',
              background: '#10b981',
              color: 'white',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <IconShare size={16} />
            {('share' in navigator) ? t('common.share') : t('call.copyInvite')}
          </button>
        </div>
        
        {/* Disclaimer */}
        <p style={{ 
          margin: '16px 0 0',
          fontSize: 11,
          color: 'var(--muted)',
          textAlign: 'center',
          lineHeight: 1.4
        }}>
          {t('call.shareDisclaimer')}
        </p>
      </div>
    </div>
  );
}

// Minimized call overlay component
export function MinimizedCallOverlay() {
  const { getCurrentCall, setCallMinimized, setCurrentCall } = usePresenceStore();
  const { t } = useI18n();
  
  const call = getCurrentCall();
  
  if (!call || !call.isMinimized) return null;
  
  const handleRestore = () => {
    setCallMinimized(call.roomId, false);
    setCurrentCall(call.roomId);
  };
  
  const duration = call ? Math.floor((Date.now() - call.startedAt) / 1000) : 0;
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  return (
    <div
      onClick={handleRestore}
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        background: '#10b981',
        color: 'white',
        borderRadius: 12,
        padding: '8px 12px',
        cursor: 'pointer',
        zIndex: 10000,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        animation: 'pulse 2s infinite',
        minWidth: 120
      }}
    >
      <div style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: 'white',
        animation: 'blink 1s infinite'
      }} />
      <div style={{ fontSize: 12, fontWeight: 600 }}>
        <div>{t('call.activeCall')}</div>
        <div style={{ fontSize: 10, opacity: 0.9 }}>
          {formatDuration(duration)}
        </div>
      </div>
      
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
