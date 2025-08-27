// URL utilities for building links that respect the app base (e.g., GitHub Pages /<repo>/)

function getRuntimeBaseUrl(): string {
	// Prefer the document's base URI at runtime (most robust on GitHub Pages)
	try {
		// new URL('.', base) yields an absolute URL ending with a slash
		const u = new URL('.', document.baseURI)
		return u.toString()
	} catch {}
	// Fallback to Vite BASE_URL at build time
	try {
		const base = (import.meta as any)?.env?.BASE_URL || '/'
		const u = new URL(base, window.location.origin)
		return u.toString()
	} catch {}
	// Last resort: origin root
	return window.location.origin + '/'
}

export function getBasePath(): string {
	try {
		const abs = getRuntimeBaseUrl()
		const url = new URL(abs)
		let path = url.pathname || '/'
		if (!path.endsWith('/')) path += '/'
		return path
	} catch {
		return '/'
	}
}

export function getAppBaseUrl(): string {
	return getRuntimeBaseUrl()
}

export function buildAppUrl(pathname = '', params?: Record<string, string | number | boolean | undefined>): string {
	const baseAbs = getRuntimeBaseUrl()
	const url = new URL(pathname || '.', baseAbs)
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

