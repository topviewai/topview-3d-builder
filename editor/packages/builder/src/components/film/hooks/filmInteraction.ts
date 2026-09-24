import { useRef, useSyncExternalStore } from 'react'

/**
 * 成片面板「拖拽进行中」信号。
 * 缩略图是离屏渲染：入出点每变一帧就要重新采样一批新帧，拖拽过程中格子会不停闪空，
 * 还会和实时程序预览抢 GPU。拖拽期间冻结取数，松手后按最终值刷新一次。
 */
let depth = 0
const listeners = new Set<() => void>()

function isInteracting(): boolean {
  return depth > 0
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function notify(): void {
  for (const fn of listeners) fn()
}

/** 拖拽开始时调用，返回结束回调；结束回调重复调用只生效一次。 */
export function beginFilmInteraction(): () => void {
  depth += 1
  if (depth === 1) notify()
  let ended = false
  return () => {
    if (ended) return
    ended = true
    depth -= 1
    if (depth === 0) notify()
  }
}

/** 拖拽期间保持拖拽前的值，松手后立刻跟上最新值。 */
export function useHeldWhileInteracting<T>(value: T): T {
  const interacting = useSyncExternalStore(subscribe, isInteracting, isInteracting)
  const held = useRef(value)
  if (!interacting) held.current = value
  return held.current
}
