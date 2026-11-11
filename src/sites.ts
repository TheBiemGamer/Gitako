/**
 * Where Gitako runs: a list of origins, each on or off. Stored in
 * storage.local, edited by the options page and the toolbar context menu, and
 * turned into registered content scripts by the background (see background.ts).
 * This list is the single source of truth; the manifest has no static
 * content_scripts.
 */

// `browser` in Firefox, `chrome` in Chromium (MV3 APIs return promises there)
export const ext: typeof browser =
  (globalThis as { browser?: typeof browser }).browser ||
  (globalThis as unknown as { chrome: typeof browser }).chrome

export type Site = {
  origin: string // e.g. https://git.biem.cloud
  enabled: boolean
}

export const SITES_STORAGE_KEY = 'gitakoSites'

export const defaultSites: Site[] = [
  { origin: 'https://github.com', enabled: true },
  { origin: 'https://git.biem.cloud', enabled: true },
]

export const toMatchPattern = (origin: string) => `${origin}/*`

/** Accepts `git.example.com`, `https://git.example.com/some/path`, etc. */
export function normalizeOrigin(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname || url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

export async function getSites(): Promise<Site[]> {
  const stored = (await ext.storage.local.get(SITES_STORAGE_KEY))[SITES_STORAGE_KEY]
  return Array.isArray(stored) ? (stored as Site[]) : defaultSites
}

export async function setSites(sites: Site[]) {
  await ext.storage.local.set({ [SITES_STORAGE_KEY]: sites })
}

export async function hasPermission(origin: string) {
  return ext.permissions.contains({ origins: [toMatchPattern(origin)] })
}
