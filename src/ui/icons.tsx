import React from 'react';

type IconProps = { size?: number; stroke?: number; className?: string; title?: string } & React.SVGProps<SVGSVGElement>;
const S = (p: IconProps) => ({ width: p.size ?? 20, height: p.size ?? 20, stroke: 'currentColor', strokeWidth: p.stroke ?? 1.8, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round', className: p.className, role: p.title ? 'img' : undefined, 'aria-label': p.title } as const);

export const IconAuto = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M9 16l3-8 3 8m-5-.5h4"/></svg>
);
export const IconGrid = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
);
export const IconSpeaker = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"/><path d="M5 20c1.5-3 4.5-5 7-5s5.5 2 7 5"/></svg>
);
export const IconScreen = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/></svg>
);
export const IconMic = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><rect x="9" y="4" width="6" height="10" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
);
export const IconMicOff = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><rect x="9" y="4" width="6" height="10" rx="3"/><path d="M5 11a7 7 0 0 0 9.5 6.5M12 18v3M3 3l18 18"/></svg>
);
export const IconCam = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><rect x="4" y="6" width="10" height="12" rx="2"/><path d="M14 10l6-3v10l-6-3z"/></svg>
);
export const IconCamOff = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><rect x="4" y="6" width="10" height="12" rx="2"/><path d="M14 10l6-3v10l-6-3zM3 3l18 18"/></svg>
);
export const IconShare = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 8v8M9 11l3-3 3 3"/></svg>
);
export const IconShareStop = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 8h8v8H8z"/></svg>
);
export const IconDensity = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><path d="M4 7h16M4 12h10M4 17h16"/></svg>
);
export const IconSettings = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/><path d="M3 12h3m12 0h3M6.6 5.6l2.1 2.1m6.6 6.6l2.1 2.1m0-10.8l-2.1 2.1M8.7 14.3 6.6 16.4"/></svg>
);
export const IconFullscreen = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/></svg>
);
export const IconExitFull = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><path d="M9 9H3v6m18-6h-6v6M9 21H3v-6m12 0v6h6"/></svg>
);
export const IconLeave = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><path d="M10 7h7v10h-7"/><path d="M13 12H3m4-3l-3 3 3 3"/></svg>
);
export const IconPin = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><path d="M9 3l6 6-2 2 4 6-2 2-6-4-2 2-2-2 2-2-4-6 2-2z"/></svg>
);
export const IconLink = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 1 0-7l1.5-1.5a5 5 0 0 1 7 7L17 13"/><path d="M14 11a5 5 0 0 1 0 7L12.5 19.5a5 5 0 0 1-7-7L7 11"/></svg>
);
export const IconInvite = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24"><path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/></svg>
);

// Generic user/person circle icon for placeholders
export const IconUser = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c2.5-3.5 6-5 8-5s5.5 1.5 8 5" />
  </svg>
);

// Aspect ratio icon (two arrows indicating aspect)
export const IconAspect = (p: IconProps) => (
  <svg {...S(p)} viewBox="0 0 24 24">
    <rect x="4" y="6" width="16" height="12" rx="2" />
    <path d="M9 10h6M9 14h6" />
  </svg>
);
