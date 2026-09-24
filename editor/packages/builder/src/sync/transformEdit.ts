// 拖拽 / 数值编辑的变换落盘规则（自动关键帧关闭时）：
// - 该节点 userKeys 已有任意变换轨 → 调用方记 pending，不进本函数；
// - 当前帧（±0.5 帧容差）已有 userKeys 键 → 更新该键的值（编辑已有键，不是新建）；
// - 否则 → 写节点静态 transform（base）；
// - 官方 fcurves 层（烘焙/官方数据）永远不被这类编辑改写。
// 自动关键帧开启时由 StudioSession.recordAutoKeyframe 直接写 userKeys，
// 不进 pending、也不走本函数的静态写入。
import type { DirectorDocument, DraftNode } from '../contract/types'
import { sampleKeyframes, type TrackProp, type UserKeys } from '../evaluate/curves/KeyframeTrack'

export interface TransformEditPatch {
  position?: number[]
  rotation?: number[]
  scale?: number[]
  lookAt?: number[]
  fov?: number[]
}

export interface TransformEditResult {
  userKeys: UserKeys
  /** 更新了 position 轨道已有键 → 调用方需重建派生走位路径 */
  posKeyUpdated: boolean
  /** 任何层有实际变化（键值或静态 transform） */
  changed: boolean
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

const EPS = 1e-9
const VEC3_PROPS = ['position', 'rotation', 'scale', 'lookAt'] as const
export const USER_XFORM_PROPS = ['position', 'rotation', 'scale', 'lookAt', 'fov'] as const

export function nodeHasUserXformKeys(userKeys: UserKeys, nodeId: string): boolean {
  const tracks = userKeys[nodeId]
  if (!tracks) return false
  return USER_XFORM_PROPS.some((prop) => (tracks[prop]?.length ?? 0) > 0)
}

export function pendingFieldsFromPatch(patch: TransformEditPatch): {
  position?: number[]
  rotation?: number[]
  scale?: number[]
  lookAt?: number[]
  fov?: number[]
} {
  const fields: {
    position?: number[]
    rotation?: number[]
    scale?: number[]
    lookAt?: number[]
    fov?: number[]
  } = {}
  for (const prop of VEC3_PROPS) {
    const v = patch[prop]
    if (v && v.length >= 3) fields[prop] = [v[0], v[1], v[2]]
  }
  const fov = patch.fov?.[0]
  if (fov !== undefined && Number.isFinite(fov)) fields.fov = [fov]
  return fields
}

export function liveNodeTransformFromPatch(patch: TransformEditPatch): {
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
} {
  const live: { position?: Vec3; rotation?: Vec3; scale?: Vec3 } = {}
  if (patch.position && patch.position.length >= 3) {
    live.position = { x: patch.position[0], y: patch.position[1], z: patch.position[2] }
  }
  if (patch.rotation && patch.rotation.length >= 3) {
    live.rotation = { x: patch.rotation[0], y: patch.rotation[1], z: patch.rotation[2] }
  }
  if (patch.scale && patch.scale.length >= 3) {
    live.scale = { x: patch.scale[0], y: patch.scale[1], z: patch.scale[2] }
  }
  return live
}

/** pending / live 位姿写入引擎 staged，避免其它节点 touch 求值把网格刷回旧键。 */
export function stagedTransformFromPatch(patch: TransformEditPatch): {
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  lookAt?: Vec3
  fov?: number
} {
  const staged: {
    position?: Vec3
    rotation?: Vec3
    scale?: Vec3
    lookAt?: Vec3
    fov?: number
  } = liveNodeTransformFromPatch(patch)
  if (patch.lookAt && patch.lookAt.length >= 3) {
    staged.lookAt = { x: patch.lookAt[0], y: patch.lookAt[1], z: patch.lookAt[2] }
  }
  const fov = patch.fov?.[0]
  if (fov !== undefined && Number.isFinite(fov)) staged.fov = fov
  return staged
}

function vec3Changed(cur: { x: number; y: number; z: number }, v: number[]): boolean {
  return Math.abs(cur.x - v[0]) > EPS || Math.abs(cur.y - v[1]) > EPS || Math.abs(cur.z - v[2]) > EPS
}

function valuesClose(a: number[], b: number[]): boolean {
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > EPS) return false
  }
  return true
}

/**
 * 自动关键帧的比较基准：当前帧文档里已经生效的值。
 * 不用引擎 live 快照——gizmo 拖拽会先灌 live，再用快照会误判「没变」。
 */
export function documentTransformBaseline(
  node: DraftNode | undefined,
  userKeys: UserKeys,
  frame: number,
  patch: TransformEditPatch,
): Partial<TransformEditPatch> {
  const tracks = node ? userKeys[node.id] : undefined
  const fromTrack = (prop: TrackProp): number[] | undefined => {
    const sampled = tracks?.[prop] ? sampleKeyframes(tracks[prop]!, frame) : null
    return sampled ?? undefined
  }
  const baseline: Partial<TransformEditPatch> = {}
  if (patch.position) {
    baseline.position =
      fromTrack('position')
      ?? (node ? [node.transform.position.x, node.transform.position.y, node.transform.position.z] : undefined)
  }
  if (patch.rotation) {
    baseline.rotation =
      fromTrack('rotation')
      ?? (node ? [node.transform.rotation.x, node.transform.rotation.y, node.transform.rotation.z] : undefined)
  }
  if (patch.scale) {
    baseline.scale =
      fromTrack('scale')
      ?? (node ? [node.transform.scale.x, node.transform.scale.y, node.transform.scale.z] : undefined)
  }
  if (patch.lookAt) {
    baseline.lookAt =
      fromTrack('lookAt')
      ?? (node?.camera ? [node.camera.lookAt.x, node.camera.lookAt.y, node.camera.lookAt.z] : undefined)
  }
  if (patch.fov) {
    baseline.fov = fromTrack('fov') ?? (node?.camera ? [node.camera.fov] : undefined)
  }
  return baseline
}

