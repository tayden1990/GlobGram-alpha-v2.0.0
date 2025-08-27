import React, { useEffect, useState, useCallback } from 'react';
import { usePresenceStore, type CallInvitation } from '../state/presenceStore';
import { useI18n } from '../i18n';
import { IconUser, IconCam, IconMicOff } from './icons';
import { useRingtoneManager, useNotificationManager } from './RingtoneManager';

type Props = {
  invitation: CallInvitation
  onAccept: () => void
  onReject: () => void
}

export function CallInvitationModal({ invitation, onAccept, onReject }: Props) {
  const { t } = useI18n();
  const [timeLeft, setTimeLeft] = useState(45);
  const { markInvitationSeen } = useNotificationManager();
  const [hasMarkedSeen, setHasMarkedSeen] = useState(false);
  
  // Mark invitation as seen when modal is displayed (deferred to avoid render timing issues)
  useEffect(() => {
    if (!hasMarkedSeen && invitation.id) {
      // Defer the state update to avoid conflicts with other components
      const timeoutId = setTimeout(() => {
        try {
          markInvitationSeen(invitation.id);
          setHasMarkedSeen(true);
        } catch (error) {
          console.error('Error marking invitation as seen:', error);
        }
      }, 0); // Defer to next tick
      
      return () => clearTimeout(timeoutId);
    }
  }, [invitation.id, markInvitationSeen, hasMarkedSeen]);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - invitation.createdAt;
      const remaining = Math.max(0, Math.ceil((45000 - elapsed) / 1000));
      setTimeLeft(remaining);
      
      if (remaining <= 0) {
        onReject(); // Auto-reject when time expires
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [invitation.createdAt, onReject]);
  
  return (
    <div className="call-invitation-overlay" style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      backdropFilter: 'blur(4px)'
    }}>
      <div className="call-invitation-modal" style={{
        background: 'var(--card)',
        borderRadius: 16,
        padding: 24,
        minWidth: 320,
        maxWidth: 400,
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
        border: '1px solid var(--border)',
        textAlign: 'center'
      }}>
        {/* Caller avatar */}
        <div style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
          animation: 'pulse 2s infinite'
        }}>
          <IconUser size={40} color="white" />
        </div>
        
        {/* Call info */}
        <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>
          {t('call.incomingCall')}
        </h3>
        
        <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 14 }}>
          {invitation.fromUserName || invitation.fromUserId} {t('call.isCallingYou')}
        </p>
        
        <div style={{
          background: 'var(--bg)',
          borderRadius: 8,
          padding: 12,
          margin: '0 0 20px',
          fontSize: 12,
          color: 'var(--muted)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <IconCam size={16} />
            <span>Room: {invitation.roomId.slice(0, 8)}...</span>
          </div>
          <div style={{ marginTop: 4 }}>
            {t('call.expiresIn')}: {timeLeft}s
          </div>
        </div>
        
        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={onReject}
            style={{
              padding: '12px 24px',
              borderRadius: 12,
              border: '2px solid #ef4444',
              background: 'transparent',
              color: '#ef4444',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#ef4444';
              e.currentTarget.style.color = 'white';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#ef4444';
            }}
          >
            <IconMicOff size={18} />
            {t('call.reject')}
          </button>
          
          <button
            onClick={onAccept}
            style={{
              padding: '12px 24px',
              borderRadius: 12,
              border: '2px solid #10b981',
              background: '#10b981',
              color: 'white',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              animation: 'acceptPulse 1.5s infinite'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#059669';
              e.currentTarget.style.borderColor = '#059669';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#10b981';
              e.currentTarget.style.borderColor = '#10b981';
            }}
          >
            <IconCam size={18} />
            {t('call.accept')}
          </button>
        </div>
      </div>
      
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        
        @keyframes acceptPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
          50% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
        }
      `}</style>
    </div>
  );
}

// Flashing green light indicator for active rooms
export function GreenLightIndicator({ roomId }: { roomId: string }) {
  const presenceStore = usePresenceStore();
  const isRoomActive = presenceStore.isRoomActive ? presenceStore.isRoomActive(roomId) : false;
  const hasActiveCall = presenceStore.hasActiveCall ? presenceStore.hasActiveCall(roomId) : false;
  
  if (!isRoomActive && !hasActiveCall) return null;
  
  return (
    <div className="green-light-indicator" style={{
      position: 'absolute',
      top: 6,
      left: 6,
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: hasActiveCall ? '#10b981' : '#22c55e',
      animation: 'greenPulse 2s infinite',
      zIndex: 10,
      boxShadow: hasActiveCall ? '0 0 8px #10b981' : '0 0 6px #22c55e'
    }}>
      <style>{`
        @keyframes greenPulse {
          0%, 100% { 
            opacity: 1; 
            transform: scale(1);
            box-shadow: 0 0 0 0 ${hasActiveCall ? 'rgba(16, 185, 129, 0.7)' : 'rgba(34, 197, 94, 0.7)'};
          }
          50% { 
            opacity: 0.8; 
            transform: scale(1.2);
            box-shadow: 0 0 0 6px ${hasActiveCall ? 'rgba(16, 185, 129, 0)' : 'rgba(34, 197, 94, 0)'};
          }
        }
      `}</style>
    </div>
  );
}

// Enhanced join room button
export function JoinRoomButton({ roomId, onJoin }: { roomId: string; onJoin: () => void }) {
  const { t } = useI18n();
  const presenceStore = usePresenceStore();
  const isRoomActive = presenceStore.isRoomActive ? presenceStore.isRoomActive(roomId) : false;
  const hasActiveCall = presenceStore.hasActiveCall ? presenceStore.hasActiveCall(roomId) : false;
  const getRoomUserCount = presenceStore.getRoomUserCount;
  const userCount = getRoomUserCount ? getRoomUserCount(roomId) : 0;
  
  if (!isRoomActive && !hasActiveCall) return null;
  
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onJoin();
      }}
      style={{
        position: 'absolute',
        bottom: 4,
        right: 4,
        background: hasActiveCall ? '#10b981' : '#22c55e',
        color: 'white',
        border: 'none',
        borderRadius: 6,
        padding: '3px 6px',
        fontSize: 10,
        fontWeight: 600,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        animation: hasActiveCall ? 'joinPulse 1.5s infinite' : 'none',
        zIndex: 10,
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)'
      }}
      title={hasActiveCall ? t('call.joinCall') : t('room.joinActiveRoom')}
    >
      {hasActiveCall ? '📞' : '👥'}
      <span>{hasActiveCall ? t('call.join') : t('room.join')}</span>
      {userCount > 0 && <span>({userCount})</span>}
      
      <style>{`
        @keyframes joinPulse {
          0%, 100% { 
            transform: scale(1);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          }
          50% { 
            transform: scale(1.05);
            box-shadow: 0 4px 8px rgba(16, 185, 129, 0.4);
          }
        }
      `}</style>
    </button>
  );
}

// Blinking alarm indicator component
export function BlinkingCallAlarm({ roomId }: { roomId: string }) {
  const { t } = useI18n();
  const blinkingRooms = usePresenceStore(state => state.blinkingRooms);
  const isBlinking = blinkingRooms instanceof Set ? blinkingRooms.has(roomId) : false;
  
  if (!isBlinking) return null;
  
  return (
    <div className="blinking-call-alarm" style={{
      position: 'absolute',
      top: 4,
      right: 4,
      width: 12,
      height: 12,
      borderRadius: '50%',
      background: '#ef4444',
      animation: 'blink 1s infinite',
      zIndex: 10
    }}>
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

// Enhanced room presence indicator
export function RoomPresenceIndicator({ roomId }: { roomId: string }) {
  const presence = usePresenceStore(state => state.roomPresence[roomId] || []);
  const presenceStore = usePresenceStore();
  const hasActiveCall = presenceStore.hasActiveCall ? presenceStore.hasActiveCall(roomId) : false;
  const userCount = presence.length;
  
  if (userCount === 0 && !hasActiveCall) return null;
  
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 6px',
      borderRadius: 10,
      background: hasActiveCall ? '#10b981' : userCount > 0 ? '#3b82f6' : 'var(--muted)',
      color: 'white',
      fontSize: 10,
      fontWeight: 600
    }}>
      {hasActiveCall && <IconCam size={10} />}
      {userCount > 0 && <IconUser size={10} />}
      <span>{userCount}</span>
    </div>
  );
}

// Call notification manager component
export function CallNotificationManager() {
  const presenceStore = usePresenceStore();
  const updateCallInvitation = presenceStore.updateCallInvitation;
  const removeCallInvitation = presenceStore.removeCallInvitation;
  const setRoomCallActive = presenceStore.setRoomCallActive;
  const { unseenInvitations, markInvitationSeen } = useNotificationManager();
  const { stopRingtone } = useRingtoneManager();
  
  // Auto-cleanup expired invitations (reduced frequency and deferred to prevent performance issues)
  useEffect(() => {
    const interval = setInterval(() => {
      // Defer cleanup to avoid conflicts with other state updates
      setTimeout(() => {
        try {
          const presenceStore = usePresenceStore.getState();
          if (presenceStore.clearExpiredInvitations) {
            presenceStore.clearExpiredInvitations();
          }
        } catch (error) {
          console.error('Error clearing expired invitations:', error);
        }
      }, 100); // Small delay to avoid render conflicts
    }, 15000); // Increased to 15 seconds to reduce frequency
    
    return () => clearInterval(interval);
  }, []);
  
  const handleAccept = useCallback((invitation: CallInvitation) => {
    try {
      // Batch state updates to prevent timing conflicts
      Promise.resolve().then(() => {
        if (updateCallInvitation) updateCallInvitation(invitation.id, { status: 'accepted' });
        if (setRoomCallActive) setRoomCallActive(invitation.roomId, true);
        if (removeCallInvitation) removeCallInvitation(invitation.id);
        stopRingtone(); // Stop ringtone when call is accepted
        
        // TODO: Open call interface for the room
        console.log('Accepted call for room:', invitation.roomId);
      });
    } catch (error) {
      console.error('Error accepting call:', error);
    }
  }, [updateCallInvitation, setRoomCallActive, removeCallInvitation, stopRingtone]);
  
  const handleReject = useCallback((invitation: CallInvitation) => {
    try {
      // Batch state updates to prevent timing conflicts
      Promise.resolve().then(() => {
        if (updateCallInvitation) updateCallInvitation(invitation.id, { status: 'rejected' });
        if (removeCallInvitation) removeCallInvitation(invitation.id);
        stopRingtone(); // Stop ringtone when call is rejected
        
        console.log('Rejected call for room:', invitation.roomId);
      });
    } catch (error) {
      console.error('Error rejecting call:', error);
    }
  }, [updateCallInvitation, removeCallInvitation, stopRingtone]);
  
  // Show only unseen pending invitations (most recent first)
  const currentInvitation = unseenInvitations
    .filter(inv => inv.status === 'pending')
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  
  if (!currentInvitation) return null;
  
  return (
    <CallInvitationModal
      invitation={currentInvitation}
      onAccept={() => handleAccept(currentInvitation)}
      onReject={() => handleReject(currentInvitation)}
    />
  );
}
