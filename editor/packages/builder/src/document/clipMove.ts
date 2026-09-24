/** Pure drag layout. Coordinates are always relative to the pointer-down track. */
export interface ClipRange {
  id: string
  frameStart: number
  frameEnd: number
}

export interface ClipMoveLayout {
  positions: Record<string, { frameStart: number; frameEnd: number }>
  pointerFrame: number
  frameEnd: number
}

export function previewClipMove(
  clips: readonly ClipRange[],
  clipId: string,
  requestedFrame: number,
  minFrame: number,
  snapFrames: number,
): ClipMoveLayout | null {
  if (!Number.isFinite(requestedFrame)) return null
  const ordered = [...clips].sort((a, b) => a.frameStart - b.frameStart)
  const originIndex = ordered.findIndex((c) => c.id === clipId)
  if (originIndex < 0) return null
  const dragged = ordered[originIndex]
  const duration = dragged.frameEnd - dragged.frameStart
  const others = ordered.filter((c) => c.id !== clipId)
  const rawStart = Math.max(minFrame, Math.round(requestedFrame))
  const fits = (start: number) => start >= minFrame && others.every(
    (c) => start + duration <= c.frameStart || start >= c.frameEnd,
  )
  // Snap either edge to the nearest legal boundary, in screen-space tolerance.
  const snap = [minFrame, ...others.flatMap((c) => [c.frameEnd, c.frameStart - duration])]
    .filter((f) => Math.abs(f - rawStart) <= snapFrames && fits(f))
    .sort((a, b) => Math.abs(a - rawStart) - Math.abs(b - rawStart))[0]
  const pointerFrame = snap ?? rawStart
  const positions: ClipMoveLayout['positions'] = {}
  for (const c of ordered) positions[c.id] = { frameStart: c.frameStart, frameEnd: c.frameEnd }
  const result = (): ClipMoveLayout => ({
    positions,
    pointerFrame,
    frameEnd: Math.max(minFrame, ...Object.values(positions).map((c) => c.frameEnd)),
  })
  if (pointerFrame === dragged.frameStart) return result()
  // Deleting a clip only closes its suffix when it is surrounded by a
  // continuous run. A gap on either side is intentional and must remain
  // visible while the clip is being dragged.
  const previousOriginal = ordered[originIndex - 1]
  const next = ordered[originIndex + 1]
  const hasGapBefore = (previousOriginal?.frameEnd ?? minFrame) < dragged.frameStart
  const hasGapAfter = (next?.frameStart ?? dragged.frameEnd) > dragged.frameEnd
  if (!hasGapBefore && !hasGapAfter) {
    let sourceEnd = dragged.frameEnd
    for (let i = originIndex + 1; i < ordered.length; i++) {
      const c = ordered[i]
      if (c.frameStart !== sourceEnd) break
      positions[c.id] = { frameStart: c.frameStart - duration, frameEnd: c.frameEnd - duration }
      sourceEnd = c.frameEnd
    }
  }

  // Then insert using the leading edge. Hit areas come from pointer-down,
  // while slot coordinates come from the deleted layout. This keeps the
  // threshold stable when previewed neighbours shift out of the pointer.
  const leftward = pointerFrame < dragged.frameStart
  const edge = leftward ? pointerFrame : pointerFrame + duration
  // A rightward drag has three zones while it overlaps the next clip:
  // keep the pointer position and push the target (0..1/3), snap into the
  // target's current slot (1/3..1/2), then place after the target (>1/2).
  // The overlap is measured against the pointer-down hit area so deleting a
  // contiguous source does not move the threshold under the pointer.
  const hit = leftward
    ? others.find((c) => edge >= c.frameStart && edge <= c.frameEnd)
    : others.find((c) => pointerFrame < c.frameEnd && pointerFrame + duration > c.frameStart)
  let slot: number
  let anchor: number
  if (hit) {
    const hitIndex = others.indexOf(hit)
    if (!leftward) {
      const overlap = Math.max(0, Math.min(pointerFrame + duration, hit.frameEnd) - Math.max(pointerFrame, hit.frameStart))
      const overlapRatio = overlap / Math.max(1, hit.frameEnd - hit.frameStart)
      if (overlapRatio <= 1 / 3) {
        slot = hitIndex
        anchor = pointerFrame
      } else {
        const after = overlapRatio > 1 / 2
        slot = hitIndex + (after ? 1 : 0)
        anchor = after ? positions[hit.id].frameEnd : positions[hit.id].frameStart
      }
    } else {
      const midpoint = (hit.frameStart + hit.frameEnd) / 2
      const after = edge > midpoint
      slot = hitIndex + (after ? 1 : 0)
      anchor = after ? positions[hit.id].frameEnd : positions[hit.id].frameStart
    }
  } else {
    // No target under the leading edge: preserve the pointer's start in the
    // gap, with collision resolution below for the rest of the clip's body.
    slot = others.findIndex((c) => positions[c.id].frameStart >= pointerFrame)
    if (slot < 0) slot = others.length
    anchor = pointerFrame
  }
  const previousPlaced = slot > 0 ? positions[others[slot - 1].id] : null
  anchor = Math.max(minFrame, previousPlaced?.frameEnd ?? minFrame, anchor)
  positions[clipId] = { frameStart: anchor, frameEnd: anchor + duration }
  let cursor = anchor + duration
  for (let i = slot; i < others.length; i++) {
    const c = others[i]
    const start = Math.max(positions[c.id].frameStart, cursor)
    positions[c.id] = { frameStart: start, frameEnd: start + c.frameEnd - c.frameStart }
    cursor = positions[c.id].frameEnd
  }
  return result()
}
