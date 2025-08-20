// Central app configuration with hardcoded defaults.
// Edit these values to match your deployment. This file is imported instead of relying on VITE_* envs in Pages builds.

export type UploadMode = 'simple' | 'nip96'
export type AuthMode = 'none' | 'token' | 'nip98'

export const CONFIG = {
  // If true, use the hardcoded values below. If false, code may consult envs when available.
  USE_HARDCODED: true,

  // Media upload backend
  // For simple dev server (server/upload-server.js), set to your server origin, no trailing slash, e.g. "https://your-upload.example.com"
  // For NIP-96, set to the base domain (origin) for discovery, e.g. "https://relay1.matrus.org"
  UPLOAD_BASE_URL: 'https://relay1.matrus.org',
  // Public base for constructing download URLs when needed (usually the origin of your upload server)
  UPLOAD_PUBLIC_BASE_URL: 'https://relay1.matrus.org',
  // Upload mode: 'simple' (JSON to /upload) or 'nip96' (multipart per NIP-96)
  UPLOAD_MODE: 'nip96' as UploadMode,
  // Auth mode for upload/download: 'none' | 'token' | 'nip98'
  UPLOAD_AUTH_MODE: 'nip98' as AuthMode,
  // Optional static token for 'token' auth mode
  UPLOAD_AUTH_TOKEN: '',

  // UI: default behavior for auto-resolving media (can be toggled by user and persisted in localStorage)
  AUTO_RESOLVE_MEDIA_DEFAULT: false,
}
