import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useSettingsStore } from './settingsStore';
import { usePresenceStore } from '../state/presenceStore';
import { createSoundAudio, playSoundSafely, checkSoundExists } from './soundUtils';

type RingtoneState = 'idle' | 'incoming' | 'outgoing' | 'connecting';

export function useRingtoneManager() {
  const [ringtoneState, setRingtoneState] = useState<RingtoneState>('idle');
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const soundEnabled = useSettingsStore(state => state.soundEnabled);
  const pendingInvitations = usePresenceStore(state => state.pendingInvitations);
  const getUnseenInvitations = usePresenceStore(state => state.getUnseenInvitations);
  const unseenInvitations = getUnseenInvitations ? getUnseenInvitations() : [];

  // Initialize ringtone audio
  useEffect(() => {
    if (!ringtoneRef.current) {
      const audio = createSoundAudio('ringtone-soft.mp3', {
        loop: true,
        volume: 0.3,
        preload: 'auto'
      });
      ringtoneRef.current = audio;

      // Preload on first user interaction
      const preloadRingtone = () => {
        if (!localStorage.getItem('ringtone_preloaded')) {
          audio.play().then(() => {
            audio.pause();
            audio.currentTime = 0;
            localStorage.setItem('ringtone_preloaded', '1');
          }).catch(() => {
            localStorage.setItem('ringtone_preloaded', '1');
          });
        }
        document.removeEventListener('click', preloadRingtone);
        document.removeEventListener('touchstart', preloadRingtone);
      };

      document.addEventListener('click', preloadRingtone);
      document.addEventListener('touchstart', preloadRingtone);
    }

    return () => {
      if (ringtoneRef.current) {
        ringtoneRef.current.pause();
        ringtoneRef.current = null;
      }
    };
  }, []);

  // Handle incoming call ringtone
  const handleRingtoneState = useCallback(() => {
    if (!soundEnabled || !ringtoneRef.current) return;

    const hasUnseenIncomingCalls = unseenInvitations.length > 0;
    
    if (hasUnseenIncomingCalls && ringtoneState !== 'incoming') {
      setRingtoneState('incoming');
      ringtoneRef.current.currentTime = 0;
      ringtoneRef.current.play().catch(() => {
        console.warn('Failed to play incoming call ringtone');
      });
    } else if (!hasUnseenIncomingCalls && ringtoneState === 'incoming') {
      setRingtoneState('idle');
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }
  }, [soundEnabled, unseenInvitations.length, ringtoneState]);

  useEffect(() => {
    handleRingtoneState();
  }, [handleRingtoneState]);

  // Stop ringtone when app is closing/hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && ringtoneRef.current) {
        // Don't stop ringtone when tab becomes hidden - keep ringing!
        // This ensures users don't miss calls when switching tabs
      }
    };

    const handleBeforeUnload = () => {
      if (ringtoneRef.current) {
        ringtoneRef.current.pause();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  const playOutgoingRingtone = useCallback(() => {
    if (!soundEnabled || !ringtoneRef.current) return;
    
    setRingtoneState('outgoing');
    ringtoneRef.current.currentTime = 0;
    ringtoneRef.current.volume = 0.2; // Slightly quieter for outgoing
    ringtoneRef.current.play().catch(() => {
      console.warn('Failed to play outgoing call ringtone');
    });
  }, [soundEnabled]);

  const stopRingtone = useCallback(() => {
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
      ringtoneRef.current.volume = 0.3; // Reset to normal volume
    }
    setRingtoneState('idle');
  }, []);

  const playConnectingTone = useCallback(() => {
    if (!soundEnabled || !ringtoneRef.current) return;
    
    setRingtoneState('connecting');
    // Play a shorter connecting sound
    ringtoneRef.current.loop = false;
    ringtoneRef.current.volume = 0.4;
    ringtoneRef.current.play().catch(() => {
      console.warn('Failed to play connecting tone');
    });
    
    // Auto-stop after 2 seconds - use ref to avoid closure issues
    setTimeout(() => {
      setRingtoneState(currentState => {
        if (currentState === 'connecting') {
          if (ringtoneRef.current) {
            ringtoneRef.current.pause();
            ringtoneRef.current.currentTime = 0;
            ringtoneRef.current.volume = 0.3;
          }
          return 'idle';
        }
        return currentState;
      });
    }, 2000);
  }, [soundEnabled]);

  return {
    ringtoneState,
    playOutgoingRingtone,
    stopRingtone,
    playConnectingTone,
    isRinging: ringtoneState !== 'idle'
  };
}

// Enhanced notification manager that tracks seen notifications
export function useNotificationManager() {
  const { 
    markNotificationSeen, 
    markNotificationDismissed,
  } = usePresenceStore();
  
  // Use memoized selector to prevent unnecessary re-renders
  const unseenInvitations = usePresenceStore(
    useCallback(
      (state) => state.pendingInvitations.filter(inv => 
        inv.status === 'pending' && 
        !state.seenNotifications.has(inv.id) && 
        !state.dismissedNotifications.has(inv.id)
      ),
      []
    )
  );

  // Don't clean up expired invitations here - let CallNotificationManager handle it
  // to avoid conflicts

  const markInvitationSeen = useCallback((invitationId: string) => {
    try {
      markNotificationSeen(invitationId);
    } catch (error) {
      console.error('Error marking invitation as seen:', error);
    }
  }, [markNotificationSeen]);

  const dismissInvitation = useCallback((invitationId: string) => {
    try {
      markNotificationDismissed(invitationId);
    } catch (error) {
      console.error('Error dismissing invitation:', error);
    }
  }, [markNotificationDismissed]);

  const getUnseenInvitationCount = useCallback(() => {
    try {
      return unseenInvitations.length;
    } catch (error) {
      console.error('Error getting unseen invitation count:', error);
      return 0;
    }
  }, [unseenInvitations.length]);

  return {
    markInvitationSeen,
    dismissInvitation,
    getUnseenInvitationCount,
    unseenInvitations
  };
}
