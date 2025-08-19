# Minimal Upload Server

A tiny in-memory HTTP storage to replace `mem://` during local dev.

API
- POST /upload { key, mime, data(base64) } -> { url }
- GET  /o/:key -> { mime, data }

Run
```powershell
# from repo root
npm i express cors body-parser --prefix server
node server/upload-server.js
```

Cross‑device (receiver fetch) notes
- The in‑app fallback uses mem:// which lives only in the sender's tab. Receivers cannot read it.
- To allow receivers to fetch media, you must run the upload server and set VITE_UPLOAD_BASE_URL.
- For two devices on the same Wi‑Fi, use your LAN IP, not localhost.

Example on Windows PowerShell
```powershell
# 1) Start the upload server
npm i express cors body-parser --prefix server
node server/upload-server.js

# 2) Create a .env in project root with your LAN IP (replace with your own):
"VITE_UPLOAD_BASE_URL=http://192.168.1.50:8787" | Out-File -Encoding utf8 .env

# 3) Restart the app
npm run dev
```

Configure app
- Create `.env` in project root:
```
VITE_UPLOAD_BASE_URL=http://localhost:8787
```
- Restart `npm run dev`.

Secure it (optional, recommended if exposed beyond localhost)
- Start server with a token:
```
# PowerShell
$env:UPLOAD_AUTH_TOKEN="yourStrongToken"; node server/upload-server.js
```
- Add this to your app `.env` so the client includes Authorization automatically:
```
VITE_UPLOAD_AUTH_TOKEN=yourStrongToken
```

Notes
- Data is in-memory only; restarting clears it.
- Encryption remains end-to-end in the client before upload.
