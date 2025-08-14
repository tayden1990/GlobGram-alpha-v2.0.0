# GlobGram Alpha

A lightweight, mobile-first Nostr chat app built with React + Vite. Supports DMs and Rooms, media attachments (images/video/audio/files), thumbnails + lightbox, virtualization, PWA, theming, and accessibility.

## Quick start

1. Install dependencies
2. Start the dev server

### Requirements
- Node.js 18+

### Run

```powershell
# from repo root
npm ci
npm run dev
```

Visit: http://localhost:5173

## Build

```powershell
npm run build
```

Outputs to `dist/`.

## Deploy to GitHub Pages

This repo includes a GitHub Actions workflow that builds and deploys the app to GitHub Pages when you push to `main`.

One-time repo setup:
- GitHub → Settings → Pages → Build and deployment → Source: GitHub Actions

Notes:
- The Vite config automatically sets `base` from `REPO_NAME` in CI, so assets resolve correctly at `/<repo>/`.
- A SPA 404 fallback is added by the workflow, so client-side routes work on refresh.

Publish:
1. Commit and push to `main`.
2. Wait for the "Deploy to GitHub Pages" workflow to finish.
3. Visit: `https://<your-username>.github.io/<this-repo-name>/`

## Release builds

Tag the repo with a semver tag (e.g. `v0.1.0`) to trigger the Release workflow, which uploads a zip of the `dist/` build.

```powershell
# bump version in package.json if desired
npm version patch
# push tag
git push --follow-tags
```

## Notes
- Keys are stored only in your browser localStorage.
- This is a demo; use test keys and avoid sharing secrets.
- Relays are public infra; messages are encrypted but metadata is visible.

## License

MIT — see `LICENSE`.
