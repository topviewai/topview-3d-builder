// 派生走位路径：拖拽/动作锚点提交官方 position 关键帧后，
// 对该节点全量重推导派生路径 —— 先删除旧的 derived 片段（连同其 path 节点），
// 再对 position 曲线的每个相邻关键帧对 (F1,F2)（三维位移 > 1e-4 m）生成：
//   - 一个不可见/锁定的 path 节点（逐帧 smoothstep 采样的 polyline）
//   - 一个 locked 的 pathMotionClip（facing=path-tangent，
//     lockedReason=derived-from-keyframes，derivedSource 记录来源曲线/键）
import type { DirectorDocument, DraftNode, PathMotionClip } from '../../contract/types'
import type { FCurveSet } from '../curves/FCurveSet'
import type { UserKeys } from '../curves/KeyframeTrack'

const rand6 = (): string => Math.random().toString(36).slice(2, 8)
const DISPLACEMENT_EPS = 1e-4
export const DERIVED_REASON = 'derived-from-keyframes'
const smoothstep = (t: number): number => t * t * (3 - 2 * t)

/** 位移关键帧自动生成的走位 clip：时间轴不展示，也不应挡住用户轨迹的拖动/拉伸。 */
export function isDerivedPathClip(clip: { lockedReason?: string } | null | undefined): boolean {
  return clip?.lockedReason === DERIVED_REASON
}

export function timelinePathClips<T extends { target: { nodeId: string }; lockedReason?: string }>(
  clips: readonly T[],
  nodeId: string,
): T[] {
  return clips.filter((c) => c.target.nodeId === nodeId && !isDerivedPathClip(c))
}

/** 位移关键帧自动生成的走位路径：视口可见，但不能当独立对象选中。 */
export function isDerivedTransformPath(node: DraftNode | null | undefined): boolean {
  if (!node || node.type !== 'path') return false
  if (node.path?.source === 'transform-keyframes') return true
  return node.metadata?.sourceType === 'transform-keyframes'
}

export function rederiveWalkPaths(
  doc: DirectorDocument,
  nodeId: string,
  fcurves: FCurveSet,
  userKeys?: UserKeys,
): void {
  const anim = doc.content.timeline.animation

  const oldPathIds = new Set(
    anim.pathMotionClips
      .filter((c) => c.target?.nodeId === nodeId && c.lockedReason === DERIVED_REASON)
      .map((c) => c.pathNodeId),
  )
  if (oldPathIds.size > 0) {
    anim.pathMotionClips = anim.pathMotionClips.filter(
      (c) => !(c.target?.nodeId === nodeId && c.lockedReason === DERIVED_REASON),
    )
    doc.content.nodes = doc.content.nodes.filter(
      (n) => !(n.type === 'path' && oldPathIds.has(n.id)),
    )
  }

  // 有效位移键：用户关键帧层（userKeys）优先——求值时它也最后覆写；
  // 没有用户键时回退官方 fcurves（烘焙走位曲线）。
  const ukTrack = userKeys?.[nodeId]?.position
  const keys: { frame: number; value: [number, number, number]; keyIds: [string, string, string] }[] =
    ukTrack?.length
      ? ukTrack
          .map((k) => ({
            frame: k.frame,
            value: [k.value[0] ?? 0, k.value[1] ?? 0, k.value[2] ?? 0] as [number, number, number],
            keyIds: [k.id, k.id, k.id] as [string, string, string],
          }))
          .sort((a, b) => a.frame - b.frame)
      : fcurves.positionKeys(nodeId)
  const curveIds = [0, 1, 2].map((i) => fcurves.curveId(nodeId, 'transform.position', i) ?? '')
  for (let i = 0; i + 1 < keys.length; i++) {
    const A = keys[i]
    const B = keys[i + 1]
    const dx = B.value[0] - A.value[0]
    const dy = B.value[1] - A.value[1]
    const dz = B.value[2] - A.value[2]
    if (Math.hypot(dx, dy, dz) <= DISPLACEMENT_EPS) continue
    const F1 = A.frame
    const F2 = B.frame
    const span = F2 - F1
    if (span <= 0) continue
    const steps = Math.max(1, Math.round(span))
    const signature = rand6()

    const points: { id: string; position: { x: number; y: number; z: number }; timeRatio: number }[] = []
    let pathLength = 0
    let prev: [number, number, number] | null = null
    for (let j = 0; j <= steps; j++) {
      const t = j / steps
      const s = smoothstep(t)
      const p: [number, number, number] = [
        A.value[0] + dx * s,
        A.value[1] + dy * s,
        A.value[2] + dz * s,
      ]
      if (prev) pathLength += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])
      prev = p
      points.push({
        id: `path_point_${rand6()}`,
        position: { x: p[0], y: p[1], z: p[2] },
        timeRatio: t,
      })
    }

    const pathNodeId = `path_derived_${rand6()}`
    const pathNode: DraftNode = {
      id: pathNodeId,
      name: 'Transform keyframes',
      visible: false,
      locked: true,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      metadata: {
        derivedPathMotionSourceSignature: signature,
        sourceType: 'transform-keyframes',
      },
      type: 'path',
      path: {
        source: 'transform-keyframes',
        parameterization: 'time-ratio',
        curve: 'polyline',
        closed: false,
        groundSnap: false,
        smoothing: 0,
        points,
      },
    }
    doc.content.nodes.push(pathNode)

    const clip: PathMotionClip = {
      id: `path_motion_clip_derived_${rand6()}`,
      target: { type: 'node', nodeId },
      pathNodeId,
      pathName: 'Transform keyframes',
      frameStart: F1,
      frameEnd: F2,
      pathStartPercent: 0,
      pathEndPercent: 100,
      direction: 'forward',
      facing: 'path-tangent',
      playback: {
        version: 1,
        speed: 1,
        loop: false,
        loopMode: 'ping-pong',
        baseDurationFrames: span,
      },
      pathLength,
      status: 'active',
      source: 'transform-keyframes',
      locked: true,
      lockedReason: DERIVED_REASON,
      derivedSource: {
        curveIds,
        keyframeIds: [...A.keyIds, ...B.keyIds],
        keyframeFrames: [F1, F2],
        sourceSignature: signature,
      },
    }
    anim.pathMotionClips.push(clip)
  }
}
