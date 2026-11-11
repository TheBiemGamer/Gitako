import { platformName } from 'platforms'
import { useEffect } from 'react'
import { VisibleNodesGenerator } from 'utils/VisibleNodesGenerator'

// Gitea/Forgejo navigate with full page loads, which would reset the tree.
// Remember the expanded folders per repo+branch for the browser tab.
const enabled = platformName === 'Gitea'

function storageKey({ userName, repoName, branchName }: MetaData) {
  return `gitako-expanded:${userName}/${repoName}@${branchName}`
}

function read(key: string): string[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

function write(key: string, paths: string[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(paths))
  } catch {
    // storage full or blocked: not worth surfacing
  }
}

export function usePersistExpandedFolders(
  visibleNodesGenerator: VisibleNodesGenerator | null,
  metaData: MetaData | null,
) {
  useEffect(() => {
    if (!enabled || !visibleNodesGenerator || !metaData) return
    const key = storageKey(metaData)
    const vng = visibleNodesGenerator

    let restoring = true
    const restore = async () => {
      try {
        // Re-apply the saved set as-is (not via expandTo, which would also open
        // ancestors the user had collapsed). The Gitea tree is fully loaded up
        // front, so no folder contents need fetching here.
        for (const path of read(key)) vng.expandedNodes.add(path)
        await vng.generateVisibleNodes()
      } finally {
        restoring = false
      }
    }
    restore()

    const unsubscribe = vng.onUpdate(({ expandedNodes }) => {
      // search rewrites expandedNodes with matches; do not persist those
      if (restoring || vng.isSearching) return
      write(key, [...expandedNodes])
    })
    return unsubscribe
  }, [visibleNodesGenerator, metaData])
}
