// 草稿常用查询（加载与资产寻址已外提到 HostAdapter）
import type {
  CameraMotionClip,
  DirectorDocument,
  DraftNode,
  MotionClip,
  PathMotionClip,
} from './types'

export function nodesOfType<T extends DraftNode['type']>(
  doc: DirectorDocument,
  type: T,
): DraftNode[] {
  return doc.content.nodes.filter((n) => n.type === type)
}

export function findMotionClipAt(
  doc: DirectorDocument,
  nodeId: string,
  frame: number,
): MotionClip | null {
  const clips = doc.content.timeline.animation.motionClips
  for (const c of clips) {
    if (c.target.nodeId === nodeId && frame >= c.frameStart && frame <= c.frameEnd) return c
  }
  return null
}

export function findCameraClipAt(
  doc: DirectorDocument,
  nodeId: string,
  frame: number,
): CameraMotionClip | null {
  const clips = doc.content.timeline.animation.cameraMotionClips
  for (const c of clips) {
    if (c.target.nodeId === nodeId && frame >= c.frameStart && frame <= c.frameEnd) return c
  }
  return null
}

export function findPathClipAt(
  doc: DirectorDocument,
  nodeId: string,
  frame: number,
): PathMotionClip | null {
  const clips = doc.content.timeline.animation.pathMotionClips
  for (const c of clips) {
    if (c.target.nodeId === nodeId && frame >= c.frameStart && frame <= c.frameEnd) return c
  }
  return null
}

export function findNode(doc: DirectorDocument, nodeId: string): DraftNode | null {
  return doc.content.nodes.find((n) => n.id === nodeId) ?? null
}
