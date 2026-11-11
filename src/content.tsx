import { Gitako } from 'components/Gitako'
import { IN_PRODUCTION_MODE } from 'env'
import { handleOAuthCallback } from 'platforms/Gitea/OAuth'
import React, { useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { insertMountPoint, insertSideBarMountPoint } from 'utils/DOMHelper'
import { useAfterRedirect } from 'utils/hooks/useFastRedirect'
import { waitForNext } from 'utils/waitForNextEvent'
import './content.scss'

const renderReact = () => {
  const mountPoint = insertSideBarMountPoint()
  const MountPointWatcher = () => {
    // Turbo replaces <body> outright on cross-page navigation; the
    // gitako-root element (and the mountPoint inside it) get detached
    // with the old body. `insertMountPoint` returns a cached reference
    // and re-attaches it to the current body when orphaned, so calling
    // it on every redirect is sufficient to keep the whole subtree
    // — sidebar mount point, logo mount point, and styled-components'
    // <style> tags — anchored under the live document.
    useAfterRedirect(useCallback(() => void insertMountPoint(), []))
    return null
  }
  const root = createRoot(mountPoint)
  root.render(
    <>
      <MountPointWatcher />
      <Gitako />
    </>,
  )

  return () => {
    root.unmount()
  }
}

// injects a copy of stylesheets so that other extensions(e.g. dark reader) could read
// resolves when style is loaded to prevent render without proper styles
const injectStyles = (url: string) =>
  new Promise<() => void>(resolve => {
    const linkElement = document.createElement('link')
    linkElement.setAttribute('rel', 'stylesheet')
    linkElement.setAttribute('href', url)
    const unload = () => {
      linkElement.remove()
    }
    linkElement.onload = () => resolve(unload)
    document.head.appendChild(linkElement)
  })

const GitakoExclusiveEventType = 'GITAKO_EXCLUSIVE_EVENT'
const GitakoMountedEventType = 'GITAKO_MOUNTED_EVENT'

Promise.resolve()
  .then(() =>
    document.readyState === 'loading' ? waitForNext.documentEvent('DOMContentLoaded') : null,
  )
  // Finish a Forgejo/Gitea OAuth sign-in started by Gitako. When it succeeds
  // the page navigates back to where the user started, so skip mounting.
  .then(() => handleOAuthCallback().catch(() => false))
  .then(navigatingAway => {
    if (navigatingAway) return new Promise<never>(() => {})
  })
  .then(() =>
    Promise.all([injectStyles(browser.runtime.getURL('content.css')), renderReact()]).then(
      ([unmountStyles, unmountReact]) =>
        () =>
          Promise.all([unmountStyles(), unmountReact()]),
    ),
  )
  .then(unmount => {
    document.dispatchEvent(new CustomEvent(GitakoMountedEventType))
    if (IN_PRODUCTION_MODE) {
      waitForNext.documentEvent(GitakoExclusiveEventType).then(unmount)
    } else {
      waitForNext
        .documentEvent(GitakoMountedEventType)
        .then(() => document.dispatchEvent(new CustomEvent(GitakoExclusiveEventType)))
    }
  })
