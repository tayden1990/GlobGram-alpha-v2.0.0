# GlobGram Alpha

A minimal decentralized messenger (DMs) using Nostr relays (NIP-04) built with React, TypeScript, and Vite.

Features:
- Generate and persist a Nostr keypair (localStorage)
- Connect to public relays
- Send and receive end-to-end encrypted DMs (kind:4) via NIP-04

## Quick start

1. Install dependencies
2. Start dev server

### Requirements
- Node.js 18+

### Run

```powershell
# from repo root
npm install
npm run dev
```

Visit: http://localhost:5173

## Notes
- Keys are stored only in your browser localStorage.
- This is a demo; use test keys and avoid sharing secrets.
- Relays are public infra; messages are encrypted but metadata is visible.
