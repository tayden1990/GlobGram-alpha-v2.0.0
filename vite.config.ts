import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Allow setting the base path for GitHub Pages deployments.
// In GitHub Actions we pass REPO_NAME to ensure assets resolve at /<repo>/...
const base = process.env.REPO_NAME ? `/${process.env.REPO_NAME}/` : '/'

export default defineConfig({
  base,
  plugins: [react()],
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
