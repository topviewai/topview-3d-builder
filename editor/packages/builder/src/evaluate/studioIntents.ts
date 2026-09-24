/**
 * 导演台「意图 → 完整节点」纯函数。与 libraryActions 同一套摆放规则，
 * 不依赖 LibraryHost / WebGL，供 CLI 与前端共用。
 */
import type { DirectorDocument, DraftNode, MotionClip, Vec3 } from '../contract/types'
import { CAMERA_FOV_MAX, CAMERA_FOV_MIN, CAMERA_PRESETS } from '../data/cameraLibrary'
import {
  defaultPoseLibraryBank,
  type PoseLibraryBank,
} from '../data/poseLibraryBank'
import { POSE_CONTROLS } from '../data/poseControls'
import { POSE_PRESET_BY_ID } from '../data/posePresets'
import { applyCameraPresetToNode, applyCameraPresetToSubject } from './camera/bakeMotion'
import { subjectWorldToLocal, subjectYawDeg } from './camera/subjectBinding'

export const CHARACTER_COLORS = ['#7fb2e0', '#e0a37f', '#9fe07f', '#d07fe0', '#e0d06a', '#6ad0c0']

export const DEFAULT_MOTION_DURATION_SECONDS = 2

export type StudioIntentErrorCode =
  | 'preset-not-found'
  | 'missing-character'
  | 'missing-node'
  | 'missing-camera'
  | 'current-viewport-unavailable'
  | 'subject-missing'
  | 'node-exists'
  | 'invalid-intent'

export class StudioIntentError extends Error {
  readonly code: StudioIntentErrorCode

  constructor(code: StudioIntentErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'StudioIntentError'
    this.code = code
  }
}

export type PartialVec3 = { x?: number; y?: number; z?: number }

export type AddCharacterIntent = {
  type: 'add-character'
  libraryId: string
  name: string
  modelUrl: string
  nodeId?: string
  rig?: 'ual1' | 'mixamorig'
}

export type AddPropIntent = {
  type: 'add-prop'
  libraryId: string
  name: string
  modelUrl: string
  nodeId?: string
}

export type AddCameraIntent = {
  type: 'add-camera'
  presetId: string
  nodeId?: string
  subjectNodeId?: string
}

export type AddMotionIntent = {
  type: 'add-motion'
  libraryId: string
  name: string
  fbxKey: string
  targetNodeId: string
  clipId?: string
  frameStart?: number
  durationSeconds?: number
}

export type ApplyPoseIntent = {
  type: 'apply-pose'
  nodeId: string
  presetId: string
}

export type SetFovIntent = {
  type: 'set-fov'
  cameraNodeId: string
  fov: number
}

export type SetDistanceIntent = {
  type: 'set-distance'
  cameraNodeId: string
  distance: number
}

export type PatchTransformIntent = {
  type: 'patch-transform'
  nodeId: string
  position?: PartialVec3
  rotation?: PartialVec3
  scale?: PartialVec3
}

export type StudioIntent =
  | AddCharacterIntent
  | AddPropIntent
  | AddCameraIntent
  | AddMotionIntent
  | ApplyPoseIntent
  | SetFovIntent
  | SetDistanceIntent
  | PatchTransformIntent

export interface StudioIntentResult {
  document: DirectorDocument
  fcurves?: unknown
  createdIds: string[]
  nodeId?: string
  clipId?: string
}

/** 命名形如 `背面中景_1` / `_2`。草稿里已有 `_1` 时不能再落一个无后缀的同名。 */
export function uniqueNodeName(doc: DirectorDocument, base: string): string {
  const names = doc.content.nodes.map((n) => n.name)
  const taken = new Set(names)
  const prefix = `${base}_`
  let max = taken.has(base) ? 1 : 0
  for (const name of names) {
    if (!name.startsWith(prefix)) continue
    const n = Number(name.slice(prefix.length))
    if (Number.isInteger(n) && n > 0) max = Math.max(max, n)
  }
  let next = max + 1
  let candidate = `${base}_${next}`
  while (taken.has(candidate)) {
    next += 1
    candidate = `${base}_${next}`
  }
  return candidate
}

