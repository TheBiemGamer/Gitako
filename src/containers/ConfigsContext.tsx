import { PropsWithChildren } from 'common'
import React, { useCallback, useContext, useEffect, useState } from 'react'
import { Config, configHelper, configUpdatedEventType } from 'utils/config/helper'

type ContextShape = IO<Config, Partial<Config>>
export type ConfigsContextShape = ContextShape

export const ConfigsContext = React.createContext<ContextShape | null>(null)

export function ConfigsContextWrapper(props: PropsWithChildren) {
  const [configs, setConfigs] = useState<Config | null>(null)
  useEffect(() => {
    configHelper.get().then(setConfigs)
  }, [])
  // Pick up config written outside React (e.g. a refreshed OAuth token), so a
  // later onChange does not write the stale value back.
  useEffect(() => {
    const onExternalUpdate = (event: Event) => {
      const updated = (event as CustomEvent<Partial<Config>>).detail
      setConfigs(prev => (prev ? { ...prev, ...updated } : prev))
    }
    window.addEventListener(configUpdatedEventType, onExternalUpdate)
    return () => window.removeEventListener(configUpdatedEventType, onExternalUpdate)
  }, [])
  const onChange = useCallback((updatedConfigs: Partial<Config>) => {
    // Merge against the latest committed config via the functional updater,
    // not a closure-captured `configs`. A delayed writer (e.g. the debounced
    // toggleButtonVerticalDistance save in ToggleShowButton) can fire with an
    // onChange built from an earlier render; merging the whole config off that
    // stale snapshot would silently revert keys changed in between (this is
    // how persistent dock mode reverted to float across a reload).
    setConfigs(prev => {
      const mergedConfigs = { ...(prev as Config), ...updatedConfigs }
      configHelper.set(mergedConfigs)
      return mergedConfigs
    })
  }, [])
  if (configs === null) return null
  return (
    <ConfigsContext.Provider value={{ value: configs, onChange }}>
      {props.children}
    </ConfigsContext.Provider>
  )
}

export const useConfigs = createUseNonNullContext(ConfigsContext)

function createUseNonNullContext<T>(theContext: React.Context<T | null>): () => T {
  return () => {
    const context = useContext(theContext)
    if (context === null) throw new Error(`Empty context`)
    return context
  }
}
