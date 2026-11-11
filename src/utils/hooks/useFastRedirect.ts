import { useConfigs } from 'containers/ConfigsContext'
import { platform, platformName } from 'platforms'
import { useCallback, useEffect, useRef } from 'react'
import { useEvent, useInterval } from 'react-use'
import { run } from 'utils/general'

const config: import('pjax-api').Config = {
  areas: [
    // github
    '.repository-content',
    // gitee
    '#git-project-content',
    // gitea
    '.repository > .ui.container',
  ],
  update: {
    css: false,
  },
  fetch: {},
  link: 'a:not(a)', // this helps fixing the go-back-in-history issue
  form: 'form:not(form)', // prevent blocking form submissions
  fallback(/* target, reason */) {
    // prevent unexpected reload
  },
}

export function usePJAXAPI() {
  const { pjaxMode } = useConfigs().value
  // make history travel work
  useEffect(() => {
    // Gitea navigates with full loads; ignore a pjax-api value saved by older builds
    if (pjaxMode === 'pjax-api' && platformName !== 'Gitea') {
      run(async () => {
        const { Pjax } = await import('pjax-api')
        new Pjax({
          ...config,
          filter() {
            return false
          },
        })
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // bindings for legacy support
  useRedirectedEvents(window, 'pjax:fetch', 'pjax:start', document)
  useRedirectedEvents(document, 'pjax:ready', 'pjax:end')
}

export const loadWithFastRedirect = (url: string, element: HTMLElement) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-expressions
  platform.loadWithFastRedirect?.(url, element) || require('pjax-api').Pjax.assign(url, config)
}

export function useAfterRedirect(callback: () => void) {
  const latestHref = useRef(location.href)
  const raceCallback = useCallback(() => {
    const { href } = location
    if (latestHref.current !== href) {
      latestHref.current = href
      callback()
    }
  }, [callback])
  // URL-gated polling catches navigations that don't emit a recognised event.
  useInterval(raceCallback, 500)
  // Turbo updates location.href at turbo:visit, ~1s before the new DOM
  // lands. A URL-gated callback latches on that early URL change (often
  // via an interval tick with still-stale DOM) and then never re-fires
  // once the new DOM is in place. Fire unconditionally on the post-swap
  // settled signal so consumers always react against the new DOM.
  //
  // Why turbo:load rather than turbo:render: turbo:render fires once per
  // render — including the cached-then-network "morphing" path where it
  // can fire twice in a single visit. turbo:load fires once when the
  // visit settles (and also on initial page load). Single-fire is what
  // our idempotent consumers want; the ~1ms timing penalty is invisible.
  useEvent('pjax:end', callback, document) // legacy support
  useEvent('turbo:load', callback, document)
}

export function useRedirectedEvents(
  originalTarget: Window | Document | Element,
  originalEvent: string,
  redirectedEvent: string,
  redirectToTarget = originalTarget,
) {
  useEvent(
    originalEvent,
    () => {
      redirectToTarget.dispatchEvent(new Event(redirectedEvent))
    },
    originalTarget,
  )
}
