/**
 * Runs at document_start on every page Gitako is injected into. A no-op unless
 * Gitako has seen this origin as Gitea/Forgejo; see earlyShared.ts.
 */
import {
  EARLY_STYLE_ELEMENT_ID,
  earlyStyle,
  getRepoPath,
  GITEA_ORIGIN_FLAG_KEY,
  isSnapshotPage,
  Snapshot,
  SNAPSHOT_ATTRIBUTE,
  SNAPSHOT_ELEMENT_ID,
  SNAPSHOT_KEY,
} from './earlyShared'

function readSnapshot(): Snapshot | null {
  const raw = sessionStorage.getItem(SNAPSHOT_KEY)
  if (!raw) return null
  const snapshot: Snapshot = JSON.parse(raw)
  const repo = getRepoPath(location.pathname)
  if (!repo || snapshot.repo !== repo || !isSnapshotPage(location.pathname, snapshot)) return null
  return snapshot
}

function paint(snapshot: Snapshot, style: HTMLStyleElement) {
  const html = document.documentElement
  for (const [name, value] of Object.entries(snapshot.attributes)) html.setAttribute(name, value)
  html.style.setProperty('--gitako-width', snapshot.width)
  html.setAttribute(SNAPSHOT_ATTRIBUTE, '')
  style.textContent += snapshot.css

  const container = document.createElement('div')
  container.id = SNAPSHOT_ELEMENT_ID
  container.innerHTML = snapshot.html

  const insert = () => {
    document.body.prepend(container)
    const scroller = container.querySelector('.files > div')
    if (scroller) scroller.scrollTop = snapshot.scrollTop
  }
  if (document.body) insert()
  else {
    // Mutation callbacks run before the first paint
    const observer = new MutationObserver(() => {
      if (!document.body) return
      observer.disconnect()
      insert()
    })
    observer.observe(html, { childList: true })
  }
}

try {
  if (localStorage.getItem(GITEA_ORIGIN_FLAG_KEY) === '1') {
    const style = document.createElement('style')
    style.id = EARLY_STYLE_ELEMENT_ID
    style.textContent = earlyStyle
    document.documentElement.appendChild(style)

    const snapshot = readSnapshot()
    if (snapshot) paint(snapshot, style)
  }
} catch {
  // storage blocked or a malformed snapshot: Gitako still mounts normally
}
