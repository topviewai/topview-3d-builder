import { useSyncExternalStore } from 'react'
import { useDirector } from '../../../bridge/DirectorContext'
import type { FilmPlaybackSnapshot } from '../../../stores/types'

export function useFilmPlayback(): FilmPlaybackSnapshot {
  const { session } = useDirector()
  return useSyncExternalStore(
    (onStoreChange) => session.playback.subscribe(onStoreChange),
    () => session.playback.getSnapshot(),
    () => session.playback.getSnapshot(),
  )
}
