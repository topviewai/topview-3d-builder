import type {
  BakedCurve,
  CameraMotionClip,
  DirectorDocument,
  DraftNode,
  MotionClip,
  PathMotionClip,
  Transform,
  Vec3,
} from '../contract/types'
import { cloneJson } from '../document'
import { uniqueNodeName } from '../evaluate/studioIntents'
import { isDerivedPathClip, isDerivedTransformPath } from '../evaluate/path/deriveWalk'
import type { Keyframe, TrackProp, UserKeys } from '../evaluate/curves/KeyframeTrack'

export type TransformDelta = {
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

export type DuplicateNodesInput = {
  document: DirectorDocument
  userKeys: UserKeys
  selectedIds: readonly string[]
  delta?: TransformDelta
  perNodeDeltas?: Record<string, TransformDelta>
}

export type FCurveCopyPlan = {
  fromId: string
  toId: string
}

export type DuplicateNodesResult = {
  document: DirectorDocument
  userKeys: UserKeys
  idMap: Map<string, string>
  newNodeIds: string[]
  topLevelNewIds: string[]
  rederiveIds: string[]
  fcurveCopies: FCurveCopyPlan[]
}

const ZERO: TransformDelta = {}

export function duplicateNodes(input: DuplicateNodesInput): DuplicateNodesResult {
  const document = cloneJson(input.document)
  const userKeys = cloneJson(input.userKeys)
  const empty: DuplicateNodesResult = {
    document,
    userKeys,
    idMap: new Map(),
    newNodeIds: [],
    topLevelNewIds: [],
    rederiveIds: [],
    fcurveCopies: [],
  }
  const sourceIds = expandDuplicateIds(document, input.selectedIds)
  if (sourceIds.length === 0) return empty

  const stamp = Date.now().toString(36)
  const idMap = new Map<string, string>()
  sourceIds.forEach((id, index) => {
    idMap.set(id, `${id}_copy_${stamp}_${index}`)
  })

  const byId = new Map(document.content.nodes.map((node) => [node.id, node]))
  const clones: DraftNode[] = []
  const nextUserKeys: UserKeys = { ...userKeys }
  const fcurveCopies: FCurveCopyPlan[] = []
  const rederiveIds: string[] = []

  for (const sourceId of sourceIds) {
    const source = byId.get(sourceId)
    if (!source) continue
    const destId = idMap.get(sourceId)!
    const nodeDelta = resolveNodeDelta(sourceId, byId, input.delta ?? ZERO, input.perNodeDeltas)
    const clone = cloneJson(source)
    clone.id = destId
    clone.name = uniqueNodeName(document, `${source.name} copy`)
    remapNodeRefs(clone, idMap)
    applyNodeDelta(clone, nodeDelta)
    if (clone.type === 'camera' && clone.camera) clone.camera.isPrimary = false
    document.content.nodes.push(clone)
    clones.push(clone)

    const sourceKeys = userKeys[sourceId]
    if (sourceKeys) {
      nextUserKeys[destId] = copyUserKeys(sourceKeys, nodeDelta, Boolean(clone.camera?.lookAtTarget))
    }
    fcurveCopies.push({ fromId: sourceId, toId: destId })
    // 与 rederiveForUserKeysDiff 同规则：派生走位不挑节点类型，primitive / prop 只要
    // 有位移键同样会长出轨迹。无键的节点 rederiveWalkPaths 会自行空转。
    rederiveIds.push(destId)
  }

  appendClonesToExternalParents(document, sourceIds, idMap, byId)
  copyClips(document, idMap, input.delta ?? ZERO, input.perNodeDeltas, byId)

  return {
    document,
    userKeys: nextUserKeys,
    idMap,
    newNodeIds: clones.map((node) => node.id),
    topLevelNewIds: clones
      .filter((node) => !node.parentId || !clones.some((other) => other.id === node.parentId))
      .map((node) => node.id),
    rederiveIds,
    fcurveCopies,
  }
}

export function expandDuplicateIds(
  document: DirectorDocument,
  selectedIds: readonly string[],
): string[] {
  const nodes = document.content.nodes
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const pathClips = document.content.timeline.animation.pathMotionClips
  const ids = new Set<string>()

  for (const id of selectedIds) {
    const node = byId.get(id)
    if (!node || node.locked) continue
    if (isDerivedTransformPath(node) || isDerivedPathTarget(pathClips, id)) continue
    ids.add(id)
    collectDescendants(node, nodes, byId, ids)
    if (node.type === 'character' || node.type === 'camera') {
      for (const pathId of userPathIdsForTarget(pathClips, nodes, id)) ids.add(pathId)
    }
  }

  for (const id of [...ids]) {
    const node = byId.get(id)
    if (!node) {
      ids.delete(id)
      continue
    }
    if (isDerivedTransformPath(node) || isDerivedPathTarget(pathClips, id)) ids.delete(id)
  }
  return [...ids]
}

export function transformDeltaFromTo(
  from: { position: Vec3; rotation: Vec3; scale: Vec3 },
  to: { position: Vec3; rotation: Vec3; scale: Vec3 },
): TransformDelta {
  return {
    position: [to.position.x - from.position.x, to.position.y - from.position.y, to.position.z - from.position.z],
    rotation: [to.rotation.x - from.rotation.x, to.rotation.y - from.rotation.y, to.rotation.z - from.rotation.z],
    scale: [
      scaleRatio(from.scale.x, to.scale.x),
      scaleRatio(from.scale.y, to.scale.y),
      scaleRatio(from.scale.z, to.scale.z),
    ],
  }
}

function collectDescendants(
  node: DraftNode,
  nodes: readonly DraftNode[],
  byId: Map<string, DraftNode>,
  into: Set<string>,
): void {
  const childIds = new Set([
    ...(node.children ?? []),
    ...nodes.filter((candidate) => candidate.parentId === node.id).map((candidate) => candidate.id),
  ])
  for (const childId of childIds) {
    if (into.has(childId)) continue
    const child = byId.get(childId)
    if (!child) continue
    into.add(childId)
    collectDescendants(child, nodes, byId, into)
  }
}

function userPathIdsForTarget(
  clips: readonly PathMotionClip[],
  nodes: readonly DraftNode[],
  targetId: string,
): string[] {
  const out: string[] = []
  for (const clip of clips) {
    if (clip.target.nodeId !== targetId || isDerivedPathClip(clip)) continue
    const path = nodes.find((node) => node.id === clip.pathNodeId)
    if (!path || path.type !== 'path') continue
    if (path.path?.source === 'draw' || path.path?.source === 'click') out.push(path.id)
  }
  return out
}

function isDerivedPathTarget(clips: readonly PathMotionClip[], nodeId: string): boolean {
  return clips.some((clip) => clip.pathNodeId === nodeId && isDerivedPathClip(clip))
}

function resolveNodeDelta(
  sourceId: string,
  byId: Map<string, DraftNode>,
  fallback: TransformDelta,
  perNodeDeltas?: Record<string, TransformDelta>,
): TransformDelta {
  let cursor: string | undefined = sourceId
  while (cursor) {
    const own = perNodeDeltas?.[cursor]
    if (own) return own
    cursor = byId.get(cursor)?.parentId
  }
  return fallback
}

function remapNodeRefs(node: DraftNode, idMap: Map<string, string>): void {
  if (node.parentId) {
    const mapped = idMap.get(node.parentId)
    if (mapped) node.parentId = mapped
  }
  if (node.children) {
    node.children = node.children.map((id) => idMap.get(id) ?? id).filter((id) => id !== node.id)
  }
  if (node.camera?.lookAtTarget) {
    node.camera.lookAtTarget.nodeId = idMap.get(node.camera.lookAtTarget.nodeId) ?? node.camera.lookAtTarget.nodeId
  }
  if (node.camera?.subject) {
    node.camera.subject.nodeId = idMap.get(node.camera.subject.nodeId) ?? node.camera.subject.nodeId
  }
}

function appendClonesToExternalParents(
  document: DirectorDocument,
  sourceIds: readonly string[],
  idMap: Map<string, string>,
  byId: Map<string, DraftNode>,
): void {
  for (const sourceId of sourceIds) {
    const source = byId.get(sourceId)
    const destId = idMap.get(sourceId)
    if (!source?.parentId || !destId || idMap.has(source.parentId)) continue
    const parent = document.content.nodes.find((node) => node.id === source.parentId)
    if (!parent) continue
    parent.children = [...(parent.children ?? []), destId]
  }
}

function applyNodeDelta(node: DraftNode, delta: TransformDelta): void {
  if (node.type === 'path') {
    node.transform = {
      ...node.transform,
      position: addVec(node.transform.position, delta.position),
    }
    return
  }
  node.transform = applyTransformDelta(node.transform, delta)
  if (node.camera && !node.camera.lookAtTarget) {
    node.camera.lookAt = addVec(node.camera.lookAt, delta.position)
  }
}

function applyTransformDelta(transform: Transform, delta: TransformDelta): Transform {
  return {
    position: addVec(transform.position, delta.position),
    rotation: addVec(transform.rotation, delta.rotation),
    scale: mulVec(transform.scale, delta.scale),
  }
}

function copyUserKeys(
  source: NonNullable<UserKeys[string]>,
  delta: TransformDelta,
  keepLookAt: boolean,
): NonNullable<UserKeys[string]> {
  const next: NonNullable<UserKeys[string]> = {}
  for (const [prop, keys] of Object.entries(source) as [TrackProp, Keyframe[] | undefined][]) {
    if (!keys) continue
    next[prop] = keys.map((key) => ({
      ...key,
      id: `kf_${Math.random().toString(36).slice(2, 10)}`,
      value: applyValueDelta(prop, key.value, delta, keepLookAt),
    }))
  }
  return next
}

function applyValueDelta(
  prop: TrackProp,
  value: number[],
  delta: TransformDelta,
  keepLookAt: boolean,
): number[] {
  const next = [...value]
  if (prop === 'position' || (prop === 'lookAt' && !keepLookAt)) {
    const add = delta.position
    if (add) {
      next[0] = (next[0] ?? 0) + add[0]
      next[1] = (next[1] ?? 0) + add[1]
      next[2] = (next[2] ?? 0) + add[2]
    }
  } else if (prop === 'rotation') {
    const add = delta.rotation
    if (add) {
      next[0] = (next[0] ?? 0) + add[0]
      next[1] = (next[1] ?? 0) + add[1]
      next[2] = (next[2] ?? 0) + add[2]
    }
  } else if (prop === 'scale') {
    const mul = delta.scale
    if (mul) {
      next[0] = (next[0] ?? 1) * scaleFactor(mul[0])
      next[1] = (next[1] ?? 1) * scaleFactor(mul[1])
      next[2] = (next[2] ?? 1) * scaleFactor(mul[2])
    }
  }
  return next
}

function copyClips(
  document: DirectorDocument,
  idMap: Map<string, string>,
  fallback: TransformDelta,
  perNodeDeltas: Record<string, TransformDelta> | undefined,
  byId: Map<string, DraftNode>,
): void {
  const anim = document.content.timeline.animation
  const stamp = Date.now().toString(36)
  let clipIndex = 0
  const nextClipId = (id: string) => `${id}_copy_${stamp}_${clipIndex++}`

  anim.motionClips = [
    ...anim.motionClips,
    ...anim.motionClips
      .filter((clip) => idMap.has(clip.target.nodeId))
      .map((clip) => remapMotionClip(cloneJson(clip), idMap, nextClipId(clip.id))),
  ]
  anim.cameraMotionClips = [
    ...anim.cameraMotionClips,
    ...anim.cameraMotionClips
      .filter((clip) => idMap.has(clip.target.nodeId))
      .map((clip) => remapCameraClip(
        cloneJson(clip),
        idMap,
        nextClipId(clip.id),
        resolveNodeDelta(clip.target.nodeId, byId, fallback, perNodeDeltas),
      )),
  ]
  anim.pathMotionClips = [
    ...anim.pathMotionClips,
    ...anim.pathMotionClips
      .filter((clip) => idMap.has(clip.target.nodeId) && !isDerivedPathClip(clip))
      .map((clip) => remapPathClip(cloneJson(clip), idMap, nextClipId(clip.id))),
  ]
}

function remapMotionClip(clip: MotionClip, idMap: Map<string, string>, id: string): MotionClip {
  clip.id = id
  clip.target = { ...clip.target, nodeId: idMap.get(clip.target.nodeId) ?? clip.target.nodeId }
  return clip
}

function remapPathClip(clip: PathMotionClip, idMap: Map<string, string>, id: string): PathMotionClip {
  clip.id = id
  clip.target = { ...clip.target, nodeId: idMap.get(clip.target.nodeId) ?? clip.target.nodeId }
  clip.pathNodeId = idMap.get(clip.pathNodeId) ?? clip.pathNodeId
  return clip
}

function remapCameraClip(
  clip: CameraMotionClip,
  idMap: Map<string, string>,
  id: string,
  delta: TransformDelta,
): CameraMotionClip {
  clip.id = id
  clip.target = { ...clip.target, nodeId: idMap.get(clip.target.nodeId) ?? clip.target.nodeId }
  if (clip.motion.metadata && typeof clip.motion.metadata === 'object') {
    clip.motion.metadata = remapMotionMetadata(clip.motion.metadata, idMap)
  }
  clip.motion.curves = clip.motion.curves.map((curve) => shiftBakedCurve(curve, delta))
  return clip
}

function remapMotionMetadata(
  metadata: Record<string, unknown>,
  idMap: Map<string, string>,
): Record<string, unknown> {
  const keys = ['cameraNodeId', 'targetNodeId', 'secondaryTargetNodeId', 'occluderNodeId'] as const
  const next = { ...metadata }
  for (const key of keys) {
    const value = next[key]
    if (typeof value === 'string' && idMap.has(value)) next[key] = idMap.get(value)
  }
  return next
}

function shiftBakedCurve(curve: BakedCurve, delta: TransformDelta): BakedCurve {
  const add = curve.group === 'position' || curve.group === 'lookAt'
    ? delta.position?.[curve.arrayIndex] ?? 0
    : 0
  if (!add) return curve
  return {
    ...curve,
    keyframes: curve.keyframes.map((key) => ({ ...key, value: key.value + add })),
  }
}

function addVec(value: Vec3, delta?: [number, number, number]): Vec3 {
  if (!delta) return { ...value }
  return { x: value.x + delta[0], y: value.y + delta[1], z: value.z + delta[2] }
}

function mulVec(value: Vec3, delta?: [number, number, number]): Vec3 {
  if (!delta) return { ...value }
  return {
    x: value.x * scaleFactor(delta[0]),
    y: value.y * scaleFactor(delta[1]),
    z: value.z * scaleFactor(delta[2]),
  }
}

function scaleRatio(from: number, to: number): number {
  if (from === 0) return 1
  return to / from
}

function scaleFactor(value: number | undefined): number {
  return value === undefined || value === 0 ? 1 : value
}
