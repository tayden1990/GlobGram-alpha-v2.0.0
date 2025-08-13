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

Steps (one-time):
- In GitHub: Settings → Pages → Build and deployment → Source: GitHub Actions

On the next push to `main`, the site will be deployed at:
`https://<your-username>.github.io/<this-repo-name>/`

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
