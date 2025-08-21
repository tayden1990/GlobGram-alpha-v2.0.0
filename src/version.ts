export type BuildInfo = {
  sha: string
  shortSha: string
  ref: string
  refName: string
  date: string
  repo: string
  url: string
  base: string
  mode: string
}

const env = (import.meta as any).env || {}

const sha = (env.VITE_BUILD_SHA as string) || 'dev'
const shortSha = sha ? sha.slice(0, 7) : 'dev'
const ref = (env.VITE_BUILD_REF as string) || 'local'
const refName = (env.VITE_BUILD_REF_NAME as string) || 'local'
const date = (env.VITE_BUILD_DATE as string) || new Date().toISOString()
const repo = (env.VITE_REPO_NAME as string) || 'local'
const url = (env.VITE_BUILD_URL as string) || ''
const base = (env.BASE_URL as string) || '/'
const mode = env.DEV ? 'development' : (env.MODE || 'production')

export const BUILD_INFO: BuildInfo = { sha, shortSha, ref, refName, date, repo, url, base, mode }
