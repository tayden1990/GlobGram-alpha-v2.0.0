[![Deploy](https://github.com/tayden1990/GlobGram-alpha-v2.0.0/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/tayden1990/GlobGram-alpha-v2.0.0/actions/workflows/deploy.yml)
[![Release (Android + Desktop)](https://github.com/tayden1990/GlobGram-alpha-v2.0.0/actions/workflows/release-all.yml/badge.svg)](https://github.com/tayden1990/GlobGram-alpha-v2.0.0/actions/workflows/release-all.yml)

GlobGram is a lightweight, mobile‑first chat app powered by the Nostr protocol. It’s a privacy‑first, PWA‑enabled messenger with end‑to‑end encrypted DMs, Rooms, media sharing, offline support, and a focus on user data ownership.

Built with React 18, TypeScript, Vite, and nostr-tools.

This README explains the architecture, configuration, development workflow, deployment, and how to contribute.

## What is Nostr?

Nostr (Notes and Other Stuff Transmitted by Relays) is an open, decentralized protocol for sharing events. Clients publish events to Relays (simple WebSocket servers). Anyone can run a Relay; anyone can use any Client.

- Identities are public keys (npub). You own your identity because you own the keypair.
- Messages are events signed with your secret key (nsec). Relays verify signatures before accepting.
- DMs use encrypted content (e.g., NIP‑04) so only sender and recipient can read them. Relays can see envelope metadata (time, size, type) but not plaintext.
- You’re not locked into a server or app. Your npub works across clients; your data can be synced via multiple relays.

Useful references: NIPs (Nostr Improvement Proposals) such as NIP‑01 (base protocol), NIP‑04 (encrypted DMs), NIP‑13 (PoW), and room‑related kinds 40‑42.

## Core features

- Direct Messages (DMs) and Rooms (group chat)
- End‑to‑end encryption for DMs; optional passphrase for media payloads
- Media attachments: images, video, audio, files
	- Inline thumbnails, video/audio preview, lightbox
	- On‑device “Preparing…” progress and image compression
	- 10 MB per‑message media cap with friendly errors
- Reliable sending UX
	- Status badges: pending, sent, delivered, failed (with reason)
	- Delivery receipts and per‑relay OK/NOTICE logging
	- Exponential backoff + retries for transient failures
- Performance
	- Virtualized message list for smooth scrolling
	- Lazy loading and deduped subscriptions
- PWA
	- Installable app, offline fallback, service worker cache with update notifications
- Diagnostics & Logs
	- Password‑gated log viewer (4522815), unlimited IndexedDB persistence, export/clear
- Accessibility & Mobile‑first UI

## Architecture overview

High level
- Clients publish/subscribe Nostr events over WebSocket relays (see `src/nostr`).
- DMs are sent as encrypted events; Rooms are group channels based on kinds 40/41/42.
- Media can be sent inline (small) or uploaded to a server (large) with signed pointers.
- State is held with small, focused Zustand stores and React component state.

Messaging engine (Nostr)
- `src/nostr/engine.ts`: send/receive messages, deliver receipts, apply membership updates, handle room subscriptions; upload pipeline hooks for media (NIP‑96, optional NIP‑98 auth).
- `src/nostr/pool.ts`: relay pool creation and WebSocket lifecycle.
- `src/nostr/utils.ts`: helpers (hex/bytes, validation, etc.).
- Event kinds: DMs, Receipts (custom 10001), Rooms (40/41/42); PoW (NIP‑13) optional.

Media pipeline
- Small attachments embed as data URLs or memory URLs (`mem://`) for local echo.
- Large media: prepare → optionally encrypt → upload → send pointer; progress UI shows Preparing/Uploading/Publishing.
- Upload backends: Simple (server/upload-server.mjs) or NIP‑96; optional NIP‑98 auth.

UI
- `src/ui/App.tsx`: root shell, onboarding, settings, ads bar, PWA install, SW updates, invite flow, build info.
- `src/ui/ChatWindow.tsx` and `src/ui/RoomWindow.tsx`: message UIs with media controls, auto‑load media toggle, progress states.
- `src/ui/Toast.tsx`: lightweight toast system.
- Virtualized lists via `@tanstack/react-virtual`.

State
- `src/state/*`: small zustand stores for chats, rooms, relays, settings. Monotonic room membership application by created_at to avoid reordering.

Internationalization (i18n)
- `src/i18n/index.tsx`: runtime loader for `public/locales/*.json` with cache‑busting and RTL direction control. Missing keys fall back to English.
- User’s locale persists in localStorage; can be overridden by `?lang=xx` in invite links.

PWA / Service Worker
- `public/sw.js`: offline fallback, simple cache, version broadcast to UI. Bump `APP_VERSION` on notable releases.
- `public/manifest.webmanifest`: icons, theme, and PWA metadata.

Build metadata
- `src/version.ts` displays SHA, ref, date, mode, and base path in Settings so you can confirm which build is running.

### Internationalization
- Multi‑language UI with auto‑detect, persistence, and runtime switching (Settings or first onboarding step)
- Supported languages: 🇺🇸 English (`en`), 🇮🇷 فارسی (`fa`, RTL), 🇪🇸 Español (`es`), 🇫🇷 Français (`fr`), 🇩🇪 Deutsch (`de`), 🇵🇹 Português (`pt`), 🇷🇺 Русский (`ru`), 🇸🇦 العربية (`ar`, RTL)
- RTL locales automatically set `dir="rtl"` and add a `.rtl` class on `<html>`
- Dev‑time warning for missing translation keys in the console

Runtime locale files
- The app loads messages from `public/locales/<code>.json`. Ensure new keys are added to all languages.
- Cache busting is built in. If you still see stale strings after deploy, click “Update now” in the app or hard‑refresh.

### Onboarding
- Step 0: App + Nostr intro, choose language
- Step 1: Notifications permission
- Step 2: Microphone permission
- Step 3: Camera permission
- Step 4: Create or import your Nostr key (hex or nsec)
- Step 5: Install the PWA (if supported)
- Step 6: Quick tips

### Invite flow
- Generate an invite link containing your `npub`
- Show a QR code (downloadable as PNG)
- Share message + link using the Web Share API (and include QR file when supported)
- One‑click “Copy invite text” fallback

## Security and encryption

- Keys never leave your device. Your secret key is stored only in your browser (localStorage). You can also import/export it.
- DM encryption uses NIP‑04 (ECIES over secp256k1) via nostr‑tools.
- Optional media passphrase: large attachments can be symmetrically protected end‑to‑end.
- Proof‑of‑Work (NIP‑13) is supported to reduce spam; you can enable/disable mining.
- Threat model: Relays are untrusted and can drop/deny events. Metadata (time, approximate size) may be observable. Use multiple relays for reliability and privacy.

You own your data
- Your identity is your keypair (npub/nsec). You can use it in any Nostr app.
- Messages are signed by you; any compatible client can fetch/verify them from relays.
- You’re free to switch or add relays without losing your name or message history (assuming relays retain your events or you republish).

Best practices
- Backup your nsec in a secure password manager.
- Use multiple relays for availability and redundancy.
- Treat DM metadata as public; avoid sharing sensitive identifiers in message subjects or filenames.

## Getting started

Requirements
- Node.js 18+

Install & run
```powershell
# from repo root
npm ci
npm run dev
```

Open http://localhost:5173

Build
```powershell
npm run build
```

The optimized build is in `dist/`.

Preview (optional)
```powershell
npm run preview
```

Tip: If you see an update banner in the app, you can click “Update now” or wait for the short auto‑apply countdown.

## Configuration

Environment variables (Vite)
- `REPO_NAME` (CI): sets the Vite `base` path so assets resolve under `/<repo>/` on GitHub Pages.
- `VITE_REPO_NAME`, `VITE_BUILD_SHA`, `VITE_BUILD_REF`, `VITE_BUILD_REF_NAME`, `VITE_BUILD_URL`, `VITE_BUILD_DATE` (CI): injected for build info UI.
- Media upload (production):
	- `VITE_UPLOAD_BASE_URL`: e.g. `https://media.example.com/upload` (NIP‑96) or `https://media.example.com` (simple server)
	- `VITE_UPLOAD_MODE`: `nip96` or `simple`
	- `VITE_UPLOAD_AUTH_MODE`: `none` | `token` | `nip98`
	- `VITE_UPLOAD_AUTH_TOKEN`: when `token` is used
	- `VITE_UPLOAD_PUBLIC_BASE_URL`: public base to help download URL inference

Dev relay proxy
- Vite dev server exposes `/_relay/*` → `https://relay1.matrus.org/*` to avoid CORS in local dev (see `vite.config.ts`).

## Using GlobGram

1) Create or import a key
- The app generates a keypair on first run or lets you import your existing nsec. Your npub is your public identity.

2) Add relays
- Default public relays are preconfigured. You can add/remove relays in Settings.

3) Start a DM or create/join a Room
- DMs: choose a contact’s npub and start messaging.
- Rooms: create a room or join by ID.

4) Send messages and media
- Type your message; attach files, record audio/video, or take a photo.
- A “Preparing…” progress bar appears during on‑device processing (encoding/compressing).
- The Send button enables when content is ready; you’ll see status transitions (pending → sent → delivered or failed).

