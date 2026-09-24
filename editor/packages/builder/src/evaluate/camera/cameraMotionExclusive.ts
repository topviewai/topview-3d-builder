import type { DirectorDocument } from '../../contract/types'

/** 该机位上是否已有运镜片段（运镜接管运动 → 禁止再改关键帧）。不改草稿结构，仅编辑层判定。 */
export function cameraMotionOwnsKeyframes(
  doc: DirectorDocument | null | undefined,
  nodeId: string,
): boolean {
  if (!doc) return false
  const node = doc.content.nodes.find((n) => n.id === nodeId)
  if (!node || node.type !== 'camera') return false
  return doc.content.timeline.animation.cameraMotionClips.some((c) => c.target.nodeId === nodeId)
}

/** 当前帧落在该机位某条运镜片段内（求值会用运镜覆盖位置）。 */
export function cameraMotionActiveAtFrame(
  doc: DirectorDocument | null | undefined,
  nodeId: string,
  frame: number,
): boolean {
  if (!doc) return false
  const node = doc.content.nodes.find((n) => n.id === nodeId)
  if (!node || node.type !== 'camera') return false
  return doc.content.timeline.animation.cameraMotionClips.some(
    (c) => c.target.nodeId === nodeId && frame >= c.frameStart && frame <= c.frameEnd,
  )
}

const CAMERA_POSITION_DRAG_EPS = 1e-4

/** 位置轴拖拽是否真的离开了起点。点一下轴、没有位移时不算回弹。 */
export function cameraPositionDragMoved(
  start: readonly number[] | null | undefined,
  end: readonly number[] | null | undefined,
): boolean {
  if (!start || !end || start.length < 3 || end.length < 3) return false
  const dx = start[0] - end[0]
  const dy = start[1] - end[1]
  const dz = start[2] - end[2]
  return dx * dx + dy * dy + dz * dz > CAMERA_POSITION_DRAG_EPS * CAMERA_POSITION_DRAG_EPS
}
