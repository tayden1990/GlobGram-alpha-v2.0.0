import { useEffect, useState } from 'react';
import { usePresenceStore } from '../state/presenceStore';

// Hook to handle call persistence when user navigates or minimizes
export function useCallPersistence() {
  const presenceStore = usePresenceStore();
  const getCurrentCall = presenceStore.getCurrentCall;
  const setCallMinimized = presenceStore.setCallMinimized;
  
  useEffect(() => {
    const handleVisibilityChange = () => {
      const currentCall = getCurrentCall ? getCurrentCall() : null;
      if (currentCall && !currentCall.isMinimized) {
        if (document.hidden) {
          // Page is hidden/minimized - minimize the call overlay
          if (setCallMinimized) setCallMinimized(currentCall.roomId, true);
        } else {
          // Page is visible again - restore the call
          if (setCallMinimized) setCallMinimized(currentCall.roomId, false);
        }
      }
    };
    
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const currentCall = getCurrentCall ? getCurrentCall() : null;
      if (currentCall && !currentCall.isMinimized) {
        // User is trying to leave - ask for confirmation
        const message = 'You have an active call. Are you sure you want to leave?';
        event.preventDefault();
        event.returnValue = message;
        return message;
      }
    };
    
    const handlePopState = () => {
      const currentCall = getCurrentCall ? getCurrentCall() : null;
      if (currentCall && !currentCall.isMinimized) {
        // Navigation detected - minimize call
        if (setCallMinimized) setCallMinimized(currentCall.roomId, true);
      }
    };
    
    // Listen for page visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Listen for page unload attempts
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Listen for navigation (back/forward)
    window.addEventListener('popstate', handlePopState);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [getCurrentCall, setCallMinimized]);
}

// Hook to handle URL parameters for joining calls
export function useCallJoinHandler() {
  const [autoJoinRoom, setAutoJoinRoom] = useState<string | null>(null);
  
  useEffect(() => {
    const checkUrlParams = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const roomId = urlParams.get('room');
      const action = urlParams.get('action');
      
      if (roomId && action === 'join-call') {
        const decodedRoomId = decodeURIComponent(roomId);
        
        // Signal that we want to auto-join this room
        setAutoJoinRoom(decodedRoomId);
        
        // Clean up URL parameters
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('room');
        newUrl.searchParams.delete('action');
        window.history.replaceState({}, document.title, newUrl.pathname + newUrl.search);
      }
    };
    
    checkUrlParams();
  }, []);
  
  return { autoJoinRoom, clearAutoJoinRoom: () => setAutoJoinRoom(null) };
}
