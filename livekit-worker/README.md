LiveKit token service (Cloudflare Worker)
----------------------------------------

You'll deploy a tiny token endpoint that returns a JWT for clients to join a room.

Required secrets (set via Wrangler or Dashboard):
- LIVEKIT_API_KEY
- LIVEKIT_API_SECRET
- LIVEKIT_WS_URL (e.g., wss://your-subdomain.livekit.cloud)

Set CONFIG values in src/config.ts:
- LIVEKIT_ENABLED: true
- LIVEKIT_WS_URL: your wss URL
- LIVEKIT_TOKEN_ENDPOINT: public URL of your Worker, e.g. https://calls.example.workers.dev/token

This repo includes a ready Worker in `livekit-worker/src/index.ts` and `wrangler.toml`.

Usage
- cd livekit-worker
- npm install
- npx wrangler secret put LIVEKIT_API_KEY
- npx wrangler secret put LIVEKIT_API_SECRET
- npx wrangler kv:namespace list (optional)
- npm run deploy

After deploy, copy the URL (e.g., https://globgram-livekit-token.yourname.workers.dev/token) into `CONFIG.LIVEKIT_TOKEN_ENDPOINT`.

App wiring
- In `src/config.ts` set:
  - LIVEKIT_ENABLED: true
  - LIVEKIT_WS_URL: wss://your-subdomain.livekit.cloud
  - LIVEKIT_TOKEN_ENDPOINT: https://.../token

Local dev tip
- You can test via wrangler dev and point LIVEKIT_TOKEN_ENDPOINT to http://127.0.0.1:8787/token while running `npm run dev` for the app. If your app runs over https, the browser may block mixed content; use http only when app is served over http.
