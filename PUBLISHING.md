# Publishing GlobGram

This project is configured to build with Vite and deploy to GitHub Pages, and includes a ready-to-copy NostrApps entry.

## 1) Build locally

Requirements: Node.js 20+

```powershell
npm ci
npm run build
```

Output will be in `dist/`.

## 2) Deploy to GitHub Pages

We ship a workflow at `.github/workflows/deploy-pages.yml`.

Steps:
- Push to `main`.
- On GitHub, enable Pages: Settings → Pages → Build and deployment → Source = GitHub Actions.
- The workflow sets the Vite `base` from the repo name and deploys `dist/`.

Your site will be at:
```
https://<github-username>.github.io/<repo-name>/
```

If you host elsewhere, set `REPO_NAME` or configure `vite.config.ts` base accordingly.

## 3) Prepare assets for NostrApps

NostrApps fields reference: https://nostrapps.com/ (backed by https://git.fiatjaf.com/nostrapps.com)

Fill out `NOSTRAPPS.toml`:
- `npub`: maintainer npub.
- `thumb`: link to a 256–512 square icon (e.g., `public/icons/icon-512.png` hosted on Pages or a CDN).
- `gallery`: 1+ screenshots hosted on a stable URL.
- `url`: your deployed site URL.

## 4) Submit to NostrApps

Options:
- Open a PR to `apps.toml` with the block in `NOSTRAPPS.toml`:
  - Repo: https://git.fiatjaf.com/nostrapps.com
  - File: `apps.toml`
  - Add a new table `[globgram]` (or another unique key)
- Or contact maintainers with the listing details.

## 5) Optional: Custom domain

If using a custom domain on Pages, configure DNS and set Pages → Custom domain. Update `url` in `NOSTRAPPS.toml`.

## 6) Troubleshooting

- Blank page on Pages: ensure `vite.config.ts` sets `base` to `/${REPO_NAME}/` on CI (provided). Also check `index.html` asset paths use `./` or `import.meta.env.BASE_URL`.
- Service Worker caching: cache-busting is configured; if you update frequently, consider a manual update button.
