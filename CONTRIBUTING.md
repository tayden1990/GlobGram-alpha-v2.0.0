# Contributing to GlobGram

Thanks for your interest in contributing!

## Quick start

1. Fork the repo and clone your fork
2. Install Node.js 18+ (20 recommended)
3. Install deps:

```powershell
npm ci
```

4. Start dev server:

```powershell
npm run dev
```

5. Open http://localhost:5173

## Code style and conventions

- TypeScript strict where practical; prefer explicit types for public APIs and exported functions
- Keep components small and focused; colocate helper functions near usage
- Use Zustand stores for shared state; avoid global mutable state
- Prefer pure functions and narrow modules in `src/services/` and `src/nostr/`
- i18n: use `useI18n().t('key')` with meaningful keys; add new keys to all `public/locales/*.json`
- RTL: avoid hard-coded LTR layout; use flex and logical CSS properties when possible

## Commits and PRs

- One logical change per PR; include a concise title and description
- Reference related issues with `Fixes #123` when applicable
- Keep PRs small; large refactors should be split into reviewable chunks

## Testing and validation

- Run `npm run build` before submitting PRs to ensure type checks and bundling succeed
- Smoke test key flows: onboarding, invite sharing, sending text + media in DMs and Rooms
- Verify non-English locales render expected labels for any new keys

## Adding or updating translations

- Edit `public/locales/<code>.json`
- Ensure new keys exist for all languages; fallback to English if unsure
- Keep phrasing concise and consistent with existing tone

## Media upload backends

- For local testing, use `server/upload-server.mjs` and set `VITE_UPLOAD_BASE_URL` in `.env`
- For production, configure NIP-96 or your own HTTPS storage and set the `VITE_UPLOAD_*` vars in repo secrets

## Branching

- Use feature branches: `feat/...`, `fix/...`, `docs/...`, `refactor/...`
- Avoid pushing directly to `main` unless trivial docs or CI fixes

## Code of Conduct

Please be respectful and follow our `CODE_OF_CONDUCT.md`.

## Questions

Open a GitHub Discussion or Issue. We’re happy to help.