5) Install and go offline
- Add to Home Screen (mobile) or “Install” (desktop) for a PWA experience. Basic functionality and cached UI work offline; messages send when back online.

6) Invite friends
- Click “Invite a friend” in the header
- Share the text + link via your system share sheet (when available), or copy the invite text
- Show the QR code to scan, or download it as a PNG

## Project structure

```
src/
	i18n/                Runtime loader + messages
	nostr/               Engine, pool, media helpers, NIP helpers
	services/            Upload/download utilities and MIME handling
	state/               Zustand stores (chat, room, relay, settings)
	ui/                  React components (App, ChatWindow, RoomWindow, lists, toasts)
	version.ts           Build/version info exported to UI
public/
	locales/             Runtime translation JSONs
	sw.js                Service worker with cache + version messaging
	manifest.webmanifest PWA manifest
server/                Minimal upload server for local dev/testing
```

## Internationalization (i18n)

Runtime i18n is provided by `src/i18n/index.tsx` with dynamic JSON loading per locale.

- Auto‑detects the browser language on first run and persists the user choice in `localStorage`
- Language can be changed from Settings or during onboarding (step 0)
- RTL locales (fa, ar) automatically switch text direction and add a `.rtl` class on the `<html>` element
- In development, missing keys log a warning to the console: `[i18n] Missing key for locale ...`

