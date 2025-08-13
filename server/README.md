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

Configure app
- Create `.env` in project root:
```
VITE_UPLOAD_BASE_URL=http://localhost:8787
```
- Restart `npm run dev`.

Notes
- Data is in-memory only; restarting clears it.
- Encryption remains end-to-end in the client before upload.
