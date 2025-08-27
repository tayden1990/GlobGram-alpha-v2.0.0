import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ParticipantTile, useTracks, RoomAudioRenderer, useRoomContext } from '@livekit/components-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Track } from 'livekit-client';
import './call.css';
import { IconAuto, IconGrid, IconSpeaker, IconScreen, IconMic, IconMicOff, IconCam, IconCamOff, IconShare, IconShareStop, IconDensity, IconSettings, IconFullscreen, IconExitFull, IconLeave, IconPin, IconUser } from './icons';
type Props = { onHangup?: () => void };

export default function CallGallery({ onHangup }: Props) {
  // Layout modes: auto (smart), gallery (cams), speaker (pinned/screen), screens (all screens)
  const [mode, setMode] = useState<'auto' | 'gallery' | 'speaker' | 'screens'>('auto');
  const prevModeRef = useRef<'auto' | 'gallery' | 'speaker' | 'screens'>('auto');
  const autoSwitchedRef = useRef(false);
  const [pinned, setPinned] = useState<string | null>(null); // key
  const [density, setDensity] = useState<'cozy' | 'comfy' | 'compact'>('comfy');
  const [aspect, setAspect] = useState<'16:9' | '4:3'>('16:9');
  const camTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  const screenTracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }]);
  const room = useRoomContext() as any;
  const camsContainerRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState<number | null>(null);
  const desiredAspect = 16 / 9; // target tile aspect ratio
  const aspectNum = aspect === '16:9' ? 16 / 9 : 4 / 3;

  // Compute an optimal grid given container size and participant count
  const computeGrid = useCallback((w: number, h: number, count: number, aspect = desiredAspect) => {
    if (!count || w <= 0 || h <= 0) return { cols: 1 };
    let bestCols = 1;
    let bestScore = 0;
    // Try column counts from 1..count, pick max tile area score
    for (let c = 1; c <= count; c++) {
      const rows = Math.ceil(count / c);
      const tileW = Math.floor(w / c);
      const tileH = Math.floor(h / rows);
      // Fit width by aspect if height is the limiter
      const fittedW = Math.min(tileW, Math.floor(tileH * aspect));
      const fittedH = Math.min(tileH, Math.floor(tileW / aspect));
      const area = fittedW * fittedH;
      if (area > bestScore) { bestScore = area; bestCols = c; }
    }
    return { cols: Math.max(1, Math.min(count, bestCols)) };
  }, []);

  // Observe the gallery container to recompute columns on resize or participant/aspect changes
  useEffect(() => {
    const el = camsContainerRef.current;
    if (!el) return;
  const RO = (window as any).ResizeObserver as any;
  const ro = RO ? new RO((entries: any[]) => {
      const box = entries?.[0]?.contentRect;
      if (!box) return;
      const next = computeGrid(box.width, box.height, camTracks.length, aspectNum);
      setCols((prev) => (prev !== next.cols ? next.cols : prev));
  }) : null;
    // Initial compute
    try {
      const rect = el.getBoundingClientRect();
      const next = computeGrid(rect.width, rect.height, camTracks.length, aspectNum);
      setCols(next.cols);
    } catch {}
  try { ro?.observe?.(el); } catch {}
  return () => { try { ro?.disconnect?.(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camsContainerRef.current, camTracks.length, computeGrid, aspectNum]);

  const [micOn, setMicOn] = useState<boolean | null>(null);
  const [camOn, setCamOn] = useState<boolean | null>(null);
  const [shareOn, setShareOn] = useState<boolean | null>(null);
  const [showDevices, setShowDevices] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    const pub: any = t?.publication;
    const hasVideo = !!pub?.isSubscribed && !!pub?.track && !pub?.isMuted;
    return (
      <div className={`gg-primary ${isScreen ? 'screen' : 'cam'}`} onClick={(e) => { if ((e.target as HTMLElement).closest('.gg-pin-btn')) return; pin(null); }}>
        <div className="gg-tile pinned">
          {isScreen || hasVideo ? (
            <ParticipantTile trackRef={t} />
          ) : (
            <div className="gg-placeholder" aria-label={`${label} camera off`} style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#9ca3af' }}>
              <IconUser size={56} />
            </div>
          )}
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
    const isScreen = t?.publication?.source === Track.Source.ScreenShare;
    // Determine if the video is actually available and enabled
    const pub: any = t?.publication;
    const hasVideo = !!pub?.isSubscribed && !!pub?.track && !pub?.isMuted;
    return (
      <div className={`gg-tile ${kind} ${isPinned ? 'pinned' : ''} ${speaking ? 'speaking' : ''}`} onClick={() => pin(key)} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pin(key); } }}>
        {/* Show either the video track or a person placeholder, never both */}
        {isScreen || hasVideo ? (
          <ParticipantTile trackRef={t} />
        ) : (
          <div className="gg-placeholder" aria-label={`${label} camera off`} style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#6b7280' }}>
            <IconUser size={48} />
          </div>
        )}
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
  const gridRows = useMemo(() => {
    const c = cols || 1;
    const n = camTracks.length || 0;
    return Math.max(1, Math.ceil(n / c));
  }, [cols, camTracks.length]);

  // Virtualized side-rail for large rooms
  const railItems = useMemo(() => [...screenTracks, ...camTracks], [screenTracks, camTracks]);
  const VIRT_THRESHOLD = 24;
  const useVirtualRail = railItems.length >= VIRT_THRESHOLD;

  return (
    <div className={`gg-root density-${density} ${uiVisible ? '' : 'hide-ui'}`} id="call-root">
      <RoomAudioRenderer />
      <div className="gg-stage">
        {isGallery ? (
          <div className="gg-cams" ref={camsContainerRef} style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}>
            {camTracks.map((t) => (
              <Tile key={makeKey(t, 'cam')} t={t} kind="cam" />
            ))}
          </div>
        ) : (
          <div className="gg-split">
            <PrimaryTile />
            {useVirtualRail ? (
              <VirtualizedRail
                items={railItems}
                render={(t: any) => (
                  <Tile key={makeKey(t, (t.publication?.source===Track.Source.ScreenShare?'screen':'cam') as any)} t={t} kind={(t.publication?.source===Track.Source.ScreenShare?'screen':'cam') as any} />
                )}
              />
            ) : (
              <div className="gg-rail" style={{ position: 'relative' }}>
                {railItems.map((t) => (
                  <Tile key={makeKey(t, (t.publication?.source===Track.Source.ScreenShare?'screen':'cam') as any)} t={t} kind={(t.publication?.source===Track.Source.ScreenShare?'screen':'cam') as any} />
                ))}
              </div>
            )}
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
          <button className="gg-badge gg-btn" title="Show participants" aria-label="Show participants" onClick={() => setSidebarOpen(v=>!v)}>
            {(room?.participants?.size || 0) + (room?.localParticipant ? 1 : 0)}
          </button>
          {isGallery && (
            <span className="gg-badge" title={`Grid ${cols || 1} x ${gridRows}`}>Grid {cols || 1}×{gridRows}</span>
          )}
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
          <button className="gg-btn" title={`Aspect ratio: ${aspect}`} aria-label="Aspect ratio" onClick={() => setAspect(a => a==='16:9' ? '4:3' : '16:9')}>{aspect}</button>
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
        {sidebarOpen && (
          <ParticipantsSidebar room={room} onClose={() => setSidebarOpen(false)} />
        )}
      </div>
    </div>
  );
}

function VirtualizedRail({ items, render }: { items: any[]; render: (item: any, index: number) => React.ReactNode }) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const t = items[index];
      const isScreen = t?.publication?.source === Track.Source.ScreenShare;
      return isScreen ? 200 : 160; // px height estimate per tile in rail
    },
    overscan: 8,
  });
  const total = virtualizer.getTotalSize();
  const vitems = virtualizer.getVirtualItems();

  return (
    <div ref={parentRef} className="gg-rail" style={{ position: 'relative', overflow: 'auto' }}>
      <div style={{ height: total, position: 'relative', width: '100%' }}>
        {vitems.map((vi) => (
          <div key={vi.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}>
            {render(items[vi.index], vi.index)}
          </div>
        ))}
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

function ParticipantsSidebar({ room, onClose }: { room: any; onClose: () => void }) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const parts: any[] = React.useMemo(() => {
    const list: any[] = [];
    try {
      const lp = room?.localParticipant;
      if (lp) list.push({ participant: lp, isLocal: true });
      const rem: any[] = Array.from(room?.participants?.values?.() || []);
      for (const p of rem) list.push({ participant: p, isLocal: false });
    } catch {}
    return list;
  }, [room?.participants?.size, room?.localParticipant]);
  const virt = useVirtualizer({
    count: parts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 8,
  });
  const total = virt.getTotalSize();
  const vitems = virt.getVirtualItems();
  return (
    <aside className="gg-sidebar" style={{ position: 'absolute', right: 12, top: 12, bottom: 72, width: 280, background: '#111318', border: '1px solid #2a2d36', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', borderBottom: '1px solid #222' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconUser size={18} />
          <strong>Participants</strong>
          <span className="gg-badge">{parts.length}</span>
        </div>
        <button className="gg-btn" onClick={onClose} title="Close" aria-label="Close">✖</button>
      </div>
      <div ref={parentRef} style={{ flex: 1, position: 'relative', overflow: 'auto' }}>
        <div style={{ height: total, position: 'relative' }}>
          {vitems.map((vi) => {
            const entry = parts[vi.index];
            const p = entry?.participant as any;
            const name = p?.name || p?.identity || 'User';
            // check mic/cam
            let micOn = false, camOn = false;
            try {
              const pubs: any[] = Array.from(p?.trackPublications?.values?.() || []);
              micOn = !!pubs.find(pp => pp?.source === Track.Source.Microphone && !pp?.isMuted);
              camOn = !!pubs.find(pp => pp?.source === Track.Source.Camera && !pp?.isMuted);
            } catch {}
            return (
              <div key={vi.key} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderBottom: '1px solid #1b1e24' }}>
                  <div style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', background: '#1a1d25', borderRadius: 9999 }}><IconUser size={16} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}{entry?.isLocal ? ' (You)' : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span title={micOn ? 'Mic on' : 'Mic off'} aria-label={micOn ? 'Mic on' : 'Mic off'}>{micOn ? <IconMic size={16} /> : <IconMicOff size={16} />}</span>
                    <span title={camOn ? 'Camera on' : 'Camera off'} aria-label={camOn ? 'Camera on' : 'Camera off'}>{camOn ? <IconCam size={16} /> : <IconCamOff size={16} />}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}