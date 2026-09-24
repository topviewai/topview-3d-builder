import type { DirectorApi } from '@topview/3d-builder'

type Listener = () => void

let api: DirectorApi | null = null
const listeners = new Set<Listener>()

export function setLiveStudio(next: DirectorApi | null): void {
  api = next
  listeners.forEach((fn) => fn())
}

export function getLiveStudio(): DirectorApi | null {
  return api
}

export function subscribeLiveStudio(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
