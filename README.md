# GlobGram (Alpha)

GlobGram is a lightweight, mobile‑first chat app powered by the Nostr protocol. It’s a privacy‑first, PWA‑enabled messenger with end‑to‑end encrypted DMs, Rooms, media sharing, offline support, and a focus on user data ownership.

Built with React + TypeScript + Vite.

## What is Nostr?

Nostr (Notes and Other Stuff Transmitted by Relays) is an open, decentralized protocol for sharing events. Clients publish events to Relays (simple WebSocket servers). Anyone can run a Relay; anyone can use any Client.

- Identities are public keys (npub). You own your identity because you own the keypair.
- Messages are events signed with your secret key (nsec). Relays verify the signature before accepting.
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

## Release builds

Tag the repo with a semver tag (e.g., `v0.1.0`) to trigger the Release workflow and upload a zip of `dist/`.

```powershell
npm version patch
git push --follow-tags
```

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
