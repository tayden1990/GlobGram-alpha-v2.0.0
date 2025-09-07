import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Base path logic:
 *  - For GitHub Pages we need assets served from /<repo-name>/
 *  - In GitHub Actions we export REPO_NAME (added in workflow) so base becomes "/GlobGram-alpha-v2.0.0/".
 *  - Locally we still want '/' so dev server works normally.
 *  - You can override by setting VITE_BASE env (takes precedence).
 */
const explicit = process.env.VITE_BASE && process.env.VITE_BASE.trim()
const repo = process.env.REPO_NAME && process.env.REPO_NAME.trim()
const ghRepo = process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY.split('/').pop()
const base = explicit || (repo ? `/${repo}/` : ghRepo ? `/${ghRepo}/` : '/')

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      // Dev-only proxy to avoid CORS when talking to relay1.matrus.org
      '/_relay': {
        target: 'https://relay1.matrus.org',
        changeOrigin: true,
        secure: true,
        // strip the '/_relay' prefix
        rewrite: (path) => path.replace(/^\/_relay/, '')
      }
    }
  }
})
