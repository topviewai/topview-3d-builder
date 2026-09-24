import { autorun } from 'mobx'
import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { StudioSession } from '../sync/StudioSession'
import type { DirectorStore, StudioView } from '../stores/types'

export function createStoreHook(session: StudioSession): DirectorStore {
  function useStore<T>(selector?: (s: StudioView) => T): T | StudioView {
    const selectorRef = useRef(selector)
    selectorRef.current = selector
    const cacheRef = useRef<T | StudioView>(selector ? selector(session) : session)

    const subscribe = useCallback((onStoreChange: () => void) => {
      return autorun(() => {
        const sel = selectorRef.current
        const next = sel ? sel(session) : session
        if (!Object.is(cacheRef.current, next)) {
          cacheRef.current = next
          onStoreChange()
        }
      })
    }, [])

    const getSnapshot = () => {
      const sel = selectorRef.current
      const next = sel ? sel(session) : session
      if (!Object.is(cacheRef.current, next)) cacheRef.current = next
      return cacheRef.current
    }

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  }

  useStore.getState = () => session
  return useStore as DirectorStore
}
