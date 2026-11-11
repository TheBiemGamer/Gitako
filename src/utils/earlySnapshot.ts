import {
  EARLY_STYLE_ELEMENT_ID,
  earlyStyle,
  getRepoPath,
  GITEA_ORIGIN_FLAG_KEY,
  Snapshot,
  SNAPSHOT_ATTRIBUTE,
  SNAPSHOT_ELEMENT_ID,
  SNAPSHOT_KEY,
} from 'earlyShared'
import { useEffect } from 'react'

const SPACING_ATTRIBUTE = 'data-with-gitako-spacing'
const SCROLLER_SELECTOR = '.gitako-side-bar .files > div'

function readSnapshot(): Snapshot | null {
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function collectStyledComponentsCSS(root: Element) {
  // styled-components inserts rules through the CSSOM, so textContent is empty
  const rules: string[] = []
  root.querySelectorAll('style').forEach(style => {
    try {
      for (const rule of Array.from(style.sheet?.cssRules || [])) rules.push(rule.cssText)
    } catch {
      // unreadable sheet: skip
    }
  })
  return rules.join('\n')
}

// A file node links to `{refPrefix}/{path}` and carries the path as its title
function getRefPrefix(mount: Element) {
  for (const node of Array.from(mount.querySelectorAll<HTMLAnchorElement>('a.node-item[title]'))) {
    const path = node.getAttribute('title') || ''
    const { pathname } = new URL(node.href)
    const suffix = '/' + path.split('/').map(encodeURIComponent).join('/')
    if (path && pathname.endsWith(suffix)) return pathname.slice(0, -suffix.length)
  }
  return null
}

function saveSnapshot() {
  const html = document.documentElement
  const spacing = html.getAttribute(SPACING_ATTRIBUTE)
  const repo = getRepoPath(location.pathname)
  const mount = document.getElementById('gitako-sidebar-mount-point')
  const root = document.getElementById('gitako-root')
  const wrapper = mount?.querySelector('.gitako-side-bar-body-wrapper')
  const docked =
    (spacing === 'left' || spacing === 'right') &&
    wrapper &&
    !wrapper.classList.contains('collapsed') &&
    mount?.querySelector('.node-item')
  try {
    if (!repo || !mount || !root || !docked) {
      sessionStorage.removeItem(SNAPSHOT_KEY)
      return
    }
    const clone = mount.cloneNode(true) as HTMLElement
    clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'))
    const attributes: Record<string, string> = {}
    for (const { name, value } of Array.from(html.attributes)) {
      if (
        name === SPACING_ATTRIBUTE ||
        (name.startsWith('data-gitako-') &&
          name !== SNAPSHOT_ATTRIBUTE &&
          name !== 'data-gitako-ready')
      )
        attributes[name] = value
    }
    const refPrefix = getRefPrefix(mount)
    if (!refPrefix) {
      sessionStorage.removeItem(SNAPSHOT_KEY)
      return
    }
    const snapshot: Snapshot = {
      repo,
      refPrefix,
      html: clone.innerHTML,
      css: collectStyledComponentsCSS(root),
      attributes,
      width: html.style.getPropertyValue('--gitako-width'),
      scrollTop: mount.querySelector(SCROLLER_SELECTOR)?.scrollTop || 0,
    }
    sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // quota or blocked storage: the next page just mounts without a snapshot
  }
}

/** Scroll offset the tree had on the previous page of this repo, if any. */
export function getSnapshotScrollTop(): number | null {
  const snapshot = readSnapshot()
  if (!snapshot || snapshot.repo !== getRepoPath(location.pathname)) return null
  return snapshot.scrollTop
}

export function removeEarlySnapshot() {
  document.getElementById(SNAPSHOT_ELEMENT_ID)?.remove()
  document.documentElement.removeAttribute(SNAPSHOT_ATTRIBUTE)
}

/** Gitea/Forgejo: enable early paint for this origin and snapshot on leave. */
export function useEarlySnapshot() {
  useEffect(() => {
    try {
      localStorage.setItem(GITEA_ORIGIN_FLAG_KEY, '1')
    } catch {
      // blocked storage: early paint stays off
    }
    // first visit to this origin: early.ts did not know it yet, so add the
    // view transition opt-in here too
    if (!document.getElementById(EARLY_STYLE_ELEMENT_ID)) {
      const style = document.createElement('style')
      style.id = EARLY_STYLE_ELEMENT_ID
      style.textContent = earlyStyle
      document.documentElement.appendChild(style)
    }
    window.addEventListener('pagehide', saveSnapshot)
    return () => window.removeEventListener('pagehide', saveSnapshot)
  }, [])
}
