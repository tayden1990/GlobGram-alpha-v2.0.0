export type GithubAsset = {
  name: string
  browser_download_url: string
}

export type GithubRelease = {
  tag_name: string
  name?: string
  html_url?: string
  assets?: GithubAsset[]
  draft?: boolean
  prerelease?: boolean
}

export async function checkLatestRelease(owner: string, repo: string): Promise<GithubRelease> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`
  const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data as GithubRelease
}

// Compare two semver-like tags (with optional leading 'v'), return true if a > b
export function semverGreater(a: string, b: string): boolean {
  const parse = (s: string) => s.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  const A = parse(a)
  const B = parse(b)
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const ai = A[i] ?? 0
    const bi = B[i] ?? 0
    if (ai > bi) return true
    if (ai < bi) return false
  }
  return false
}