Add a new language
1. Duplicate `src/i18n/locales/en.json` to `src/i18n/locales/<code>.json` and translate
2. In `src/i18n/index.tsx`, add the locale to:
	 - `loaders` (dynamic import)
	 - `localeNames` (display name)
	 - `localeFlags` (optional emoji flag shown next to the name)
	 - Add to RTL set if needed: `new Set(['fa', 'ar', ...])`
3. Build and run; the language should appear in onboarding and settings

## Deployment (GitHub Pages)

This repo includes a GitHub Actions workflow that builds and deploys to GitHub Pages when pushing to `main`.

One‑time setup
- GitHub → Settings → Pages → Build and deployment → Source: GitHub Actions

Notes
- Vite’s `base` is set automatically in CI for correct `/<repo>/` asset paths.
- The workflow adds a SPA 404 fallback so client routes work on refresh.

Publish
1. Commit and push to `main`.
2. Wait for the action to complete.
3. Visit: `https://<your-username>.github.io/<this-repo-name>/`

Build provenance
- The Settings → Preferences screen shows the build’s commit, ref, date, mode, and Service Worker version.

## Release builds

Tag the repo with a semver tag (e.g., `v0.1.0`) to trigger the Release workflow and upload a zip of `dist/`.

```powershell
npm version patch
git push --follow-tags
```

### Automated desktop app builds (Windows/macOS/Linux)

This repo includes a workflow that packages the deployed PWA as native desktop apps using Nativefier.

- Workflow: `.github/workflows/desktop-nativefier.yml`
- Trigger: pushing a semver tag (e.g., `v0.2.0`) or manual dispatch
- Output: zip archives for each OS attached to the workflow run and to the GitHub Release (when tag)

Notes:
- The app URL is inferred as `https://<user>.github.io/<repo>/`. If you use a custom domain, update the workflow’s APP_URL logic.
- Nativefier wraps the web app; for offline/deep system integration, consider Electron proper.

### Automated Android APK (Trusted Web Activity)

This repo includes an experimental pipeline to build an Android APK via Bubblewrap (TWA) that launches your PWA in Chrome.

- Workflow: `.github/workflows/android-twa.yml`
- Trigger: pushing a semver tag (e.g., `v0.2.0`) or manual dispatch
- Output: unsigned APK (and signed if you provide keystore secrets) as artifacts and attached to the Release

Setup keystore (optional for local install; required for Play Store): add Secrets
- ANDROID_KEYSTORE_BASE64: base64 of your keystore.jks
- ANDROID_KEY_ALIAS: key alias
- ANDROID_KEY_PASSWORD: key password
- ANDROID_STORE_PASSWORD: store password

