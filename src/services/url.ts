// URL utilities for building links that respect Vite base (e.g., GitHub Pages /<repo>/)

export function getBasePath(): string {
	// Vite injects import.meta.env.BASE_URL at build time; default to '/'
	const base = (import.meta as any)?.env?.BASE_URL || '/'
	// Ensure it ends with a slash
	if (typeof base === 'string') return base.endsWith('/') ? base : base + '/'
	return '/'
}

export function getAppBaseUrl(): string {
	// Compose absolute base URL: origin + BASE_URL
	try {
		const base = getBasePath()
		const u = new URL(base, window.location.origin)
		return u.toString()
	} catch {
		return window.location.origin + getBasePath()
	}
}

export function buildAppUrl(pathname = '', params?: Record<string, string | number | boolean | undefined>): string {
	const base = getAppBaseUrl()
	const url = new URL(pathname || '.', base)
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			if (v === undefined || v === null) continue
			url.searchParams.set(k, String(v))
		}
	}
	return url.toString()
}

export function buildJoinCallUrl(roomId: string): string {
	return buildAppUrl('', { room: roomId, action: 'join-call' })
}

