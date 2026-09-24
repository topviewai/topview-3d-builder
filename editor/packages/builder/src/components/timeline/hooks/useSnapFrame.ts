import { useCallback, useMemo } from 'react'
import { useDirector } from '../../../bridge/DirectorContext'
import { SNAP_TOLERANCE_PX } from '../constants'
import { collectSnapTargets, snapFrame, timelineSheetRuler } from '../utils'

export type SnapFrameFn = (
  frame: number,
  exclude?: { keyIds?: ReadonlySet<string>; clipId?: string; clipIds?: ReadonlySet<string> },
) => number

/**
 * 时间轴吸附：关掉开关时返回恒等函数，调用方不必再判分支。
 * pxPerFrame 传实际渲染比例（timelineScale 之后的），吸附半径才与屏幕一致。
 */
export function useSnapFrame(pxPerFrame: number): SnapFrameFn {
  const { useStore } = useDirector()
  const enabled = useStore((s) => s.timelineSnap)
  const doc = useStore((s) => s.doc)
  const userKeys = useStore((s) => s.userKeys)
  const fcurves = useStore((s) => s.fcurves)

  const targets = useMemo(
    () => (enabled ? collectSnapTargets(doc, userKeys, fcurves) : []),
    [enabled, doc, userKeys, fcurves],
  )
  const tl = doc?.content.timeline

  return useCallback(
    (frame, exclude) => {
      if (!enabled || !tl) return frame
      const px = pxPerFrame > 0 ? pxPerFrame : 1
      return snapFrame(frame, targets, SNAP_TOLERANCE_PX / px, {
        tickStep: timelineSheetRuler(px, tl.fps).step,
        tickOrigin: tl.frameStart,
        excludeKeyIds: exclude?.keyIds,
        excludeClipId: exclude?.clipId,
        excludeClipIds: exclude?.clipIds,
      })
    },
    [enabled, targets, pxPerFrame, tl],
  )
}