Notes:
- The TWA manifest is initialized from `public/manifest.webmanifest`; icons, name, and colors come from there.
- The workflow sets start_url to your GitHub Pages URL; adjust if using a custom domain.
- To publish to Play Store, you’ll likely want to fork the generated project locally (or in a dedicated repo) and iterate on signing, versioning, and Play requirements (package name, Digital Asset Links, etc.).

## Troubleshooting

- App didn’t update after a deploy
	- Click the “Update now” button in the in‑app banner when shown, or reload the page
	- As a last resort, unregister service workers and clear caches, then reload
- Install prompt didn’t appear
	- Ensure HTTPS (or localhost), not in private browsing
	- App must not already be installed/opened in app‑mode
	- On iOS Safari, use Share → Add to Home Screen
- Media/camera/microphone errors
	- Ensure permissions are granted (see statuses in onboarding)
	- Some browsers/devices may not support certain capture APIs
- Copy/share issues
	- Web Share varies by platform; the app falls back to copying invite text to the clipboard
- Missing translations
	- In dev, missing keys log to the console; ensure the key exists in the locale JSON

## Contributing

We welcome issues and pull requests. Please read `CONTRIBUTING.md` for environment setup, coding conventions, and PR checklist. By participating, you agree to `CODE_OF_CONDUCT.md`.

Useful entry points
- `src/ui/App.tsx` for UI shell and flows (onboarding, invite, settings, PWA updates).
- `src/nostr/engine.ts` for send/receive, room membership, and media stages.
- `src/services/upload.ts` for upload/download backends and MIME handling.
- `public/locales/*.json` to add or update translations.

## Roadmap (selected)

- Media recorder bit‑rate and duration knobs
- Optional direct media upload to dedicated storage with Nostr pointers
- Advanced moderation and relay health scoring
- Multi‑device key sync UX

## Disclaimers

- Alpha software: expect rapid changes and occasional breaking updates.
- Public relays may rate‑limit or drop events. Use several relays and export logs for diagnostics.
- Keep your nsec private. Anyone with it can impersonate you.

## License

MIT — see `LICENSE`.

## Production media (NIP‑96/NIP‑98) setup

When the app is hosted on GitHub Pages (or any non‑localhost origin), it cannot reach `http://localhost:*`. To make large media work in production, point the app to a public upload server and enable CORS.

1) Choose an upload backend
- Dev/simple (JSON): the included server at `server/upload-server.mjs` exposes:
	- POST /upload → { url }
	- GET  /o/:key → { mime, data }
	Deploy it behind HTTPS with CORS for your Pages origin.
- NIP‑96: a Nostr media server supporting NIP‑96 uploads and optional NIP‑98 auth.

2) Enable CORS on your server
- Allow Origin: your GitHub Pages origin, e.g. `https://<user>.github.io`
- Methods: GET, POST, OPTIONS
- Headers: Authorization, Content-Type
- Return 200 to preflight OPTIONS

Notes:
- The app uses the standard `Authorization` header for NIP‑98 and does not send any non‑standard `X-Authorization` header. Make sure your server includes `Authorization` in `Access-Control-Allow-Headers`.
- Multipart/form-data uploads trigger a preflight due to `Content-Type`. Ensure `Access-Control-Allow-Headers` includes `Content-Type`.

3) Configure production env via GitHub Secrets
Add these repository Secrets, then redeploy:
- VITE_UPLOAD_BASE_URL → e.g. `https://media.example.com/upload` (NIP‑96) or `https://media.example.com` (simple)
- VITE_UPLOAD_MODE → `nip96` or `simple`
- VITE_UPLOAD_AUTH_MODE → `none` | `token` | `nip98`
- VITE_UPLOAD_AUTH_TOKEN → only if using `token`
- VITE_UPLOAD_PUBLIC_BASE_URL → e.g. `https://media.example.com` (helps download URL inference)

The workflow `.github/workflows/deploy.yml` forwards these to the build step.

4) Verify
- On Pages, attach a large image. The UI should no longer show “Unavailable on this host (localhost upload)” and receivers should be able to Load/preview successfully.
- If a fetch fails, the app shows verbose diagnostics with the attempted URLs and auth mode to help you pinpoint CORS or path issues.

Note: In production, the app intentionally blocks attempts to fetch `localhost` URLs from a non‑localhost origin to avoid ERR_CONNECTION_REFUSED loops.

## Security

Please report vulnerabilities privately by opening a “privately disclosed security vulnerability” at the repository’s Security tab (GitHub → Security → Advisories → New draft advisory). See `SECURITY.md` for details.

## Quick release

```bash
git tag v2.0.1
git push origin v2.0.1
```
