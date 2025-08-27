import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ParticipantTile, RoomAudioRenderer, useRoomContext, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { computeGridDimensions } from './grid';
import './call.css';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconUser, IconAuto, IconGrid, IconSpeaker, IconScreen, IconMic, IconMicOff, IconCam, IconCamOff, IconShare, IconShareStop, IconDensity, IconFullscreen, IconExitFull, IconSettings, IconLeave, IconAspect } from './icons';

type Aspect = '16:9' | '4:3';
type Density = 'cozy' | 'comfy' | 'compact';
type Mode = 'auto' | 'grid' | 'speaker' | 'screens';

export function ConferenceUI({ onLeave }: { onLeave?: () => void }) {
  const room = useRoomContext() as any;
  const cams = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  const screens = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }]);

  // State
  const [mode, setMode] = useState<Mode>('auto');
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [density, setDensity] = useState<Density>('comfy');
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState<number>(1);
  const [rows, setRows] = useState<number>(1);
  const aspectNum = aspect === '16:9' ? 16 / 9 : 4 / 3;
  const [micOn, setMicOn] = useState<boolean | null>(null);
  const [camOn, setCamOn] = useState<boolean | null>(null);
  const [shareOn, setShareOn] = useState<boolean | null>(null);
  const [showDevices, setShowDevices] = useState(false);

  // Helpers
  const makeKey = (t: any) => (t?.publication?.trackSid ? `sid:${t.publication.trackSid}` : `id:${t?.participant?.identity}:${t?.publication?.source}`);
  const allRail = useMemo(() => [...screens, ...cams], [screens, cams]);

  // Resize observer for grid recompute
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const RO = (window as any).ResizeObserver as any;
    const onResize = (rect: DOMRectReadOnly | DOMRect) => {
      const { cols, rows } = computeGridDimensions(rect.width, rect.height, cams.length || 1, aspectNum);
      setCols(cols); setRows(rows);
    };
    let ro: any = null;
    try {
      ro = RO ? new RO((entries: any[]) => { const r = entries?.[0]?.contentRect; if (r) onResize(r); }) : null;
      const rect = el.getBoundingClientRect();
      onResize(rect);
      ro?.observe?.(el);
    } catch {}
    return () => { try { ro?.disconnect?.(); } catch {} };
  }, [containerRef.current, cams.length, aspectNum]);

  // Mode auto-behavior
  useEffect(() => {
    if (mode === 'auto') {
      if (screens.length > 0) setMode('speaker');
    } else if (mode === 'speaker' && screens.length === 0 && pinnedKey == null) {
      // fallback to grid if no screens and nothing pinned
      setMode('grid');
    }
  }, [mode, screens.length, pinnedKey]);

  const isGrid = mode === 'grid' || (mode === 'auto' && screens.length === 0);
  const participantsCount = (room?.participants?.size || 0) + (room?.localParticipant ? 1 : 0);

  // Render tile
  const Tile = ({ tr }: { tr: any }) => {
    const key = makeKey(tr);
    const label = tr?.participant?.name || tr?.participant?.identity || 'User';
    const kind = tr?.publication?.source === Track.Source.ScreenShare ? 'screen' : 'cam';
    const speaking = !!tr?.participant?.isSpeaking;
    const pinned = pinnedKey === key;
    const pub: any = tr?.publication;
    const hasVideo = !!pub?.isSubscribed && !!pub?.track && !pub?.isMuted;
    return (
      <div
        className={`gg-tile ${kind} ${speaking ? 'speaking' : ''} ${pinned ? 'pinned' : ''}`}
        onClick={() => setPinnedKey(pinned ? null : key)}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPinnedKey(pinned ? null : key); } }}
      >
        {kind === 'screen' || hasVideo ? (
          <ParticipantTile trackRef={tr} />
        ) : (
          <div className="gg-placeholder" aria-label={`${label} camera off`}>
            <IconUser size={48} />
          </div>
        )}
        <div className="gg-label" aria-hidden>{label}</div>
      </div>
    );
  };

  // Decide primary and rail
  const primaryRef = useMemo(() => {
    if (pinnedKey) return allRail.find((t) => makeKey(t) === pinnedKey) || null;
    if (screens.length > 0) return screens[0];
    return cams[0] || null;
  }, [pinnedKey, allRail, screens, cams]);

  // Local track state sync
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

  return (
    <div className={`gg-root density-${density}`} id="call-root">
      <RoomAudioRenderer />
      <div className="gg-stage">
        {isGrid ? (
          <div ref={containerRef} className="gg-cams" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {cams.map((t) => (<Tile key={makeKey(t)} tr={t} />))}
          </div>
    ) : (
          <div className="gg-split">
            <div className={`gg-primary ${primaryRef?.publication?.source === Track.Source.ScreenShare ? 'screen' : 'cam'}`}>
              {primaryRef ? <Tile tr={primaryRef} /> : <div className="gg-empty">No media</div>}
            </div>
      <VirtualRail items={allRail} render={(t) => (<Tile key={makeKey(t)} tr={t} />)} />
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="gg-toolbar" role="toolbar" aria-label="Call Controls">
        <div className="gg-left">
          <button className="gg-btn icon" aria-pressed={mode==='auto'} title="Auto layout" aria-label="Auto layout" onClick={() => setMode('auto')}><IconAuto /></button>
          <button className="gg-btn icon" aria-pressed={mode==='grid'} title="Grid" aria-label="Grid" onClick={() => setMode('grid')}><IconGrid /></button>
          <button className="gg-btn icon" aria-pressed={mode==='speaker'} title="Speaker" aria-label="Speaker" onClick={() => setMode('speaker')}><IconSpeaker /></button>
          <button className="gg-btn icon" aria-pressed={mode==='screens'} title="Screens" aria-label="Screens" onClick={() => setMode('screens')}><IconScreen /></button>
          <span className="gg-badge" title="Participants">{participantsCount}</span>
          {isGrid && <span className="gg-badge" title={`Grid ${cols} x ${rows}`}>Grid {cols}×{rows}</span>}
        </div>
        <div className="gg-center">
          <button className="gg-btn icon" aria-pressed={!!micOn} title={micOn ? 'Mute mic' : 'Unmute mic'} aria-label="Toggle microphone" onClick={async () => { try { await room?.localParticipant?.setMicrophoneEnabled(!(micOn ?? false)); } finally { refreshLocal(); } }}>{micOn ? <IconMic /> : <IconMicOff />}</button>
          <button className="gg-btn icon" aria-pressed={!!camOn} title={camOn ? 'Turn camera off' : 'Turn camera on'} aria-label="Toggle camera" onClick={async () => { try { await room?.localParticipant?.setCameraEnabled(!(camOn ?? false)); } finally { refreshLocal(); } }}>{camOn ? <IconCam /> : <IconCamOff />}</button>
          <button className="gg-btn icon" aria-pressed={!!shareOn} title={shareOn ? 'Stop sharing' : 'Share screen'} aria-label="Toggle screenshare" onClick={async () => { try { await room?.localParticipant?.setScreenShareEnabled(!(shareOn ?? false)); } finally { refreshLocal(); } }}>{shareOn ? <IconShareStop /> : <IconShare />}</button>
          <button className="gg-btn icon" title={`Grid density: ${density}`} aria-label="Grid density" onClick={() => setDensity(density==='cozy'?'comfy':density==='comfy'?'compact':'cozy')}><IconDensity /></button>
          <button className="gg-btn icon" title={`Aspect ratio: ${aspect}`} aria-label="Aspect ratio" onClick={() => setAspect(a => a==='16:9' ? '4:3' : '16:9')}><IconAspect /></button>
        </div>
        <div className="gg-right">
          <button className="gg-btn icon" title="Settings" aria-label="Settings" onClick={() => setShowDevices(s=>!s)}><IconSettings /></button>
          <button className="gg-btn icon" title="Fullscreen" aria-label="Fullscreen" onClick={() => {
            const el = document.getElementById('call-root');
            if (!document.fullscreenElement) el?.requestFullscreen?.();
            else document.exitFullscreen?.();
          }}>{document.fullscreenElement ? <IconExitFull /> : <IconFullscreen />}</button>
          <button className="gg-btn icon danger" title="Leave" aria-label="Leave" onClick={onLeave}><IconLeave /></button>
        </div>
        {showDevices && (
          <DevicesPopover room={room} onClose={() => setShowDevices(false)} />
        )}
      </div>
    </div>
  );
}

function VirtualRail({ items, render }: { items: any[]; render: (t: any, index: number) => React.ReactNode }) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virt = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => {
      const t = items[i];
      const isScreen = t?.publication?.source === Track.Source.ScreenShare;
      return isScreen ? 220 : 180;
    },
    overscan: 8,
  });
  const total = virt.getTotalSize();
  const vitems = virt.getVirtualItems();
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