export function nextIndexedId(existing: readonly string[], prefix: string): string {
  let n = 1
  while (existing.includes(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

export function clampCameraFov(fov: number): number {
  return Math.min(CAMERA_FOV_MAX, Math.max(CAMERA_FOV_MIN, fov))
}

/** 沿「看点 → 机位」射线缩放，俯仰 / 方位角不变。 */
export function dollyTowardLookAt(pos: Vec3, lookAt: Vec3, distance: number): Vec3 {
  const dx = pos.x - lookAt.x
  const dy = pos.y - lookAt.y
  const dz = pos.z - lookAt.z
  const old = Math.hypot(dx, dy, dz)
  if (old < 1e-6) return { x: lookAt.x, y: lookAt.y, z: lookAt.z + distance }
  const scale = distance / old
  return { x: lookAt.x + dx * scale, y: lookAt.y + dy * scale, z: lookAt.z + dz * scale }
}

export function listStudioCameraPresets(): Array<{ id: string; name: string; fov: number }> {
  return CAMERA_PRESETS
    .filter((preset) => preset.id !== 'current')
    .map((preset) => ({ id: preset.id, name: preset.name, fov: preset.fov }))
}

function allIds(doc: DirectorDocument): string[] {
  return [
    ...doc.content.nodes.map((n) => n.id),
    ...doc.content.timeline.animation.motionClips.map((c) => c.id),
    ...doc.content.timeline.animation.cameraMotionClips.map((c) => c.id),
    ...doc.content.asset.motionPath.map((e) => e.id),
  ]
}

function requireUnusedId(doc: DirectorDocument, id: string): string {
  if (allIds(doc).includes(id)) throw new StudioIntentError('node-exists', id)
  return id
}

export function buildCharacterNode(
  doc: DirectorDocument,
  intent: AddCharacterIntent,
  poseBank: PoseLibraryBank = defaultPoseLibraryBank,
): DraftNode {
  const charCount = doc.content.nodes.filter((n) => n.type === 'character').length
  const id = intent.nodeId
    ? requireUnusedId(doc, intent.nodeId)
    : nextIndexedId(allIds(doc), 'user_chr_')
  return {
    id,
    type: 'character',
    name: uniqueNodeName(doc, intent.name),
    visible: true,
    locked: false,
    transform: {
      position: { x: charCount * 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    metadata: {
      modelUrl: intent.modelUrl,
      assetId: intent.libraryId,
      ...(intent.rig ? { rig: intent.rig } : {}),
    },
    character: {
      placeholder: false,
      gender: 'unknown',
      motionId: null,
      appearance: { color: CHARACTER_COLORS[charCount % CHARACTER_COLORS.length] },
      label: { showLabel: true, scale: 1, yOffset: 0 },
      animation: { mode: 'pose', posePresetId: poseBank.defaultId(), controlValues: {} },
    },
  }
}

export function buildPropNode(doc: DirectorDocument, intent: AddPropIntent): DraftNode {
  const id = intent.nodeId
    ? requireUnusedId(doc, intent.nodeId)
    : nextIndexedId(allIds(doc), 'user_prop_')
  return {
    id,
    type: 'prop',
    name: intent.name,
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    metadata: { modelUrl: intent.modelUrl, assetId: intent.libraryId },
    prop: { category: 'user' },
  }
}

export function buildCameraNode(doc: DirectorDocument, intent: AddCameraIntent): DraftNode {
  if (intent.presetId === 'current') {
    throw new StudioIntentError('current-viewport-unavailable')
  }
  const preset = CAMERA_PRESETS.find((p) => p.id === intent.presetId)
  if (!preset) throw new StudioIntentError('preset-not-found', intent.presetId)
  const id = intent.nodeId
    ? requireUnusedId(doc, intent.nodeId)
    : nextIndexedId(allIds(doc), 'user_cam_')
  const node: DraftNode = {
    id,
    type: 'camera',
    name: uniqueNodeName(doc, preset.name),
    visible: true,
    locked: false,
    transform: {
      position: { ...preset.position },
      rotation: { ...preset.rotation },
      scale: { x: 1, y: 1, z: 1 },
    },
    camera: {
      projection: 'perspective',
      fov: preset.fov,
      fovAxis: 'vertical',
      near: 0.1,
      far: 2000,
      isPrimary: false,
      lookAt: { ...preset.lookAt },
    },
  }
  applyCameraPresetToNode(node, preset)
  if (intent.subjectNodeId) {
    const subject = doc.content.nodes.find(
      (n) => n.id === intent.subjectNodeId && n.type === 'character',
    )
    if (!subject) throw new StudioIntentError('missing-character', intent.subjectNodeId)
    applyCameraPresetToSubject(node, preset, subject)
  }
  return node
}

function resolveMotionDurationSeconds(doc: DirectorDocument, intent: AddMotionIntent): number {
  if (intent.durationSeconds !== undefined && Number.isFinite(intent.durationSeconds)) {
    return Math.max(1 / Math.max(doc.content.timeline.fps, 1), intent.durationSeconds)
  }
  return DEFAULT_MOTION_DURATION_SECONDS
}

/** 与 addMotionClipFromLibrary 相同：重叠的同角色 clip 级联后移（半开区间）。 */
export function shiftOverlappingMotionClips(
  sameTarget: MotionClip[],
  frameStart: number,
  frameEnd: number,
): Map<string, MotionClip> {
  const shifted = new Map<string, MotionClip>()
  let cursorStart = frameStart
  let cursorEnd = frameEnd
  for (const existing of sameTarget) {
    if (existing.frameEnd <= cursorStart || existing.frameStart >= cursorEnd) continue
    const next = {
      ...existing,
      frameStart: cursorEnd,
      frameEnd: cursorEnd + (existing.frameEnd - existing.frameStart),
    }
    shifted.set(existing.id, next)
    cursorStart = next.frameStart
    cursorEnd = next.frameEnd
  }
  return shifted
}

export function appendMotionClip(doc: DirectorDocument, intent: AddMotionIntent): MotionClip {
  const target = doc.content.nodes.find((n) => n.id === intent.targetNodeId && n.type === 'character')
  if (!target) throw new StudioIntentError('missing-character', intent.targetNodeId)
  const fps = doc.content.timeline.fps || 30
  const durationSeconds = resolveMotionDurationSeconds(doc, intent)
  const durationFrames = Math.max(1, Math.round(durationSeconds * fps))
  const frameStart = Math.max(0, Math.floor(intent.frameStart ?? 0))
  const frameEnd = frameStart + durationFrames
  const clipId = intent.clipId
    ? requireUnusedId(doc, intent.clipId)
    : nextIndexedId(allIds(doc), 'user_mc_')
  const assetId = intent.libraryId
  const clip: MotionClip = {
    id: clipId,
    source: 'user-library',
    sourceDuration: durationSeconds,
    frameStart,
    frameEnd,
    target: { type: 'character', nodeId: target.id },
    playback: { version: 1, speed: 1, loop: true, loopMode: 'repeat' },
    motion: {
      assetId,
      name: intent.name,
      source: 'user-library',
      sourceRig: 'mixamorig',
      url: intent.fbxKey,
      inPlace: true,
      loop: true,
      speed: 1,
      time: 0,
    },
  }
  const tl = doc.content.timeline
  const sameTarget = tl.animation.motionClips
    .filter((c) => c.target.nodeId === target.id)
    .sort((a, b) => a.frameStart - b.frameStart)
  const shifted = shiftOverlappingMotionClips(sameTarget, frameStart, frameEnd)
  tl.animation.motionClips = tl.animation.motionClips.map((c) => shifted.get(c.id) ?? c).concat(clip)
  if (!doc.content.asset.motionPath.some((e) => e.id === assetId || e.path === intent.fbxKey)) {
    doc.content.asset.motionPath.push({ id: assetId, path: intent.fbxKey })
  }
  // Clip content may extend beyond the user-defined playback range.
  return clip
}

export function applyPoseInPlace(
  doc: DirectorDocument,
  intent: ApplyPoseIntent,
  poseBank: PoseLibraryBank = defaultPoseLibraryBank,
): void {
  const node = doc.content.nodes.find((n) => n.id === intent.nodeId)
  if (!node) throw new StudioIntentError('missing-node', intent.nodeId)
  if (!node.character) throw new StudioIntentError('missing-character', intent.nodeId)
  const libraryPose = poseBank.get(intent.presetId)
  const preset = libraryPose ? undefined : POSE_PRESET_BY_ID[intent.presetId]
  if (!libraryPose && !preset) throw new StudioIntentError('preset-not-found', intent.presetId)
  const anim = node.character.animation
  anim.mode = 'pose'
  if (libraryPose) {
    anim.posePresetId = libraryPose.id
    anim.controlValues = {}
    anim.rootPositionOffset = poseBank.rootOffset(libraryPose.id) ?? { x: 0, y: 0, z: 0 }
    return
  }
  if (preset) {
    anim.posePresetId = preset.id
    anim.controlValues = Object.fromEntries(
      POSE_CONTROLS.map((c) => [c.key, preset.controlValues[c.key] ?? 0]),
    )
    anim.rootPositionOffset = { x: 0, y: preset.rootOffsetY ?? 0, z: 0 }
  }
}

export function setCameraFovInPlace(doc: DirectorDocument, intent: SetFovIntent): void {
  const cam = doc.content.nodes.find((n) => n.id === intent.cameraNodeId && n.type === 'camera')
  if (!cam?.camera) throw new StudioIntentError('missing-camera', intent.cameraNodeId)
  cam.camera.fov = clampCameraFov(intent.fov)
}

export function setCameraDistanceInPlace(doc: DirectorDocument, intent: SetDistanceIntent): void {
  const cam = doc.content.nodes.find((n) => n.id === intent.cameraNodeId && n.type === 'camera')
  if (!cam?.camera) throw new StudioIntentError('missing-camera', intent.cameraNodeId)
  const nextDist = Math.max(0.1, intent.distance)
  const lookAt = cam.camera.lookAt
  const nextPos = dollyTowardLookAt(cam.transform.position, lookAt, nextDist)
  const binding = cam.camera.subject
  if (binding) {
    const subject = doc.content.nodes.find((n) => n.id === binding.nodeId && n.type === 'character')
    if (!subject) throw new StudioIntentError('subject-missing', binding.nodeId)
    const yawDeg = binding.followRotation ? subjectYawDeg(subject.transform.rotation) : 0
    binding.offset = subjectWorldToLocal(nextPos, subject.transform.position, yawDeg)
    binding.lookAtOffset = subjectWorldToLocal(lookAt, subject.transform.position, yawDeg)
    binding.distance = nextDist
  }
  cam.transform.position = nextPos
}

function mergeVec3(base: Vec3, patch?: PartialVec3): Vec3 {
  if (!patch) return { ...base }
  return {
    x: patch.x === undefined ? base.x : patch.x,
    y: patch.y === undefined ? base.y : patch.y,
    z: patch.z === undefined ? base.z : patch.z,
  }
}

export function patchNodeTransformInPlace(doc: DirectorDocument, intent: PatchTransformIntent): void {
  const node = doc.content.nodes.find((n) => n.id === intent.nodeId)
  if (!node) throw new StudioIntentError('missing-node', intent.nodeId)
  node.transform.position = mergeVec3(node.transform.position, intent.position)
  node.transform.rotation = mergeVec3(node.transform.rotation, intent.rotation)
  node.transform.scale = mergeVec3(node.transform.scale, intent.scale)
}

export function applyStudioIntentInPlace(
  document: DirectorDocument,
  intent: StudioIntent,
  poseBank: PoseLibraryBank = defaultPoseLibraryBank,
): { createdIds: string[]; nodeId?: string; clipId?: string } {
  switch (intent.type) {
    case 'add-character': {
      const node = buildCharacterNode(document, intent, poseBank)
      document.content.nodes.push(node)
      return { createdIds: [node.id], nodeId: node.id }
    }
    case 'add-prop': {
      const node = buildPropNode(document, intent)
      document.content.nodes.push(node)
      return { createdIds: [node.id], nodeId: node.id }
    }
    case 'add-camera': {
      const node = buildCameraNode(document, intent)
      document.content.nodes.push(node)
      return { createdIds: [node.id], nodeId: node.id }
    }
    case 'add-motion': {
      const clip = appendMotionClip(document, intent)
      return { createdIds: [clip.id], clipId: clip.id }
    }
    case 'apply-pose':
      applyPoseInPlace(document, intent, poseBank)
      return { createdIds: [], nodeId: intent.nodeId }
    case 'set-fov':
      setCameraFovInPlace(document, intent)
      return { createdIds: [], nodeId: intent.cameraNodeId }
    case 'set-distance':
      setCameraDistanceInPlace(document, intent)
      return { createdIds: [], nodeId: intent.cameraNodeId }
    case 'patch-transform':
      patchNodeTransformInPlace(document, intent)
      return { createdIds: [], nodeId: intent.nodeId }
    default: {
      const neverIntent: never = intent
      throw new StudioIntentError('invalid-intent', JSON.stringify(neverIntent))
    }
  }
}

export function applyStudioIntent(input: {
  document: DirectorDocument
  intent: StudioIntent
  fcurves?: unknown
  poseBank?: PoseLibraryBank
}): StudioIntentResult {
  const document = JSON.parse(JSON.stringify(input.document)) as DirectorDocument
  const applied = applyStudioIntentInPlace(document, input.intent, input.poseBank)
  return {
    document,
    fcurves: input.fcurves,
    createdIds: applied.createdIds,
    nodeId: applied.nodeId,
    clipId: applied.clipId,
  }
}
