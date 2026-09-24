/** Pure NLE-style ripple helpers for same-track clip duration/resize. */

export interface ClipRange {
  id: string
  frameStart: number
  frameEnd: number
}

export type ClipFramePos = { frameStart: number; frameEnd: number }

/**
 * Shift every clip strictly after `pivotId` (sorted by frameStart) by `delta`.
 * Preserves relative gaps among the shifted suffix. Does not modify the pivot.
 */
export function rippleShiftClipsAfter(
  clips: readonly ClipRange[],
  pivotId: string,
  delta: number,
): Record<string, ClipFramePos> {
  if (!Number.isFinite(delta) || delta === 0) return {}
  const ordered = [...clips].sort((a, b) => a.frameStart - b.frameStart || a.frameEnd - b.frameEnd)
  const idx = ordered.findIndex((c) => c.id === pivotId)
  if (idx < 0) return {}
  const out: Record<string, ClipFramePos> = {}
  for (let i = idx + 1; i < ordered.length; i += 1) {
    const c = ordered[i]
    out[c.id] = { frameStart: c.frameStart + delta, frameEnd: c.frameEnd + delta }
  }
  return out
}

/**
 * Shift every clip strictly before `pivotId` by `delta`.
 * Clamps so the leftmost clip never goes below `minFrame`; returns the applied delta.
 */
export function rippleShiftClipsBefore(
  clips: readonly ClipRange[],
  pivotId: string,
  delta: number,
  minFrame: number,
): { shifts: Record<string, ClipFramePos>; appliedDelta: number } {
  if (!Number.isFinite(delta) || delta === 0) return { shifts: {}, appliedDelta: 0 }
  const ordered = [...clips].sort((a, b) => a.frameStart - b.frameStart || a.frameEnd - b.frameEnd)
  const idx = ordered.findIndex((c) => c.id === pivotId)
  if (idx < 0) return { shifts: {}, appliedDelta: 0 }
  // No predecessors: pivot itself may still move; caller owns minFrame clamp on pivot.
  if (idx === 0) return { shifts: {}, appliedDelta: delta }
  let applied = delta
  if (applied < 0) {
    const leftmost = ordered[0]
    const minDelta = minFrame - leftmost.frameStart
    if (applied < minDelta) applied = minDelta
  }
  if (applied === 0) return { shifts: {}, appliedDelta: 0 }
  const shifts: Record<string, ClipFramePos> = {}
  for (let i = 0; i < idx; i += 1) {
    const c = ordered[i]
    shifts[c.id] = { frameStart: c.frameStart + applied, frameEnd: c.frameEnd + applied }
  }
  return { shifts, appliedDelta: applied }
}

export interface ClipRippleResizeResult {
  /** Includes the resized clip and any rippled neighbours. */
  positions: Record<string, ClipFramePos>
  frameStart: number
  frameEnd: number
  /** Max frameEnd across the track after ripple (for timeline extent). */
  trackFrameEnd: number
}

/**
 * Ripple-resize one clip on a track.
 * - edge `end`: left edge anchored; subsequent clips translate by delta (gap preserved).
 * - edge `start`: right edge anchored; preceding clips translate by delta (gap preserved).
 * Never overlaps: neighbours move as a rigid block. Min duration is 1 frame.
 * `maxFrame` 存在时，拉长不能把轨道最右端推过这个上限（运镜不得撑大时间线）。
 */
export function rippleResizeClip(
  clips: readonly ClipRange[],
  clipId: string,
  edge: 'start' | 'end',
  edgeFrame: number,
  minFrame: number,
  maxFrame?: number,
): ClipRippleResizeResult | null {
  if (!Number.isFinite(edgeFrame)) return null
  const ordered = [...clips].sort((a, b) => a.frameStart - b.frameStart || a.frameEnd - b.frameEnd)
  const old = ordered.find((c) => c.id === clipId)
  if (!old) return null
  const target = Math.round(edgeFrame)

  const positions: Record<string, ClipFramePos> = {}
  for (const c of ordered) {
    positions[c.id] = { frameStart: c.frameStart, frameEnd: c.frameEnd }
  }

  if (edge === 'end') {
    const frameStart = old.frameStart
    let frameEnd = Math.max(frameStart + 1, target)
    if (maxFrame != null) {
      const trackEnd = Math.max(...ordered.map((c) => c.frameEnd))
      const maxDelta = maxFrame - trackEnd
      const desiredDelta = frameEnd - old.frameEnd
      if (desiredDelta > maxDelta) frameEnd = old.frameEnd + Math.max(0, maxDelta)
      frameEnd = Math.min(frameEnd, maxFrame)
      frameEnd = Math.max(frameStart + 1, frameEnd)
    }
    const delta = frameEnd - old.frameEnd
    positions[clipId] = { frameStart, frameEnd }
    if (delta !== 0) {
      const shifts = rippleShiftClipsAfter(ordered, clipId, delta)
      for (const [id, pos] of Object.entries(shifts)) positions[id] = pos
    }
    const trackFrameEnd = Math.max(...Object.values(positions).map((p) => p.frameEnd), frameEnd)
    return { positions, frameStart, frameEnd, trackFrameEnd }
  }

  // edge === 'start'
  const desiredStart = Math.min(old.frameEnd - 1, Math.max(minFrame, target))
  const desiredDelta = desiredStart - old.frameStart
  const { shifts, appliedDelta } = rippleShiftClipsBefore(ordered, clipId, desiredDelta, minFrame)
  const frameStart = old.frameStart + appliedDelta
  const frameEnd = old.frameEnd
  positions[clipId] = { frameStart, frameEnd }
  for (const [id, pos] of Object.entries(shifts)) positions[id] = pos
  const trackFrameEnd = Math.max(...Object.values(positions).map((p) => p.frameEnd), frameEnd)
  return { positions, frameStart, frameEnd, trackFrameEnd }
}
