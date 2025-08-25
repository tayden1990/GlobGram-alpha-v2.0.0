import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ParticipantTile, useTracks, RoomAudioRenderer, useRoomContext } from '@livekit/components-react';
import { Track } from 'livekit-client';
import './call.css';
import { IconAuto, IconGrid, IconSpeaker, IconScreen, IconMic, IconMicOff, IconCam, IconCamOff, IconShare, IconShareStop, IconDensity, IconSettings, IconFullscreen, IconExitFull, IconLeave, IconPin } from './icons';
type Props = { onHangup?: () => void };

export default function CallGallery({ onHangup }: Props) {
  // Layout modes: auto (smart), gallery (cams), speaker (pinned/screen), screens (all screens)
  const [mode, setMode] = useState<'auto' | 'gallery' | 'speaker' | 'screens'>('auto');
  const prevModeRef = useRef<'auto' | 'gallery' | 'speaker' | 'screens'>('auto');
  const autoSwitchedRef = useRef(false);
  const [pinned, setPinned] = useState<string | null>(null); // key
  const [density, setDensity] = useState<'cozy' | 'comfy' | 'compact'>('comfy');
  const camTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  const screenTracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }]);
  const room = useRoomContext() as any;

  const [micOn, setMicOn] = useState<boolean | null>(null);
  const [camOn, setCamOn] = useState<boolean | null>(null);
  const [shareOn, setShareOn] = useState<boolean | null>(null);
  const [showDevices, setShowDevices] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);

  const kickIdleTimer = useCallback(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setUiVisible(true);
    hideTimer.current = window.setTimeout(() => {
      // Don't hide when device popover is open
      setUiVisible((v) => (showDevices ? true : false));
    }, 3000);
  }, [showDevices]);

  useEffect(() => {
    // show again when devices popover closes
    if (showDevices) setUiVisible(true);
  }, [showDevices]);

  useEffect(() => {
    // global listeners to reveal controls on interaction
    const onInteract = () => kickIdleTimer();
    document.addEventListener('mousemove', onInteract, { passive: true });
    document.addEventListener('touchstart', onInteract, { passive: true });
    document.addEventListener('keydown', onInteract);
    kickIdleTimer();
    return () => {
      document.removeEventListener('mousemove', onInteract as any);
      document.removeEventListener('touchstart', onInteract as any);
      document.removeEventListener('keydown', onInteract as any);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [kickIdleTimer]);

  const refreshLocal = useCallback(() => {
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

  React.useEffect(() => {
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

  // Auto-switch to speaker when screenshare starts; restore when it ends
  useEffect(() => {
    const hasScreens = screenTracks.length > 0;
    if (hasScreens && !autoSwitchedRef.current) {
      prevModeRef.current = mode;
      setMode('speaker');
      autoSwitchedRef.current = true;
    } else if (!hasScreens && autoSwitchedRef.current) {
      setMode(prevModeRef.current || 'auto');
      autoSwitchedRef.current = false;
    }
  }, [screenTracks.length]);

  const makeKey = (t: any, kind: 'cam' | 'screen') => {
    const sid = (t.publication as any)?.trackSid ?? null;
    return sid ? `sid:${sid}` : `id:${t?.participant?.identity}:${kind}`;
  };
  const pin = (key: string | null) => setPinned(key);

  const primary = useMemo(() => {
    if (pinned) return pinned;
    if (screenTracks.length > 0) return makeKey(screenTracks[0], 'screen');
    return camTracks[0] ? makeKey(camTracks[0], 'cam') : null;
  }, [pinned, screenTracks, camTracks]);

  const resolveKey = (key: string | null) => {
    if (!key) return undefined;
    const all = [...screenTracks, ...camTracks];
    for (const t of all) {
      const k = makeKey(t, (t.publication?.source === Track.Source.ScreenShare ? 'screen' : 'cam') as any);
      if (k === key) return t;
    }
    return undefined;
  };

  const PrimaryTile = () => {
    const t = resolveKey(primary || null);
    if (!t) return <div className="gg-empty">No media</div>;
    const isScreen = t.publication?.source === Track.Source.ScreenShare;
    const label = t?.participant?.name || t?.participant?.identity || 'User';
    return (
      <div className={`gg-primary ${isScreen ? 'screen' : 'cam'}`} onClick={(e) => { if ((e.target as HTMLElement).closest('.gg-pin-btn')) return; pin(null); }}>
        <div className="gg-tile pinned">
          <ParticipantTile trackRef={t} />
          <div className="gg-label" aria-hidden>{label}</div>
          <button className="gg-pin-btn" onClick={(e) => { e.stopPropagation(); pin(null); }} title="Unpin" aria-label="Unpin pinned video" role="button"><IconPin size={16} /></button>
          <button className="gg-fs-btn" title="Fullscreen" aria-label="Fullscreen" onClick={(e) => {
            e.stopPropagation();
            const tile = (e.currentTarget as HTMLElement).closest('.gg-tile') as HTMLElement | null;
            if (!document.fullscreenElement) tile?.requestFullscreen?.(); else document.exitFullscreen?.();
          }}>{document.fullscreenElement ? <IconExitFull /> : <IconFullscreen />}</button>
        </div>
      </div>
    );
  };

  const Tile = ({ t, kind }: { t: any; kind: 'cam' | 'screen' }) => {
    const key = makeKey(t, kind);
    const isPinned = pinned === key || primary === key;
    const label = t?.participant?.name || t?.participant?.identity || 'User';
    const speaking = !!t?.participant?.isSpeaking;
    return (
      <div className={`gg-tile ${kind} ${isPinned ? 'pinned' : ''} ${speaking ? 'speaking' : ''}`} onClick={() => pin(key)} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pin(key); } }}>
        <ParticipantTile trackRef={t} />
        <div className="gg-label" aria-hidden>{label}</div>
  <button className="gg-pin-btn" title={isPinned ? 'Unpin' : 'Pin'} aria-label={isPinned ? 'Unpin' : 'Pin'} onClick={(e) => { e.stopPropagation(); pin(isPinned ? null : key); }}><IconPin size={16} /></button>
        <button className="gg-fs-btn" title="Fullscreen" aria-label="Fullscreen" onClick={(e) => {
          e.stopPropagation();
          const tile = (e.currentTarget as HTMLElement).closest('.gg-tile') as HTMLElement | null;
          if (!document.fullscreenElement) tile?.requestFullscreen?.(); else document.exitFullscreen?.();
        }}>{document.fullscreenElement ? <IconExitFull /> : <IconFullscreen />}</button>
      </div>
    );
  };

  const isGallery = mode === 'gallery' || (mode === 'auto' && screenTracks.length === 0);

  return (
    <div className={`gg-root density-${density} ${uiVisible ? '' : 'hide-ui'}`} id="call-root">
      <RoomAudioRenderer />
      <div className="gg-stage">
        {isGallery ? (
          <div className="gg-cams">
            {camTracks.map((t) => (
              <Tile key={makeKey(t, 'cam')} t={t} kind="cam" />
            ))}
          </div>
        ) : (
          <div className="gg-split">
            <PrimaryTile />
            <div className="gg-rail">
              {screenTracks.map((t) => (
                <Tile key={makeKey(t, 'screen')} t={t} kind="screen" />
              ))}
              {camTracks.map((t) => (
                <Tile key={makeKey(t, 'cam')} t={t} kind="cam" />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Mobile filmstrip */}
      <div className="gg-filmstrip" aria-hidden>
        <div className="gg-film-inner">
          {[...screenTracks, ...camTracks].map((t) => (
            <div className="gg-film-thumb" key={makeKey(t, (t.publication?.source===Track.Source.ScreenShare?'screen':'cam') as any)} onClick={() => pin(makeKey(t, (t.publication?.source===Track.Source.ScreenShare?'screen':'cam') as any))}>
              <ParticipantTile trackRef={t} />
            </div>
          ))}
        </div>
      </div>

      {/* Transparent overlay toolbar */}
      <div className="gg-toolbar" role="toolbar" aria-label="Call Controls">
        <div className="gg-left">
          <button className="gg-btn icon" onClick={() => setMode('auto')} aria-pressed={mode==='auto'} title="Auto layout" aria-label="Auto layout"><IconAuto /></button>
          <button className="gg-btn icon" onClick={() => setMode('gallery')} aria-pressed={mode==='gallery'} title="Gallery" aria-label="Gallery"><IconGrid /></button>
          <button className="gg-btn icon" onClick={() => setMode('speaker')} aria-pressed={mode==='speaker'} title="Speaker" aria-label="Speaker"><IconSpeaker /></button>
          <button className="gg-btn icon" onClick={() => setMode('screens')} aria-pressed={mode==='screens'} title="Screens" aria-label="Screens"><IconScreen /></button>
          <span className="gg-badge" title="Participants">{(room?.participants?.size || 0) + (room?.localParticipant ? 1 : 0)}</span>
        </div>
        <div className="gg-center">
          <button className="gg-btn icon" aria-pressed={!!micOn} title={micOn ? 'Mute mic' : 'Unmute mic'} aria-label="Toggle microphone" onClick={async () => {
            try { await room?.localParticipant?.setMicrophoneEnabled(!(micOn ?? false)); } finally { refreshLocal(); }
          }}>{micOn ? <IconMic /> : <IconMicOff />}</button>
          <button className="gg-btn icon" aria-pressed={!!camOn} title={camOn ? 'Turn camera off' : 'Turn camera on'} aria-label="Toggle camera" onClick={async () => {
            try { await room?.localParticipant?.setCameraEnabled(!(camOn ?? false)); } finally { refreshLocal(); }
          }}>{camOn ? <IconCam /> : <IconCamOff />}</button>
          <button className="gg-btn icon" aria-pressed={!!shareOn} title={shareOn ? 'Stop sharing' : 'Share screen'} aria-label="Toggle screenshare" onClick={async () => {
            try { const desired = !(shareOn ?? false); await room?.localParticipant?.setScreenShareEnabled(desired); } finally { refreshLocal(); }
          }}>{shareOn ? <IconShareStop /> : <IconShare />}</button>
          <button className="gg-btn icon" title={`Grid density: ${density}`} aria-label="Grid density" onClick={() => setDensity(density==='cozy'?'comfy':density==='comfy'?'compact':'cozy')}><IconDensity /></button>
        </div>
        <div className="gg-right">
          <button className="gg-btn icon" title="Settings" aria-label="Settings" onClick={(e) => setShowDevices((s) => !s)}>⚙️</button>
          <button className="gg-btn icon" title="Fullscreen" aria-label="Fullscreen" onClick={() => {
            const el = document.getElementById('call-root');
            if (!document.fullscreenElement) el?.requestFullscreen?.();
            else document.exitFullscreen?.();
          }}>{document.fullscreenElement ? <IconExitFull /> : <IconFullscreen />}</button>
          <button className="gg-btn icon danger" title="Leave" aria-label="Leave" onClick={onHangup}><IconLeave /></button>
        </div>

        {/* Devices/settings popover */}
        {showDevices && (
          <DevicesPopover room={room} onClose={() => setShowDevices(false)} />
        )}
      </div>
    </div>
  );
}

function DevicesPopover({ room, onClose }: { room: any; onClose: () => void }) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [outs, setOuts] = useState<MediaDeviceInfo[]>([]);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        setMics(devs.filter((d) => d.kind === 'audioinput'));
        setCams(devs.filter((d) => d.kind === 'videoinput'));
        setOuts(devs.filter((d) => d.kind === 'audiooutput'));
      } catch {}
    })();
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  return (
    <div className="gg-popover" ref={ref} role="dialog" aria-label="Device settings">
      <div className="gg-pop-section">
        <h4>Microphone</h4>
        <div className="gg-list">
          {mics.map((d) => (
            <button key={d.deviceId} className="gg-list-item" onClick={() => room?.switchActiveDevice?.('audioinput', d.deviceId)}>{d.label || d.deviceId}</button>
          ))}
        </div>
      </div>
      <div className="gg-pop-section">
        <h4>Camera</h4>
        <div className="gg-list">
          {cams.map((d) => (
            <button key={d.deviceId} className="gg-list-item" onClick={() => room?.switchActiveDevice?.('videoinput', d.deviceId)}>{d.label || d.deviceId}</button>
          ))}
        </div>
      </div>
      <div className="gg-pop-section">
        <h4>Speaker</h4>
        <div className="gg-list">
          {outs.map((d) => (
            <button key={d.deviceId} className="gg-list-item" onClick={() => room?.switchActiveDevice?.('audiooutput', d.deviceId)}>{d.label || d.deviceId}</button>
          ))}
        </div>
      </div>
    </div>
  );
}