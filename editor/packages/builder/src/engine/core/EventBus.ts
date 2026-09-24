export type EngineEventName =
  | 'frame'
  | 'frame:throttled'
  | 'node:snapshot'
  | 'camera:change'
  | 'loading'
  | 'error'

export interface EngineEventMap {
  frame: number
  'frame:throttled': number
  /** Paused evaluation (null = all nodes) or a live edit to one node. */
  'node:snapshot': string | null
  'camera:change': { x: number; y: number; z: number }
  loading: string
  error: string
}

type Handler<E extends EngineEventName> = (payload: EngineEventMap[E]) => void

export class EngineEvents {
  private readonly listeners = new Map<EngineEventName, Set<Handler<EngineEventName>>>()

  on<E extends EngineEventName>(event: E, fn: Handler<E>): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(fn as Handler<EngineEventName>)
    return () => {
      set!.delete(fn as Handler<EngineEventName>)
    }
  }

  emit<E extends EngineEventName>(event: E, payload: EngineEventMap[E]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const fn of set) (fn as Handler<E>)(payload)
  }

  clear(): void {
    this.listeners.clear()
  }

  listenerCount(event: EngineEventName): number {
    return this.listeners.get(event)?.size ?? 0
  }
}
