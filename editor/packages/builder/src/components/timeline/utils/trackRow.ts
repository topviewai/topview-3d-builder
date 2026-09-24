import type { TrackProp, UserKeys } from '../../../evaluate/curves/KeyframeTrack'
import type { FCurveSet } from '../../../evaluate/curves/FCurveSet'
import { FC_PROP_PATH } from '../constants'

export function box(frameStart: number, pxPerFrame: number, start: number, end: number) {
  return {
    left: (start - frameStart) * pxPerFrame,
    width: Math.max(3, (end - start) * pxPerFrame),
  }
}

export function fcurveFrames(fcurves: FCurveSet | null, nodeId: string, prop: TrackProp): number[] {
  if (!fcurves) return []
  const propPath = FC_PROP_PATH[prop]
  const frames = new Set<number>()
  for (let i = 0; i < 3; i++) {
    for (const k of fcurves.keyframesForTrack(nodeId, propPath, i)) frames.add(k.frame)
  }
  return [...frames].sort((a, b) => a - b)
}

export function transformKeyframeFrames(
  userKeys: UserKeys,
  fcurves: FCurveSet | null,
  nodeId: string,
  props: TrackProp[],
): number[] {
  const frames = new Set<number>()
  for (const prop of props) {
    for (const k of userKeys[nodeId]?.[prop] ?? []) frames.add(k.frame)
    for (const f of fcurveFrames(fcurves, nodeId, prop)) frames.add(f)
  }
  return [...frames].sort((a, b) => a - b)
}

export function isAdditiveMod(e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.shiftKey || e.metaKey || e.ctrlKey
}
