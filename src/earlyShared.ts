/**
 * Shared between early.ts (document_start, must stay dependency-free and tiny)
 * and the content script.
 *
 * Gitea/Forgejo navigate with full page loads. To make the sidebar look like
 * it never leaves, the content script saves a snapshot of the rendered sidebar
 * on `pagehide`, and early.ts paints it in the next page's first frame, before
 * Gitako itself has mounted. Gitako removes it once its own tree is rendered.
 */

// localStorage (per origin): this origin is a Gitea/Forgejo instance Gitako runs on
export const GITEA_ORIGIN_FLAG_KEY = 'gitako-gitea-origin'
// sessionStorage (per tab): last sidebar snapshot
export const SNAPSHOT_KEY = 'gitako-sidebar-snapshot'

export const SNAPSHOT_ELEMENT_ID = 'gitako-early-snapshot'
export const EARLY_STYLE_ELEMENT_ID = 'gitako-early-style'
// set on <html> while the snapshot is shown
export const SNAPSHOT_ATTRIBUTE = 'data-gitako-early-snapshot'

export type Snapshot = {
  // `/{owner}/{repo}`: only reuse the snapshot inside the same repo
  repo: string
  // e.g. `/{owner}/{repo}/src/branch/main`: only reuse it on the same ref
  refPrefix: string
  html: string
  // CSS rules of styled-components (Primer React) used by the snapshot markup
  css: string
  // attributes Gitako sets on <html> (body indent, theme, platform)
  attributes: Record<string, string>
  width: string
  scrollTop: number
}

// Cross-document view transitions: the page content crossfades while the
// sidebar swaps without animation. Only when the user has not asked for
// reduced motion; the early snapshot alone already keeps the sidebar painted.
export const earlyStyle = `
@media (prefers-reduced-motion: no-preference) {
  @view-transition { navigation: auto; }
}
::view-transition-group(gitako-sidebar),
::view-transition-new(gitako-sidebar) { animation: none; }
::view-transition-old(gitako-sidebar) { display: none; }
`

export function getRepoPath(pathname: string) {
  const [, owner, repo] = pathname.split('/')
  return owner && repo ? `/${owner}/${repo}` : null
}

// Pages where the docked sidebar is shown by default: repo home and code views
// of the same ref
export function isSnapshotPage(pathname: string, snapshot: Pick<Snapshot, 'repo' | 'refPrefix'>) {
  const { repo, refPrefix } = snapshot
  if (pathname === repo || pathname === `${repo}/`) return true
  if (!refPrefix || !pathname.startsWith(refPrefix)) return false
  const next = pathname.charAt(refPrefix.length)
  return next === '' || next === '/'
}
