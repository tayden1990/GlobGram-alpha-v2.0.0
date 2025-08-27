import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ParticipantTile, RoomAudioRenderer, useRoomContext, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { calculate_grid_dimension, type Dimension } from './grid';
import { useIsMobile } from './useIsMobile';
import { usePresenceStore } from '../state/presenceStore';
import { useI18n } from '../i18n';
import './call.css';
import { IconUser, IconMic, IconMicOff, IconCam, IconCamOff, IconShare, IconShareStop, IconLeave, IconInvite } from './icons';
import { CallShareModal } from './CallShare';

type Props = { 
  onLeave?: () => void;
  roomId?: string;
};

// Enhanced conference UI with advanced grid calculation and animations
export function SimpleConference({ onLeave, roomId }: Props) {
  const room = useRoomContext() as any;
  const isMobile = useIsMobile(520); // Use 520px breakpoint to match CSS
  const { t } = useI18n();
  
  // Call state management with better memoization
  const presenceStore = usePresenceStore();
  const { startCall, updateCallParticipants, setCurrentCall } = presenceStore;
  const getCurrentCall = presenceStore.getCurrentCall;
  const endCall = presenceStore.endCall;
  const currentCall = getCurrentCall ? getCurrentCall() : null;
  const [shareModalOpen, setShareModalOpen] = useState(false);
  
  // Memoize current call data to prevent unnecessary re-renders
  const currentCallData = useMemo(() => ({
    roomId: currentCall?.roomId,
    participantCount: currentCall?.participants?.length || 0
  }), [currentCall?.roomId, currentCall?.participants?.length]);
  
  const cams = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  const screens = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }]);

  // Filter out any invalid or stale tracks to prevent LiveKit errors
  const validCams = useMemo(() => {
    return cams.filter(track => 
      track && 
      track.participant && 
      track.participant.identity &&
      track.publication &&
      track.publication.track // Ensure track exists
    );
  }, [cams]);

  const validScreens = useMemo(() => {
    return screens.filter(track => 
      track && 
      track.participant && 
      track.participant.identity &&
      track.publication &&
      track.publication.track // Ensure track exists
    );
  }, [screens]);

  const allTiles = useMemo(() => [...validScreens, ...validCams], [validScreens, validCams]);
  
  // Track participants for presence store (memoized to prevent infinite loops)
  const participantIds = useMemo(() => {
    const ids = allTiles.map(tile => tile.participant?.identity || '').filter(id => id);
    // Sort to ensure consistent array for comparison
    return ids.sort();
  }, [allTiles]);

  // Track participant count to detect changes without full array comparison
  const participantCount = participantIds.length;
  
  // Update call state when participants change (with proper dependency management)
  useEffect(() => {
    if (!roomId || participantCount === 0) return;
    
    const currentCallRoomId = currentCallData.roomId;
    
    if (currentCallRoomId !== roomId) {
      // Starting a new call
      try {
        if (startCall) startCall(roomId, participantIds);
        if (setCurrentCall) setCurrentCall(roomId);
      } catch (error) {
        console.error('Error starting call:', error);
      }
    } else if (currentCallData.participantCount !== participantCount) {
      // Update participants only if count changed to avoid infinite loops
      try {
        if (updateCallParticipants) updateCallParticipants(roomId, participantIds);
      } catch (error) {
        console.error('Error updating call participants:', error);
      }
    }
  }, [roomId, participantCount, currentCallData.roomId, currentCallData.participantCount, participantIds, startCall, updateCallParticipants, setCurrentCall]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dimension, setDimension] = useState<Dimension>({ width: 0, height: 0 });
  const [aspect, setAspect] = useState(16 / 9); // 16:9 or 4:3

  // Enhanced ResizeObserver with proper dimension tracking
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onResize = (rect: DOMRectReadOnly | DOMRect) => {
      setDimension(oldDimension => {
        // Avoid unnecessary updates
        if (Math.abs(oldDimension.width - rect.width) < 1 && 
            Math.abs(oldDimension.height - rect.height) < 1) {
          return oldDimension;
        }
        return { width: rect.width, height: rect.height };
      });
    };

    const ro = new ResizeObserver(entries => {
      const rect = entries?.[0]?.contentRect;
      if (rect) onResize(rect);
    });

    onResize(el.getBoundingClientRect());
    ro.observe(el);
    return () => { try { ro.disconnect(); } catch {} };
  }, []);

  // Calculate optimal tile dimensions using advanced algorithm
  const tileDimension = useMemo(() => {
    if (!dimension.width || !dimension.height || !allTiles.length) {
      return { width: 0, height: 0 };
    }

    // Mobile optimization: use more of the screen space
    if (isMobile) {
      // Mobile-specific tile sizing for better screen utilization
      const toolbarHeight = 96;
      const availableHeight = dimension.height - toolbarHeight;
      const padding = 8;
      
      if (allTiles.length === 1) {
        return {
          width: dimension.width - padding * 2,
          height: availableHeight * 0.85
        };
      } else if (allTiles.length === 2) {
        return {
          width: dimension.width - padding * 2,
          height: (availableHeight - padding) / 2
        };
      } else if (allTiles.length <= 4) {
        return {
          width: (dimension.width - padding * 3) / 2,
          height: (availableHeight - padding * 2) / 2
        };
      } else {
        // For 5+ participants, use 3-column grid
        return {
          width: (dimension.width - padding * 4) / 3,
          height: (availableHeight - padding * 3) / Math.ceil(allTiles.length / 3)
        };
      }
    }

    return calculate_grid_dimension({
      dimension,
      total_grids: allTiles.length,
      aspect_ratio: aspect,
    });
  }, [dimension, allTiles.length, aspect, isMobile]);

  // Calculate grid layout based on optimal tile size
  const gridLayout = useMemo(() => {
    if (!tileDimension.width || !tileDimension.height) {
      return { cols: 1, rows: 1 };
    }

    if (isMobile) {
      // Mobile-specific grid layouts
      if (allTiles.length === 1) {
        return { cols: 1, rows: 1 };
      } else if (allTiles.length === 2) {
        return { cols: 1, rows: 2 }; // Stack vertically on mobile
      } else if (allTiles.length <= 4) {
        return { cols: 2, rows: 2 };
      } else {
        // For 5+ participants, use 3-column grid
        return { cols: 3, rows: Math.ceil(allTiles.length / 3) };
      }
    }

    const cols = Math.floor(dimension.width / tileDimension.width) || 1;
    const rows = Math.ceil(allTiles.length / cols);
    
    // Special case: prefer 2x1 for exactly two tiles
    if (allTiles.length === 2) {
      return { cols: 2, rows: 1 };
    }

    return { cols: Math.max(1, cols), rows: Math.max(1, rows) };
  }, [tileDimension, dimension.width, allTiles.length, isMobile]);

  // Local media toggles
  const [micOn, setMicOn] = useState<boolean | null>(null);
  const [camOn, setCamOn] = useState<boolean | null>(null);
  const [shareOn, setShareOn] = useState<boolean | null>(null);
  
  const refreshLocal = React.useCallback(() => {
    try {
      const lp = room?.localParticipant;
      if (!lp) return;
      const pubs: any[] = Array.from(lp?.trackPublications?.values?.() || []);
      const micPub: any = pubs.find((p: any) => p?.source === Track.Source.Microphone);
      const camPub: any = pubs.find((p: any) => p?.source === Track.Source.Camera);
      const scrPub: any = pubs.find((p: any) => p?.source === Track.Source.ScreenShare);
      setMicOn(micPub ? !micPub.isMuted : null);
      setCamOn(camPub ? !camPub.isMuted : null);
      setShareOn(scrPub ? !scrPub.isMuted : null);
    } catch {}
  }, [room]);

  useEffect(() => {
    refreshLocal();
    const lp = room?.localParticipant;
    if (!lp) return;
    
    const onMuted = () => refreshLocal();
    const onUnmuted = () => refreshLocal();
    
    try {
      lp.on?.('trackMuted', onMuted);
      lp.on?.('trackUnmuted', onUnmuted);
      lp.on?.('trackPublished', refreshLocal);
      lp.on?.('trackUnpublished', refreshLocal);
    } catch {}
    
    return () => {
      try {
        lp.off?.('trackMuted', onMuted);
        lp.off?.('trackUnmuted', onUnmuted);
        lp.off?.('trackPublished', refreshLocal);
        lp.off?.('trackUnpublished', refreshLocal);
      } catch {}
    };
  }, [room, refreshLocal]);

  const participantsCount = (room?.participants?.size || 0) + (room?.localParticipant ? 1 : 0);

  const Tile = ({ tr, index }: { tr: any; index: number }) => {
    const p = tr?.participant as any;
    const rawLabel: string = p?.name || p?.identity || 'User';
    const label = p?.isLocal ? 'You' : (rawLabel.length > 18 ? `${rawLabel.slice(0, 10)}…${rawLabel.slice(-6)}` : rawLabel);
    const pub: any = tr?.publication;
    const hasVideo = !!pub?.isSubscribed && !!pub?.track && !pub?.isMuted;
    const isScreen = String(pub?.source || '').toLowerCase().includes('screen');
    
    return (
      <div 
        className={`gg-tile ${isScreen ? 'screen' : 'cam'} transition-all duration-300 ease-in-out`}
        style={{
          width: isMobile ? '100%' : `${tileDimension.width}px`,
          height: isMobile ? '100%' : `${tileDimension.height}px`,
          maxWidth: isMobile ? 'none' : `${tileDimension.width}px`,
          maxHeight: isMobile ? 'none' : `${tileDimension.height}px`,
          // Entry animation delay based on index
          animationDelay: `${index * 100}ms`,
          // Mobile-specific sizing
          ...(isMobile && {
            flex: '1 1 auto',
            minWidth: 0,
            minHeight: 0,
          })
        }}
      >
        {hasVideo ? (
          <ParticipantTile trackRef={tr} style={{ width: '100%', height: '100%' }} />
        ) : (
          <div className="gg-placeholder" aria-label={`${label} camera off`} style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#9ca3af' }}>
            <IconUser size={isMobile ? 48 : 56} />
          </div>
        )}
        <div className="gg-label" aria-hidden>{label}{isScreen ? ' • screen' : ''}</div>
      </div>
    );
  };

  return (
    <div className="gg-root" id="call-root">
      <RoomAudioRenderer />
      <div className="gg-stage">
        <div
          ref={containerRef}
          className="gg-grid overflow-hidden transition-all duration-200 flex w-full h-full flex-row flex-wrap place-content-center"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: isMobile ? 4 : 8,
            padding: isMobile ? 4 : 8,
            width: '100%',
            height: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            alignContent: 'center',
            // Mobile-specific layout adjustments
            ...(isMobile && {
              flexDirection: allTiles.length === 2 ? 'column' : 'row',
              alignItems: 'stretch',
              minHeight: `calc(100dvh - 96px)`,
            })
          }}>
          {allTiles.map((t, index) => (
            <Tile 
              key={(t?.publication?.trackSid) || `${t?.participant?.identity}:${String(t?.publication?.source)}`}
              tr={t}
              index={index}
            />
          ))}
        </div>
      </div>

      <div className="gg-toolbar" role="toolbar" aria-label="Call Controls">
        <div className="gg-left" />
        <div className="gg-center">
          <button className="gg-btn" aria-pressed={aspect === 16/9} title="16:9" onClick={() => setAspect(16/9)}>16:9</button>
          <button className="gg-btn" aria-pressed={aspect === 4/3} title="4:3" onClick={() => setAspect(4/3)}>4:3</button>
          <button className="gg-btn icon" aria-pressed={!!micOn} title={micOn ? 'Mute mic' : 'Unmute mic'} aria-label="Toggle microphone" onClick={async () => {
            try { await room?.localParticipant?.setMicrophoneEnabled(!(micOn ?? false)); } finally { refreshLocal(); }
          }}>{micOn ? <IconMic /> : <IconMicOff />}</button>
          <button className="gg-btn icon" aria-pressed={!!camOn} title={camOn ? 'Turn camera off' : 'Turn camera on'} aria-label="Toggle camera" onClick={async () => {
            try { await room?.localParticipant?.setCameraEnabled(!(camOn ?? false)); } finally { refreshLocal(); }
          }}>{camOn ? <IconCam /> : <IconCamOff />}</button>
          <button className="gg-btn icon" aria-pressed={!!shareOn} title={shareOn ? 'Stop sharing' : 'Share screen'} aria-label="Toggle screenshare" onClick={async () => {
            try { const desired = !(shareOn ?? false); await room?.localParticipant?.setScreenShareEnabled(desired); } finally { refreshLocal(); }
          }}>{shareOn ? <IconShareStop /> : <IconShare />}</button>
          {roomId && (
            <button 
              className="gg-btn icon" 
              title={t('call.shareCall')} 
              aria-label={t('call.shareCall')} 
              onClick={() => setShareModalOpen(true)}
              style={{ background: '#10b981', color: 'white' }}
            >
              <IconInvite />
            </button>
          )}
        </div>
        <div className="gg-right">
          <span className="gg-badge" title="Participants">{participantsCount}</span>
          <button className="gg-btn icon danger" title="Leave" aria-label="Leave" onClick={() => {
            // End call in presence store
            if (roomId && endCall) {
              endCall(roomId);
            }
            onLeave?.();
          }}><IconLeave /></button>
        </div>
      </div>
      
      {/* Share modal */}
      {shareModalOpen && roomId && (
        <CallShareModal 
          roomId={roomId} 
          onClose={() => setShareModalOpen(false)} 
        />
      )}
    </div>
  );
}

export default SimpleConference;