/**
 * 「一次给这个节点打全套变换关键帧」要写的通道与文档里的当前值。
 * 相机没有缩放，改写 lookAt / fov；其余节点写 position / rotation / scale。
 * 引擎 live 快照的替换由 StudioSession 在写入时叠加，这里只给静态兜底值。
 */
export function transformKeyframeWrites(node: DraftNode): { prop: TrackProp; value: number[] }[] {
  const xf = node.transform
  const writes: { prop: TrackProp; value: number[] }[] = [
    { prop: 'position', value: [xf.position.x, xf.position.y, xf.position.z] },
    { prop: 'rotation', value: [xf.rotation.x, xf.rotation.y, xf.rotation.z] },
  ]
  if (node.type === 'camera' && node.camera) {
    writes.push({ prop: 'lookAt', value: [node.camera.lookAt.x, node.camera.lookAt.y, node.camera.lookAt.z] })
    writes.push({ prop: 'fov', value: [node.camera.fov] })
  } else {
    writes.push({ prop: 'scale', value: [xf.scale.x, xf.scale.y, xf.scale.z] })
  }
  return writes
}

/** 自动关键帧：只收相对当前值真的变了的通道。 */
export function changedKeyframeWrites(
  patch: TransformEditPatch,
  baseline: Partial<Record<keyof TransformEditPatch, number[]>>,
): { prop: TrackProp; value: number[] }[] {
  const writes: { prop: TrackProp; value: number[] }[] = []
  for (const prop of USER_XFORM_PROPS) {
    const next = patch[prop]
    if (!next || next.length === 0) continue
    const prev = baseline[prop]
    if (prev && valuesClose(prev, next)) continue
    writes.push({ prop, value: [...next] })
  }
  return writes
}

export function applyTransformEdit(
  doc: DirectorDocument,
  userKeys: UserKeys,
  nodeId: string,
  frame: number,
  patch: TransformEditPatch,
): TransformEditResult {
  const node = doc.content.nodes.find((n) => n.id === nodeId)
  if (!node) return { userKeys, posKeyUpdated: false, changed: false }
  let next = userKeys
  let posKeyUpdated = false
  let changed = false

  const updateExisting = (prop: keyof TransformEditPatch, value: number[]): boolean => {
    const track = next[nodeId]?.[prop]
    const hit = track?.find((k) => Math.abs(k.frame - frame) <= 0.5)
    if (!track || !hit) return false
    next = {
      ...next,
      [nodeId]: {
        ...next[nodeId],
        [prop]: track.map((k) => (k.id === hit.id ? { ...k, value: [...value] } : k)),
      },
    }
    changed = true
    if (prop === 'position') posKeyUpdated = true
    return true
  }

  for (const prop of VEC3_PROPS) {
    const v = patch[prop]
    if (!v || v.length < 3) continue
    if (updateExisting(prop, [v[0], v[1], v[2]])) continue
    if (prop === 'lookAt') {
      if (!node.camera) continue
      if (vec3Changed(node.camera.lookAt, v)) {
        node.camera.lookAt = { x: v[0], y: v[1], z: v[2] }
        changed = true
      }
      continue
    }
    const cur = node.transform[prop]
    if (vec3Changed(cur, v)) {
      node.transform[prop] = { x: v[0], y: v[1], z: v[2] }
      changed = true
    }
  }

  const fov = patch.fov?.[0]
  if (fov !== undefined && Number.isFinite(fov)) {
    if (!updateExisting('fov', [fov]) && node.camera && Math.abs(node.camera.fov - fov) > EPS) {
      node.camera.fov = fov
      changed = true
    }
  }
  return { userKeys: next, posKeyUpdated, changed }
}

export interface SeatOnSupportInput {
  moverPos: Vec3
  /** 移动节点当前接触点（人物脚底中点，或网格底面中心） */
  moverContact: Vec3
  /** 承托网格顶面落点（射线命中，而不是包围盒顶） */
  supportRest: Vec3
}

/** 把移动节点的接触点平移到承托网格落点。 */
export function seatOnSupport(input: SeatOnSupportInput): Vec3 {
  return {
    x: input.moverPos.x + (input.supportRest.x - input.moverContact.x),
    y: input.moverPos.y + (input.supportRest.y - input.moverContact.y),
    z: input.moverPos.z + (input.supportRest.z - input.moverContact.z),
  }
}

/** 丢掉明显低于承托物身高的命中（人物脚面、地面残片）。 */
export function highSupportHits(hits: ReadonlyArray<Vec3>, minY: number): Vec3[] {
  return hits.filter((hit) => hit.y >= minY)
}

/**
 * 从一簇向下射线命中里取「最高一层」的质心。
 * 空命中回退 fallback（通常是包围盒顶心）。
 */
export function pickTopSurfaceRest(
  hits: ReadonlyArray<Vec3>,
  fallback: Vec3,
  height: number,
): Vec3 {
  if (hits.length === 0) return fallback
  let topY = -Infinity
  for (const hit of hits) {
    if (hit.y > topY) topY = hit.y
  }
  const band = Math.max(0.008, Math.abs(height) * 0.02)
  let sx = 0
  let sy = 0
  let sz = 0
  let n = 0
  for (const hit of hits) {
    if (hit.y < topY - band) continue
    sx += hit.x
    sy += hit.y
    sz += hit.z
    n += 1
  }
  return { x: sx / n, y: sy / n, z: sz / n }
}
