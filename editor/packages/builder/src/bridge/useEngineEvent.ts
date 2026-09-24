import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { EngineEventMap, EngineEventName } from '../engine/core/EventBus'
import { useDirector } from './DirectorContext'

/** Live edits can change a snapshot without advancing the timeline frame. */
export function useNodeSnapshot(nodeId: string | null | undefined) {
  const { stage } = useDirector()
  const subscribe = useCallback((onChange: () => void) => {
    const stopLive = stage.on('node:snapshot', (changedId) => {
      if (changedId === null || changedId === nodeId) onChange()
    })
    const stopPlayback = stage.on('frame:throttled', onChange)
    return () => { stopLive(); stopPlayback() }
  }, [stage, nodeId])
  const getSnapshot = useCallback(() => nodeId ? stage.getNodeSnapshot(nodeId) : null, [stage, nodeId])
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}

export function useEngineEvent<E extends EngineEventName>(
  event: E,
  handler: (payload: EngineEventMap[E]) => void,
): void {
  const { stage } = useDirector()
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    return stage.on(event, (payload) => {
      handlerRef.current(payload)
    })
  }, [event, stage])
}

/** 节流通道：约 100ms 一拍，给 React 面板用。 */
export function useThrottledFrame(): number {
  const { stage } = useDirector()
  return useSyncExternalStore(
    (onChange) => stage.on('frame:throttled', onChange),
    () => stage.currentFrame,
    () => stage.currentFrame,
  )
}
