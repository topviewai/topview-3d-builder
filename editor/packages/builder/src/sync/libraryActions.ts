import type { DirectorDocument, DraftNode, Vec3 } from '../contract/types'
import { CAMERA_MOTIONS, CAMERA_PRESETS } from '../data/cameraLibrary'
import {
  appendMotionClip,
  applyPoseInPlace,
  buildCameraNode,
  buildCharacterNode,
  buildPropNode,
  clampCameraFov,
  nextIndexedId,
  uniqueNodeName,
  StudioIntentError,
} from '../evaluate/studioIntents'
import { snapshotDocState, type DocSnapshotState } from '../document'
import { FCurveSet } from '../evaluate/curves/FCurveSet'
import {
  applyCameraPresetToNode,
  applyCameraPresetToSubject,
  bakeCameraMotionClip,
  resolveTargetCamera,
} from '../evaluate/camera/bakeMotion'
import { evaluateCameraPose } from '../evaluate/camera/CameraRig'
import { lookDistance, manualCameraLookAt, sameCameraAim } from '../evaluate/camera/cameraAim'
import { cameraMotionOwnsKeyframes } from '../evaluate/camera/cameraMotionExclusive'
import { nodeHasAnimatedTransform, type StagedTransform } from '../evaluate/stagedTransform'
import {
  characterLookAtPoint,
  resolveSubjectCameraPose,
  subjectWorldToLocal,
  subjectYawDeg,
} from '../evaluate/camera/subjectBinding'
import { rederiveWalkPaths } from '../evaluate/path/deriveWalk'
import { rippleResizeClip, rippleShiftClipsAfter } from '../document/clipRipple'
import {
  applyTransformEdit,
  nodeHasUserXformKeys,
  type TransformEditPatch,
  highSupportHits,
  pickTopSurfaceRest,
  seatOnSupport,
} from './transformEdit'
import type { DirectorEngine } from '../engine/DirectorEngine'
import { assetBasename } from '../host/assetKeys'
import { resolveMediaUrl } from '../host/resolve'
import type { CharacterLibEntry } from '../host/types'
import type { HostAdapter } from '../host/types'
import type { DirectorDoc } from '../document'
import type { EditorStore } from '../stores/EditorStore'
import type { EnvironmentPatch, Selection } from '../stores/types'

export interface LibraryHost {
  queueCameraAimReleased(): void
  engine: DirectorEngine
  docModel: DirectorDoc
  editor: EditorStore
  adapter: HostAdapter<DirectorDocument>
  pushDocSnapshot(label: string, before: DocSnapshotState, mergeKey?: string): void
  commitAddedNode(node: DraftNode, label: string): string | null
  capturePendingTransform(nodeId: string, patch: TransformEditPatch): boolean
}

/** 自动关键帧已在 applyCameraUserEdit 里落盘时，调用方不要再压一条静态变换快照。 */
function autoKeyAlreadyPersisted(host: LibraryHost, nodeId: string): boolean {
  return host.editor.autoKeyframe && !cameraMotionOwnsKeyframes(host.docModel.snapshot, nodeId)
}

function selectedTargetNodeId(doc: DirectorDocument, selection: Selection | null): string | null {
  if (!selection) return null
  if (selection.kind === 'timelineBox') {
    if (selection.keys[0]) return selection.keys[0].nodeId
    const ref = selection.clips[0]
    if (!ref) return null
    selection = { kind: 'clip', clipType: ref.clipType, clipId: ref.clipId }
  }
  if (selection.kind !== 'clip') {
    if (selection.kind === 'node' || selection.kind === 'keyframe' || selection.kind === 'transformKeyframe') {
      return selection.nodeId
    }
    return null
  }
  const clipSel = selection
  const animation = doc.content.timeline.animation
  const clips = clipSel.clipType === 'camera'
    ? animation.cameraMotionClips
    : clipSel.clipType === 'motion'
      ? animation.motionClips
      : animation.pathMotionClips
  return clips.find((c) => c.id === clipSel.clipId)?.target.nodeId ?? null
}

function selectedNodeOfType(
  doc: DirectorDocument,
  selection: Selection | null,
  type: DraftNode['type'],
): DraftNode | null {
  const nodeId = selectedTargetNodeId(doc, selection)
  return nodeId ? (doc.content.nodes.find((node) => node.id === nodeId && node.type === type) ?? null) : null
}

/**
 * 机位要围着谁摆：优先当前选中的人物；没选人物时沿用这台相机已有的绑定，
 * 这样连点第二个机位不会因为上一次点击把选中项换成了相机而退回绝对坐标。
 */
function resolveCameraSubject(host: LibraryHost, doc: DirectorDocument, cam: DraftNode): DraftNode | null {
  const selected = selectedNodeOfType(doc, host.editor.selection, 'character')
  if (selected) return subjectAtCurrentFrame(host, selected)
  const boundId = cam.camera?.subject?.nodeId
  const bound = boundId
    ? (doc.content.nodes.find((node) => node.id === boundId && node.type === 'character') ?? null)
    : null
  return bound ? subjectAtCurrentFrame(host, bound) : null
}

function characterById(doc: DirectorDocument, nodeId: string | undefined): DraftNode | null {
  if (!nodeId) return null
  return doc.content.nodes.find((node) => node.id === nodeId && node.type === 'character') ?? null
}

function lastMotionTargetOnCamera(doc: DirectorDocument, cameraId: string): DraftNode | null {
  const clips = doc.content.timeline.animation.cameraMotionClips
  for (let i = clips.length - 1; i >= 0; i -= 1) {
    const clip = clips[i]
    if (clip.target.nodeId !== cameraId) continue
    const raw = clip.motion.metadata?.targetNodeId
    const targetId = typeof raw === 'string' ? raw : undefined
    const node = characterById(doc, targetId)
    if (node) return node
  }
  return null
}

function resolveMotionTargetCharacter(host: LibraryHost, doc: DirectorDocument, cam: DraftNode): DraftNode | null {
  const selected = selectedNodeOfType(doc, host.editor.selection, 'character')
  if (selected) return subjectAtCurrentFrame(host, selected)
  const fromClip = lastMotionTargetOnCamera(doc, cam.id)
  if (fromClip) return subjectAtCurrentFrame(host, fromClip)
  const bound = characterById(doc, cam.camera?.subject?.nodeId)
  return bound ? subjectAtCurrentFrame(host, bound) : null
}

/**
 * 人物即使没有动作 / 轨迹 clip 也可能被 fcurves 或用户关键帧推走。用当前帧求值出来
 * 的 pose 算机位，写进草稿的位置才和视口里看到的人物对得上。
 */
function subjectAtCurrentFrame(host: LibraryHost, subject: DraftNode): DraftNode {
  const evaluated = host.engine.getNodeSnapshot(subject.id)
  if (!evaluated) return subject
  const { position, rotation } = evaluated
  if (position.length < 3 || rotation.length < 3) return subject
  if (![...position.slice(0, 3), ...rotation.slice(0, 3)].every(Number.isFinite)) return subject
  return {
    ...subject,
    transform: {
      ...subject.transform,
      position: { x: position[0], y: position[1], z: position[2] },
      rotation: { x: rotation[0], y: rotation[1], z: rotation[2] },
    },
  }
}

export function applyCameraPreset(host: LibraryHost, presetId: string): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const preset = CAMERA_PRESETS.find((p) => p.id === presetId)
  if (!preset) return 'preset-not-found'
  // 以当前激活相机为准，而不是选中节点：选中项可能停在人物或时间轴片段上，
  // 那样会把预设写到另一台相机，视口预览里就看不到任何变化。
  const cam = resolveTargetCamera(doc, host.editor.activeCameraId)
  if (!cam) return 'missing-camera'
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  const subject = resolveCameraSubject(host, doc, cam)
  if (subject) applyCameraPresetToSubject(cam, preset, subject)
  else applyCameraPresetToNode(cam, preset)
  // 旧 fcurves / userKeys 会盖住刚写入的静态机位，看起来像还停在上一个机位里。
  pinAppliedCameraPose(host, cam)
  host.docModel.touch()
  host.pushDocSnapshot('应用机位', before)
  host.editor.select({ kind: 'node', nodeId: cam.id })
  host.editor.setActiveCamera(cam.id)
  return null
}

/**
 * 相机在当前帧求值后的位置 / lookAt。相机跟随人物时静态 transform 只是绑定那一刻
 * 的快照，要拿这个才是眼下看到的机位。
 */
function cameraPoseAtCurrentFrame(
  host: LibraryHost,
  cameraId: string,
): { position: Vec3; lookAt: Vec3 | null; rotation: Vec3 | null } | null {
  const evaluated = host.engine.getNodeSnapshot(cameraId)
  if (!evaluated || evaluated.position.length < 3) return null
  const [x, y, z] = evaluated.position
  if (![x, y, z].every(Number.isFinite)) return null
  const look = evaluated.lookAt
  const lookAt = look && look.length >= 3 && look.every(Number.isFinite)
    ? { x: look[0], y: look[1], z: look[2] }
    : null
  const rot = evaluated.rotation
  const rotation = rot && rot.length >= 3 && rot.every(Number.isFinite)
    ? { x: rot[0], y: rot[1], z: rot[2] }
    : null
  return { position: { x, y, z }, lookAt, rotation }
}

/** 把相机的静态 transform 落到当前帧的求值结果上 */

function shouldStageNode(host: LibraryHost, nodeId: string): boolean {
  // 自动关键帧开着时属性变化应立刻落键，不能先被暂存吃掉。
  if (host.editor.autoKeyframe) return false
  return nodeHasAnimatedTransform(host.docModel.userKeys, host.docModel.fcurves, nodeId)
}

function shouldStageCamera(host: LibraryHost, cam: DraftNode): boolean {
  const doc = host.docModel.snapshot
  if (!doc || cameraMotionOwnsKeyframes(doc, cam.id)) return false
  return shouldStageNode(host, cam.id)
}

function stageCameraPose(host: LibraryHost, camId: string, patch: StagedTransform): void {
  host.engine.setStagedTransform(camId, patch)
  const pos = patch.position
  if (pos) {
    host.engine.applyLiveCameraPose(camId, pos, patch.lookAt ?? null, patch.rotation ?? null)
  } else if (patch.rotation || patch.lookAt) {
    const live = cameraPoseAtCurrentFrame(host, camId)
    const p = live?.position ?? { x: 0, y: 0, z: 0 }
    host.engine.applyLiveCameraPose(camId, p, patch.lookAt ?? live?.lookAt ?? null, patch.rotation ?? live?.rotation ?? null)
  }
  if (patch.fov !== undefined) host.engine.applyLiveCameraFov(camId, patch.fov)
}

function syncCameraNodeToCurrentFrame(host: LibraryHost, cam: DraftNode): void {
  const pose = cameraPoseAtCurrentFrame(host, cam.id)
  if (!pose) return
  cam.transform.position = pose.position
  if (pose.rotation) cam.transform.rotation = pose.rotation
  if (cam.camera && pose.lookAt) cam.camera.lookAt = pose.lookAt
}

/** 目标相机：显式给了 id 用它，否则用当前激活机位 */
function cameraById(doc: DirectorDocument, cameraId: string | undefined, activeId: string | null): DraftNode | null {
  if (!cameraId) return resolveTargetCamera(doc, activeId)
  return doc.content.nodes.find((node) => node.id === cameraId && node.type === 'camera') ?? null
}


function clearCameraUserPoseKeys(host: LibraryHost, cameraId: string): void {
  const uk = host.docModel.userKeys[cameraId]
  if (!uk?.position && !uk?.rotation && !uk?.lookAt && !uk?.fov) return
  const rest = { ...uk }
  delete rest.position
  delete rest.rotation
  delete rest.lookAt
  delete rest.fov
  const next = { ...host.docModel.userKeys }
  if (Object.keys(rest).length === 0) delete next[cameraId]
  else next[cameraId] = rest
  host.docModel.setUserKeys(next)
}

/**
 * 机位数值 / 拖拽落盘：与人物变换同一套规则。
 * 自动关键帧开启时由 capturePendingTransform 写键；关闭时当前帧已有
 * userKeys 则改键值，否则写静态字段。官方 fcurves 不改。
 */
function applyCameraUserEdit(
  host: LibraryHost,
  cam: DraftNode,
  patch: { position?: Vec3; rotation?: Vec3; lookAt?: Vec3; fov?: number },
): boolean {
  const doc = host.docModel.snapshot
  if (!doc) return false
  // 运镜已接管：机位仍可调，但只写静态，不再改动/新建 userKeys。
  if (cameraMotionOwnsKeyframes(doc, cam.id)) {
    let changed = false
    if (patch.position) {
      cam.transform.position = { ...patch.position }
      changed = true
    }
    if (patch.rotation) {
      cam.transform.rotation = { ...patch.rotation }
      changed = true
    }
    if (patch.lookAt && cam.camera) {
      cam.camera.lookAt = { ...patch.lookAt }
      changed = true
    }
    if (patch.fov !== undefined && cam.camera) {
      cam.camera.fov = patch.fov
      changed = true
    }
    return changed
  }
  const edit: TransformEditPatch = {
    position: patch.position ? [patch.position.x, patch.position.y, patch.position.z] : undefined,
    rotation: patch.rotation ? [patch.rotation.x, patch.rotation.y, patch.rotation.z] : undefined,
    lookAt: patch.lookAt ? [patch.lookAt.x, patch.lookAt.y, patch.lookAt.z] : undefined,
    fov: patch.fov !== undefined ? [patch.fov] : undefined,
  }
  if (host.capturePendingTransform(cam.id, edit)) return true
  const frame = Math.round(host.engine.currentFrame)
  const result = applyTransformEdit(doc, host.docModel.userKeys, cam.id, frame, edit)
  if (result.userKeys !== host.docModel.userKeys) host.docModel.setUserKeys(result.userKeys)
  return result.changed
}

/**
 * 把自由机位钉在世界坐标上：已有键则改键，否则写静态 transform。
 */
/**
 * 自由机位落盘。
 * - 默认：写 position/lookAt，再按 live lookAt() 反推 rotation（绑了看点目标时，平移应改朝向）。
 * - freezeRotation：刚体平移——看点随相机等量位移，欧拉角绝对冻结，禁止 lookAt() 反推旋转。
 */
function persistFreeCameraWorldPose(
  host: LibraryHost,
  cam: DraftNode,
  worldPos: Vec3,
  lookAt: Vec3 | null | undefined,
  freezeRotation?: Vec3 | null,
): void {
  if (freezeRotation) {
    applyCameraUserEdit(host, cam, {
      position: worldPos,
      lookAt: lookAt ?? undefined,
      rotation: freezeRotation,
    })
    host.engine.applyLiveCameraPose(cam.id, worldPos, lookAt ?? null, freezeRotation)
    return
  }
  applyCameraUserEdit(host, cam, { position: worldPos, lookAt: lookAt ?? undefined })
  host.engine.applyLiveCameraPose(cam.id, worldPos, lookAt ?? null)
  const live = cameraPoseAtCurrentFrame(host, cam.id)
  if (live?.rotation) applyCameraUserEdit(host, cam, { rotation: live.rotation })
}

function clearLookAtTarget(cam: DraftNode): void {
  if (cam.camera?.lookAtTarget) delete cam.camera.lookAtTarget
}

/** 显式编辑看点坐标时调整目标偏移；手动旋转由 writeCameraRotation 解除瞄准。 */
function syncLookAtTargetOffset(host: LibraryHost, cam: DraftNode, lookAt: Vec3): void {
  const target = cam.camera?.lookAtTarget
  if (!target) return
  const doc = host.docModel.snapshot
  if (!doc) return
  const subject = subjectPoseAtCurrentFrame(host, doc, target.nodeId)
  if (!subject) return
  target.offset = {
    x: lookAt.x - subject.position.x,
    y: lookAt.y - subject.position.y,
    z: lookAt.z - subject.position.z,
  }
}

function pinLookAtTarget(
  host: LibraryHost,
  cam: DraftNode,
  nodeId: string,
  lookAt: Vec3,
): void {
  if (!cam.camera) return
  const doc = host.docModel.snapshot
  const subject = doc ? subjectPoseAtCurrentFrame(host, doc, nodeId) : null
  const origin = subject?.position ?? { x: lookAt.x, y: lookAt.y - 1.2, z: lookAt.z }
  cam.camera.lookAtTarget = {
    nodeId,
    offset: {
      x: lookAt.x - origin.x,
      y: lookAt.y - origin.y,
      z: lookAt.z - origin.z,
    },
  }
}

function applyFollowBinding(
  host: LibraryHost,
  doc: DirectorDocument,
  cam: DraftNode,
  subjectId: string,
): string | null {
  if (!cam.camera) return 'missing-camera'
  const subject = subjectPoseAtCurrentFrame(host, doc, subjectId)
  if (!subject) return 'subject-missing'
  const camPose = cameraPoseAtCurrentFrame(host, cam.id)
  const worldPos = camPose?.position ?? cam.transform.position
  const lookAt = camPose?.lookAt ?? cam.camera.lookAt
  const yawDeg = subjectYawDeg(subject.rotation)
  const offset = subjectWorldToLocal(worldPos, subject.position, yawDeg)
  const lookAtOffset = subjectWorldToLocal(lookAt ?? subject.position, subject.position, yawDeg)
  cam.camera.subject = {
    nodeId: subjectId,
    distance: lookAtDistance(worldPos, lookAt ?? subject.position),
    offset,
    lookAtOffset,
    follow: true,
    followRotation: true,
    overridesMotion: true,
  }
  return null
}

function persistCameraLookAt(host: LibraryHost, cam: DraftNode, lookAt: Vec3): void {
  applyCameraUserEdit(host, cam, { lookAt })
  const pos = cameraPoseAtCurrentFrame(host, cam.id)?.position ?? cam.transform.position
  host.engine.applyLiveCameraPose(cam.id, pos, lookAt)
  const live = cameraPoseAtCurrentFrame(host, cam.id)
  if (live?.rotation) applyCameraUserEdit(host, cam, { rotation: live.rotation })
}

function persistCameraFov(host: LibraryHost, cam: DraftNode, fov: number): void {
  const next = clampCameraFov(fov)
  // 已有 userKeys / 自动关键帧：走 pending 或立刻打键。只在官方 fcurves
  // 盖住静态、且自动关键帧关闭时才暂存。
  if (
    shouldStageCamera(host, cam)
    && !host.editor.autoKeyframe
    && !nodeHasUserXformKeys(host.docModel.userKeys, cam.id)
  ) {
    stageCameraPose(host, cam.id, { fov: next })
    return
  }
  applyCameraUserEdit(host, cam, { fov: next })
  host.engine.applyLiveCameraFov(cam.id, next)
}

/** 点机位后清掉旧曲线并钉住新 pose，求值才不会回到上一个机位 */
function pinAppliedCameraPose(host: LibraryHost, cam: DraftNode): void {
  clearCameraUserPoseKeys(host, cam.id)
  let fc = host.docModel.fcurves
  if (fc) {
    fc.removeTracks(cam.id, ['transform.position', 'transform.rotation', 'camera.lookAt', 'camera.fov'])
    host.docModel.setFcurves(fc)
    host.engine.setFcurves(fc)
  }
  if (!cam.camera) return
  persistFreeCameraWorldPose(host, cam, cam.transform.position, cam.camera.lookAt)
  persistCameraFov(host, cam, cam.camera.fov)
}

function bindSubjectWithoutFollow(
  host: LibraryHost,
  doc: DirectorDocument,
  cam: DraftNode,
  subjectId: string,
): NonNullable<NonNullable<DraftNode['camera']>['subject']> | null {
  if (!cam.camera) return null
  const subject = subjectPoseAtCurrentFrame(host, doc, subjectId)
  if (!subject) return null
  const camPose = cameraPoseAtCurrentFrame(host, cam.id)
  const worldPos = camPose?.position ?? cam.transform.position
  const lookAt = camPose?.lookAt ?? cam.camera.lookAt
  const yawDeg = subjectYawDeg(subject.rotation)
  const offset = subjectWorldToLocal(worldPos, subject.position, yawDeg)
  const lookAtOffset = subjectWorldToLocal(lookAt ?? subject.position, subject.position, yawDeg)
  cam.camera.subject = {
    nodeId: subjectId,
    distance: lookAtDistance(worldPos, lookAt ?? subject.position),
    offset,
    lookAtOffset,
    follow: false,
    followRotation: true,
    overridesMotion: true,
  }
  return cam.camera.subject
}

/** 刚体平移的看点：注视点随相机等量位移，视线方向不变。 */
function translatedLookAt(lookAt: Vec3, from: Vec3, to: Vec3): Vec3 {
  return {
    x: lookAt.x + (to.x - from.x),
    y: lookAt.y + (to.y - from.y),
    z: lookAt.z + (to.z - from.z),
  }
}

function lookAtDistance(pos: Vec3, lookAt: Vec3): number {
  return Math.hypot(pos.x - lookAt.x, pos.y - lookAt.y, pos.z - lookAt.z) || 1
}

/** 沿「看点 → 机位」射线缩放，俯仰 / 方位角不变。 */
function dollyTowardLookAt(pos: Vec3, lookAt: Vec3, distance: number): Vec3 {
  const dx = pos.x - lookAt.x
  const dy = pos.y - lookAt.y
  const dz = pos.z - lookAt.z
  const old = Math.hypot(dx, dy, dz)
  if (old < 1e-6) return { x: lookAt.x, y: lookAt.y, z: lookAt.z + distance }
  const scale = distance / old
  return { x: lookAt.x + dx * scale, y: lookAt.y + dy * scale, z: lookAt.z + dz * scale }
}

export function setCameraSubjectDistance(
  host: LibraryHost,
  distance: number,
  cameraId?: string,
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const cam = cameraById(doc, cameraId, host.editor.activeCameraId)
  if (!cam?.camera) return 'missing-camera'
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  const nextDist = Math.max(0.1, distance)
  let binding = cam.camera.subject
  if (!binding) {
    const subjectId = cam.camera.lookAtTarget?.nodeId
    if (subjectId) {
      const next = bindSubjectWithoutFollow(host, doc, cam, subjectId)
      if (!next) return 'subject-missing'
      binding = next
    }
  }
  const camPose = cameraPoseAtCurrentFrame(host, cam.id)
  const worldPos = camPose?.position ?? cam.transform.position
  const lookAt = camPose?.lookAt ?? cam.camera.lookAt
  const nextPos = dollyTowardLookAt(worldPos, lookAt, nextDist)
  if (binding) {
    const subject = subjectPoseAtCurrentFrame(host, doc, binding.nodeId)
    if (!subject) return 'subject-missing'
    const yawDeg = binding.followRotation ? subjectYawDeg(subject.rotation) : 0
    binding.offset = subjectWorldToLocal(nextPos, subject.position, yawDeg)
    binding.lookAtOffset = subjectWorldToLocal(lookAt, subject.position, yawDeg)
    binding.distance = nextDist
  }
  if (binding?.follow) {
    cam.transform.position = nextPos
    cam.camera.lookAt = lookAt
    host.engine.applyLiveCameraPose(cam.id, nextPos, lookAt)
  } else {
    persistFreeCameraWorldPose(host, cam, nextPos, lookAt)
  }
  host.docModel.touch()
  host.pushDocSnapshot('调整距离', before, `subject-distance:${cam.id}`)
  return null
}

/** 解除绑定：把相机留在当前帧算出来的位置上，之后不再跟人物走 */
export function clearCameraSubject(host: LibraryHost, cameraId?: string): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const cam = cameraById(doc, cameraId, host.editor.activeCameraId)
  if (!cam?.camera?.subject) return 'camera-not-bound'
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  syncCameraNodeToCurrentFrame(host, cam)
  persistFreeCameraWorldPose(host, cam, cam.transform.position, cam.camera.lookAt)
  delete cam.camera.subject
  host.docModel.touch()
  host.pushDocSnapshot('解除机位跟随', before)
  return null
}

function subjectPoseAtCurrentFrame(
  host: LibraryHost,
  doc: DirectorDocument,
  subjectId: string,
): { position: Vec3; rotation: Vec3 } | null {
  const node = doc.content.nodes.find((n) => n.id === subjectId)
  if (!node) return null
  const evaluated = host.engine.getNodeSnapshot(subjectId)
  if (evaluated && evaluated.position.length >= 3 && evaluated.rotation.length >= 3) {
    const [px, py, pz] = evaluated.position
    const [rx, ry, rz] = evaluated.rotation
    if ([px, py, pz, rx, ry, rz].every(Number.isFinite)) {
      return {
        position: { x: px, y: py, z: pz },
        rotation: { x: rx, y: ry, z: rz },
      }
    }
  }
  return { position: node.transform.position, rotation: node.transform.rotation }
}

/**
 * 把相机拖到世界坐标 `worldPos`。
 * 勾了跟随：改相对人物的 offset；没勾：直接写静态 transform，下一帧求值才不会弹回旧位置。
 */
export function writeCameraWorldPos(
  host: LibraryHost,
  cameraId: string,
  worldPos: Vec3,
  commit: boolean,
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const cam = doc.content.nodes.find((n) => n.id === cameraId && n.type === 'camera')
  if (!cam?.camera) return 'missing-camera'
  const before = commit ? snapshotDocState(host.docModel) : null
  const binding = cam.camera.subject
  if (binding?.follow) {
    const subject = subjectPoseAtCurrentFrame(host, doc, binding.nodeId)
    if (!subject) return 'subject-missing'
    const yawDeg = binding.followRotation ? subjectYawDeg(subject.rotation) : 0
    const pose = resolveSubjectCameraPose(
      { ...binding, offset: subjectWorldToLocal(worldPos, subject.position, yawDeg) },
      subject.position,
      subject.rotation,
    )
    if (host.capturePendingTransform(cameraId, {
      position: [pose.position.x, pose.position.y, pose.position.z],
      lookAt: [pose.lookAt.x, pose.lookAt.y, pose.lookAt.z],
    })) {
      host.engine.applyLiveCameraPose(cameraId, pose.position, pose.lookAt)
      return null
    }
    binding.offset = subjectWorldToLocal(worldPos, subject.position, yawDeg)
    binding.distance = lookAtDistance(pose.position, pose.lookAt)
    cam.transform.position = pose.position
    cam.camera.lookAt = pose.lookAt
    host.engine.applyLiveCameraPose(cameraId, pose.position, pose.lookAt)
  } else if (nodeHasUserXformKeys(host.docModel.userKeys, cameraId)) {
    // 有关键帧的机位同样是刚体平移：看点等量位移、旋转冻结，否则改键会把朝向拧偏。
    const live = cameraPoseAtCurrentFrame(host, cam.id)
    const oldPos = live?.position ?? cam.transform.position
    const oldLook = live?.lookAt ?? cam.camera.lookAt
    if (!cam.camera.lookAtTarget?.nodeId && oldLook) {
      const oldRot = live?.rotation ?? cam.transform.rotation
      persistFreeCameraWorldPose(host, cam, worldPos, translatedLookAt(oldLook, oldPos, worldPos), oldRot)
    } else {
      persistFreeCameraWorldPose(host, cam, worldPos, oldLook ?? cam.camera.lookAt)
    }
    return null
  } else {
    const live = cameraPoseAtCurrentFrame(host, cam.id)
    const oldPos = live?.position ?? cam.transform.position
    const oldLook = live?.lookAt ?? cam.camera.lookAt
    const oldRot = live?.rotation ?? cam.transform.rotation
    if (shouldStageCamera(host, cam) && oldLook) {
      const nextLook: Vec3 = cam.camera.lookAtTarget?.nodeId
        ? oldLook
        : translatedLookAt(oldLook, oldPos, worldPos)
      stageCameraPose(host, cam.id, { position: worldPos, lookAt: nextLook, rotation: oldRot })
      return null
    }
    // 未钉看点目标：纯刚体平移——看点标记随相机等量位移，旋转绝对冻结。
    const unboundLookPoint = !cam.camera.lookAtTarget?.nodeId
    if (unboundLookPoint && oldLook) {
      const nextLook = translatedLookAt(oldLook, oldPos, worldPos)
      persistFreeCameraWorldPose(host, cam, worldPos, nextLook, oldRot)
      if (binding) {
        const subject = subjectPoseAtCurrentFrame(host, doc, binding.nodeId)
        if (subject) {
          const yawDeg = binding.followRotation ? subjectYawDeg(subject.rotation) : 0
          binding.offset = subjectWorldToLocal(worldPos, subject.position, yawDeg)
          binding.distance = lookAtDistance(worldPos, nextLook)
        }
      }
    } else {
      persistFreeCameraWorldPose(host, cam, worldPos, oldLook ?? cam.camera.lookAt)
      if (binding) {
        const subject = subjectPoseAtCurrentFrame(host, doc, binding.nodeId)
        if (subject) {
          const yawDeg = binding.followRotation ? subjectYawDeg(subject.rotation) : 0
          binding.offset = subjectWorldToLocal(worldPos, subject.position, yawDeg)
          binding.distance = lookAtDistance(worldPos, oldLook ?? cam.camera.lookAt)
        }
      }
    }
  }
  if (autoKeyAlreadyPersisted(host, cameraId)) return null
  host.docModel.touch()
  if (commit && before)
    host.pushDocSnapshot(binding?.follow ? '调整跟随机位' : '移动相机', before, `camera-pos:${cameraId}`)
  return null
}

function persistCameraRotation(host: LibraryHost, cam: DraftNode, rot: Vec3, lookAt: Vec3): void {
  applyCameraUserEdit(host, cam, { rotation: rot, lookAt })
  const pos = cameraPoseAtCurrentFrame(host, cam.id)?.position ?? cam.transform.position
  host.engine.applyLiveCameraPose(cam.id, pos, lookAt, rot)
}

/**
 * 旋转拍摄方向：相机位置不动，只改 lookAt。
 * 勾了跟随：改 lookAtOffset；没勾：钉住世界看点。
 */
export function writeCameraLookAt(
  host: LibraryHost,
  cameraId: string,
  lookAt: Vec3,
  commit: boolean,
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const cam = doc.content.nodes.find((n) => n.id === cameraId && n.type === 'camera')
  if (!cam?.camera) return 'missing-camera'
  if (shouldStageCamera(host, cam)) {
    const live = cameraPoseAtCurrentFrame(host, cam.id)
    stageCameraPose(host, cam.id, {
      position: live?.position ?? cam.transform.position,
      lookAt,
      rotation: live?.rotation ?? cam.transform.rotation,
    })
    return null
  }
  const before = commit ? snapshotDocState(host.docModel) : null
  const binding = cam.camera.subject
  if (binding?.follow) {
    const subject = subjectPoseAtCurrentFrame(host, doc, binding.nodeId)
    if (!subject) return 'subject-missing'
    const yawDeg = binding.followRotation ? subjectYawDeg(subject.rotation) : 0
    const nextBinding = {
      ...binding,
      lookAtOffset: subjectWorldToLocal(lookAt, subject.position, yawDeg),
    }
    const pose = resolveSubjectCameraPose(nextBinding, subject.position, subject.rotation)
    if (host.capturePendingTransform(cameraId, {
      lookAt: [pose.lookAt.x, pose.lookAt.y, pose.lookAt.z],
    })) {
      host.engine.applyLiveCameraPose(cameraId, pose.position, pose.lookAt)
      return null
    }
    syncLookAtTargetOffset(host, cam, lookAt)
    binding.lookAtOffset = nextBinding.lookAtOffset
    cam.camera.lookAt = pose.lookAt
    host.engine.applyLiveCameraPose(cameraId, pose.position, pose.lookAt)
  } else if (nodeHasUserXformKeys(host.docModel.userKeys, cameraId)) {
    persistCameraLookAt(host, cam, lookAt)
    return null
  } else {
    syncLookAtTargetOffset(host, cam, lookAt)
    persistCameraLookAt(host, cam, lookAt)
    if (binding) {
      const subject = subjectPoseAtCurrentFrame(host, doc, binding.nodeId)
      if (subject) {
        const yawDeg = binding.followRotation ? subjectYawDeg(subject.rotation) : 0
        binding.lookAtOffset = subjectWorldToLocal(lookAt, subject.position, yawDeg)
      }
    }
  }
  if (autoKeyAlreadyPersisted(host, cameraId)) return null
  host.docModel.touch()
  if (commit && before) host.pushDocSnapshot('旋转相机', before, `camera-lookat:${cameraId}`)
  return null
}

/**
 * 按相机物体欧拉 XYZ（度）改朝向：位置不动，重算 lookAt，上机走 lookAt()。
 * 旋转和注视坐标联动，定向以注视点为准。
 */
export function writeCameraRotation(
  host: LibraryHost,
  cameraId: string,
  rotDeg: Vec3,
  commit: boolean,
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const cam = doc.content.nodes.find((n) => n.id === cameraId && n.type === 'camera')
  if (!cam?.camera) return 'missing-camera'
  const before = commit ? snapshotDocState(host.docModel) : null
  const live = cameraPoseAtCurrentFrame(host, cam.id)
  const pos = live?.position ?? cam.transform.position
  const currentLook = live?.lookAt ?? cam.camera.lookAt
  const nextLook = manualCameraLookAt(pos, rotDeg, lookDistance(pos, currentLook))
  const keepsAim = currentLook && sameCameraAim(pos, currentLook, nextLook)
  const lookAt = keepsAim ? currentLook : nextLook
  const followedSubject = cam.camera.subject?.follow
    ? subjectPoseAtCurrentFrame(host, doc, cam.camera.subject.nodeId)
    : null
  if (cam.camera.subject?.follow && !followedSubject) return 'subject-missing'
  const detached = Boolean(cam.camera.lookAtTarget && !keepsAim)
  if (detached) {
    clearLookAtTarget(cam)
    host.queueCameraAimReleased()
    // A non-following subject is only a cached look-at target. Keep positional follow independently.
    if (!cam.camera.subject?.follow) delete cam.camera.subject
  }
  const finishDetached = () => {
    if (!detached) return
    host.docModel.touch()
    if (commit && before) host.pushDocSnapshot('旋转相机', before, `camera-rot:${cameraId}`)
  }
  const binding = cam.camera.subject
  if (binding?.follow && followedSubject) {
    const subject = followedSubject
    const yawDeg = binding.followRotation ? subjectYawDeg(subject.rotation) : 0
    // Follow remains a translation relative to the same subject after aim is released.
    binding.lookAtOffset = subjectWorldToLocal(lookAt, subject.position, yawDeg)
    if (host.capturePendingTransform(cameraId, {
      rotation: [rotDeg.x, rotDeg.y, rotDeg.z],
      lookAt: [lookAt.x, lookAt.y, lookAt.z],
    })) {
      finishDetached()
      host.engine.applyLiveCameraPose(cameraId, pos, lookAt, rotDeg)
      return null
    }
    cam.transform.rotation = { x: rotDeg.x, y: rotDeg.y, z: rotDeg.z }
    cam.camera.lookAt = lookAt
    host.engine.applyLiveCameraPose(cameraId, pos, lookAt, rotDeg)
  } else if (nodeHasUserXformKeys(host.docModel.userKeys, cameraId)) {
    persistCameraRotation(host, cam, rotDeg, lookAt)
    finishDetached()
    return null
  } else {
    persistCameraRotation(host, cam, rotDeg, lookAt)
    if (binding) {
      const subject = subjectPoseAtCurrentFrame(host, doc, binding.nodeId)
      if (subject) {
        const yawDeg = binding.followRotation ? subjectYawDeg(subject.rotation) : 0
        binding.lookAtOffset = subjectWorldToLocal(lookAt, subject.position, yawDeg)
      }
    }
  }
  if (autoKeyAlreadyPersisted(host, cameraId)) {
    finishDetached()
    return null
  }
  host.docModel.touch()
  if (commit && before) host.pushDocSnapshot('旋转相机', before, `camera-rot:${cameraId}`)
  return null
}

/**
 * 第一人称操控结束：把飞过的世界位置和视线写成一笔机位。
 * 跟随中的相机改相对偏移，避免下一帧求值弹回旧机位。
 */
export function commitCameraPilotPose(
  host: LibraryHost,
  cameraId: string,
  worldPos: Vec3,
  lookAt: Vec3,
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const cam = doc.content.nodes.find((n) => n.id === cameraId && n.type === 'camera')
  if (!cam?.camera) return 'missing-camera'
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  const binding = cam.camera.subject
  if (binding?.follow) {
    const subject = subjectPoseAtCurrentFrame(host, doc, binding.nodeId)
    if (!subject) return 'subject-missing'
    const yawDeg = binding.followRotation ? subjectYawDeg(subject.rotation) : 0
    binding.offset = subjectWorldToLocal(worldPos, subject.position, yawDeg)
    binding.lookAtOffset = subjectWorldToLocal(lookAt, subject.position, yawDeg)
    binding.distance = lookAtDistance(worldPos, lookAt)
  }
  const live = cameraPoseAtCurrentFrame(host, cam.id)
  const currentLook = live?.lookAt ?? cam.camera.lookAt
  const aimMoved = !currentLook || !sameCameraAim(worldPos, currentLook, lookAt)
  if (cam.camera.lookAtTarget && aimMoved) {
    clearLookAtTarget(cam)
    if (!cam.camera.subject?.follow) delete cam.camera.subject
    host.queueCameraAimReleased()
  } else if (cam.camera.lookAtTarget) {
    syncLookAtTargetOffset(host, cam, lookAt)
  }
  persistFreeCameraWorldPose(host, cam, worldPos, lookAt)
  if (autoKeyAlreadyPersisted(host, cameraId)) return null
  host.docModel.touch()
  host.pushDocSnapshot('操控相机', before, `camera-pilot:${cameraId}`)
  return null
}

/** 镜头视野（垂直 FOV，12–120°）。已有键则改键，否则写静态 fov，不自动打关键帧。 */
export function setCameraFov(host: LibraryHost, fov: number, cameraId?: string): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const cam = cameraById(doc, cameraId, host.editor.activeCameraId)
  if (!cam?.camera) return 'missing-camera'
  if (nodeHasUserXformKeys(host.docModel.userKeys, cam.id)) {
    persistCameraFov(host, cam, fov)
    return null
  }
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  persistCameraFov(host, cam, fov)
  if (autoKeyAlreadyPersisted(host, cam.id)) return null
  host.docModel.touch()
  host.pushDocSnapshot('调整镜头视野', before, `fov:${cam.id}`)
  return null
}

/** @deprecated 用 writeCameraWorldPos；跟随时仍走相对偏移 */
export function applyFollowingCameraWorldPos(
  host: LibraryHost,
  cameraId: string,
  worldPos: Vec3,
  commit: boolean,
): string | null {
  return writeCameraWorldPos(host, cameraId, worldPos, commit)
}

/** 勾选 / 取消「跟随」。看点和跟随是同一个人；打开时按当前机位重算相对偏移。 */
export function setCameraFollow(
  host: LibraryHost,
  follow: boolean,
  cameraId?: string,
  subjectId?: string,
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const cam = cameraById(doc, cameraId, host.editor.activeCameraId)
  if (!cam?.camera) return 'missing-camera'
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  if (follow) {
    const binding = cam.camera.subject
    const selected = selectedNodeOfType(doc, host.editor.selection, 'character')
    const nextSubjectId =
      subjectId ?? cam.camera.lookAtTarget?.nodeId ?? binding?.nodeId ?? selected?.id
    if (!nextSubjectId) return 'no-subject'
    const subject = subjectPoseAtCurrentFrame(host, doc, nextSubjectId)
    if (!subject) return 'subject-missing'
    const err = applyFollowBinding(host, doc, cam, nextSubjectId)
    if (err) return err
    const lookAt = cameraPoseAtCurrentFrame(host, cam.id)?.lookAt ?? cam.camera.lookAt
    pinLookAtTarget(host, cam, nextSubjectId, lookAt ?? characterLookAtPoint(subject.position))
  } else if (cam.camera.subject) {
    syncCameraNodeToCurrentFrame(host, cam)
    persistFreeCameraWorldPose(host, cam, cam.transform.position, cam.camera.lookAt)
    cam.camera.subject.follow = false
  } else {
    return 'camera-not-bound'
  }
  host.docModel.touch()
  host.pushDocSnapshot(follow ? '开启机位跟随' : '关闭机位跟随', before)
  return null
}

/** 看点绑到人物或清成自由点。跟随永远跟这个人；清掉看点人物时同时关掉跟随。 */
export function setCameraLookAtTarget(
  host: LibraryHost,
  cameraId: string,
  nodeId: string | null,
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const cam = doc.content.nodes.find((n) => n.id === cameraId && n.type === 'camera')
  if (!cam?.camera) return 'missing-camera'
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  if (!nodeId) {
    clearLookAtTarget(cam)
    if (cam.camera.subject) {
      if (cam.camera.subject.follow) {
        syncCameraNodeToCurrentFrame(host, cam)
        persistFreeCameraWorldPose(host, cam, cam.transform.position, cam.camera.lookAt)
      }
      delete cam.camera.subject
    }
    host.docModel.touch()
    host.pushDocSnapshot('看点改为坐标', before)
    return null
  }
  const subject = subjectPoseAtCurrentFrame(host, doc, nodeId)
  if (!subject) return 'subject-missing'
  const keepFollow = Boolean(cam.camera.subject?.follow)
  const aim = host.engine.worldAimPoint(nodeId)
  const lookAt = aim ?? characterLookAtPoint(subject.position)
  persistCameraLookAt(host, cam, lookAt)
  pinLookAtTarget(host, cam, nodeId, lookAt)
  if (keepFollow) {
    const err = applyFollowBinding(host, doc, cam, nodeId)
    if (err) return err
  } else {
    bindSubjectWithoutFollow(host, doc, cam, nodeId)
  }
  host.docModel.touch()
  host.pushDocSnapshot('看点跟随人物', before)
  return null
}

function isPlaceableNode(node: DraftNode): boolean {
  return node.type === 'character' || node.type === 'prop' || node.type === 'primitive'
}

function currentWorldPos(
  host: LibraryHost,
  node: DraftNode,
): { x: number; y: number; z: number } {
  const snap = host.engine.getNodeSnapshot(node.id)
  return {
    x: snap?.position[0] ?? node.transform.position.x,
    y: snap?.position[1] ?? node.transform.position.y,
    z: snap?.position[2] ?? node.transform.position.z,
  }
}

function commitPlacedPosition(
  host: LibraryHost,
  node: DraftNode,
  pos: { x: number; y: number; z: number },
  label: string,
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  if (shouldStageNode(host, node.id)) {
    host.engine.setStagedTransform(node.id, { position: pos })
    host.engine.applyLiveNodeTransform(node.id, { position: pos })
    return null
  }
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  if (host.capturePendingTransform(node.id, { position: [pos.x, pos.y, pos.z] })) {
    host.engine.applyLiveNodeTransform(node.id, { position: pos })
    return null
  }
  node.transform.position = pos
  const frame = Math.round(host.engine.currentFrame)
  // 放置同样是变换编辑：不自动打关键帧——当前帧已有用户 position 键
  // 则更新键值，否则只写静态 transform；官方 fcurves 层不改。
  const result = applyTransformEdit(doc, host.docModel.userKeys, node.id, frame, {
    position: [pos.x, pos.y, pos.z],
  })
  if (result.posKeyUpdated) {
    rederiveWalkPaths(doc, node.id, host.docModel.fcurves ?? FCurveSet.empty(), result.userKeys)
    host.engine.syncPathNodes()
  }
  host.docModel.setUserKeys(result.userKeys)
  host.engine.applyLiveNodeTransform(node.id, { position: pos })
  host.docModel.touch()
  host.pushDocSnapshot(label, before)
  return null
}

export function placeNodeOnGround(host: LibraryHost, nodeId: string): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const node = doc.content.nodes.find((n) => n.id === nodeId)
  if (!node) return 'node-not-found'
  if (node.locked) return 'node-locked'
  if (!isPlaceableNode(node)) return 'unsupported'
  const contactY = host.engine.worldContactY(nodeId)
  if (contactY === null) return 'no-bounds'
  const groundY = doc.content.environment.display.groundHeight ?? 0
  const delta = groundY - contactY
  if (Math.abs(delta) < 1e-4) return null
  const pos = currentWorldPos(host, node)
  return commitPlacedPosition(host, node, { x: pos.x, y: pos.y + delta, z: pos.z }, '放置在地面')
}

export function placeNodeOnSupport(
  host: LibraryHost,
  nodeId: string,
  supportId: string,
): string | null {
  if (!supportId || nodeId === supportId) return 'same-node'
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const node = doc.content.nodes.find((n) => n.id === nodeId)
  const support = doc.content.nodes.find((n) => n.id === supportId)
  if (!node || !support) return 'node-not-found'
  if (node.locked) return 'node-locked'
  if (!isPlaceableNode(node) || !isPlaceableNode(support)) return 'unsupported'
  const contact = host.engine.worldContactPoint(nodeId)
  const supportBox = host.engine.worldAabb(supportId)
  const hits = host.engine.meshSupportHits(supportId) ?? []
  if (!contact) return 'no-bounds'
  if (!supportBox && hits.length === 0) return 'no-bounds'
  const height = supportBox ? Math.max(1e-4, supportBox.maxY - supportBox.minY) : 1
  const fallback = supportBox
    ? { x: supportBox.centerX, y: supportBox.maxY, z: supportBox.centerZ }
    : hits[0]
  const minHitY = supportBox ? supportBox.minY + height * 0.4 : Number.NEGATIVE_INFINITY
  const rest = pickTopSurfaceRest(highSupportHits(hits, minHitY), fallback, height)
  const pos = currentWorldPos(host, node)
  const next = seatOnSupport({
    moverPos: pos,
    moverContact: contact,
    supportRest: rest,
  })
  if (
    Math.abs(next.x - pos.x) < 1e-4 &&
    Math.abs(next.y - pos.y) < 1e-4 &&
    Math.abs(next.z - pos.z) < 1e-4
  ) {
    return null
  }
  return commitPlacedPosition(host, node, next, '放到节点上方')
}

export function renameNode(host: LibraryHost, nodeId: string, name: string): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const trimmed = name.trim()
  if (!trimmed) return 'empty-name'
  const node = doc.content.nodes.find((n) => n.id === nodeId)
  if (!node) return 'node-not-found'
  if (node.name === trimmed) return null
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  node.name = trimmed
  host.docModel.touch()
  host.pushDocSnapshot('重命名节点', before)
  return null
}


/** Build a camera from the live editor view (falls back to the `current` preset pose). */
function buildCameraFromEditorView(host: LibraryHost, doc: DirectorDocument): DraftNode {
  const preset = CAMERA_PRESETS.find((p) => p.id === 'current')
  const liveView = host.engine.captureEditorView()
  const pose = liveView ?? {
    position: { ...(preset?.position ?? { x: 0, y: 1.6, z: 4 }) },
    rotation: { ...(preset?.rotation ?? { x: 0, y: 0, z: 0 }) },
    lookAt: { ...(preset?.lookAt ?? { x: 0, y: 1.2, z: 0 }) },
    fov: preset?.fov ?? 50,
  }
  const baseName = preset?.name ?? 'Camera'
  const node: DraftNode = {
    id: nextIndexedId(doc.content.nodes.map((item) => item.id), 'user_cam_'),
    type: 'camera',
    name: uniqueNodeName(doc, baseName),
    visible: true,
    locked: false,
    transform: {
      position: { ...pose.position },
      rotation: { ...pose.rotation },
      scale: { x: 1, y: 1, z: 1 },
    },
    camera: {
      projection: 'perspective',
      fov: pose.fov,
      fovAxis: 'vertical',
      near: 0.1,
      far: 2000,
      isPrimary: false,
      lookAt: { ...pose.lookAt },
    },
  }
  node.name = uniqueNodeName(doc, baseName)
  return node
}

/**
 * 新运镜的落点：同一台相机已有运镜时接在最后一段之后并贴紧（frameStart = 上一段 frameEnd），
 * 否则用当前帧。播放头已经在整条轨道之后时按播放头走。避免连点两次运镜叠在同一帧上。
 */
function nextCameraMotionStart(doc: DirectorDocument, cameraId: string, playhead: number): number {
  const track = doc.content.timeline.animation.cameraMotionClips.filter(
    (c) => c.target.nodeId === cameraId,
  )
  if (track.length === 0) return playhead
  return Math.max(playhead, ...track.map((c) => c.frameEnd))
}

/**
 * 接在已有运镜后面时，起始机位要取上一段结束时的位姿，否则新片段会从静态机位起烘焙，
 * 拼接处会跳一下。startFrame 没有落在任何已有运镜上就返回 null（沿用静态机位）。
 */
function cameraMotionHandoffPose(
  doc: DirectorDocument,
  cam: DraftNode,
  startFrame: number,
): { position: Vec3; lookAt: Vec3; fov: number } | null {
  const clips = doc.content.timeline.animation.cameraMotionClips
  const covered = clips.some(
    (c) => c.target.nodeId === cam.id && startFrame >= c.frameStart && startFrame <= c.frameEnd,
  )
  if (!covered) return null
  const pose = evaluateCameraPose(cam, clips, startFrame, doc.content.timeline.fps)
  const values = [...pose.position, ...pose.lookAt, pose.fov]
  if (!values.every(Number.isFinite)) return null
  return {
    position: { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
    lookAt: { x: pose.lookAt[0], y: pose.lookAt[1], z: pose.lookAt[2] },
    fov: pose.fov,
  }
}

export function applyCameraMotion(host: LibraryHost, presetId: string): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const preset = CAMERA_MOTIONS.find((p) => p.id === presetId)
  if (!preset) return 'preset-not-found'
  let cam = resolveTargetCamera(doc, host.editor.activeCameraId)
  // Empty scene: spawn a camera from the current viewport, then apply the motion to it.
  let createdCam: DraftNode | null = null
  if (!cam) {
    createdCam = buildCameraFromEditorView(host, doc)
    cam = createdCam
  }
  const targetNode = resolveMotionTargetCharacter(host, doc, cam)
  const startFrame = nextCameraMotionStart(doc, cam.id, Math.round(host.engine.currentFrame))
  // 跟随中的相机要按当前帧的实际机位烘焙，运镜才从眼下看到的位置起步，
  // 而不是从绑定那一刻的旧位置跳过去。烘焙可能失败，所以先用副本喂进去。
  const handoffPose = cameraMotionHandoffPose(doc, cam, startFrame)
  const followPose = handoffPose ?? (cam.camera?.subject ? cameraPoseAtCurrentFrame(host, cam.id) : null)
  const bakeCam = followPose
    ? {
        ...cam,
        transform: { ...cam.transform, position: followPose.position },
        camera: cam.camera
          ? {
              ...cam.camera,
              lookAt: followPose.lookAt ?? cam.camera.lookAt,
              fov: handoffPose ? handoffPose.fov : cam.camera.fov,
            }
          : undefined,
      }
    : cam
  const result = bakeCameraMotionClip(
    preset,
    { cameraNode: bakeCam, targetNode, doc },
    startFrame,
  )
  if (!result.ok || !result.clip) return result.reason ?? 'bake-failed'
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  const clip = result.clip
  if (createdCam) {
    doc.content.nodes.push(createdCam)
  }
  if (cam.camera?.subject) {
    syncCameraNodeToCurrentFrame(host, cam)
    // 后设置的优先级高：这条运镜比绑定新，交给它接管覆盖到的帧。
    cam.camera.subject.overridesMotion = false
  }
  const anim = doc.content.timeline.animation
  anim.cameraMotionClips = [...anim.cameraMotionClips, clip]
  host.docModel.touch()
  host.pushDocSnapshot(createdCam ? '新建相机并应用运镜' : '应用运镜', before)
  host.editor.select({ kind: 'clip', clipType: 'camera', clipId: clip.id })
  host.editor.setActiveCamera(cam.id)
  return null
}

export function updateCameraMotionConfig(
  host: LibraryHost,
  clipId: string,
  patch: Record<string, number | string>,
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const anim = doc.content.timeline.animation
  const idx = anim.cameraMotionClips.findIndex((c) => c.id === clipId)
  if (idx < 0) return 'clip-not-found'
  const old = anim.cameraMotionClips[idx]
  const preset = CAMERA_MOTIONS.find((p) => p.id === old.motion.presetId)
  if (!preset) return 'preset-not-found'
  const cam = doc.content.nodes.find((n) => n.id === old.target.nodeId)
  if (!cam) return 'missing-camera'
  const targetId = old.motion.metadata?.targetNodeId
  const targetNode = targetId ? (doc.content.nodes.find((n) => n.id === targetId) ?? null) : null
  // Frame span is the duration source of truth after inspector range edits / timeline resize.
  // When the caller does not patch durationMs, rebake from the live clip length so strength /
  // easing tweaks do not collapse a stretched clip back to a stale config.durationMs.
  const fps = doc.content.timeline.fps
  const spanMs = Math.max(1, Math.round(((old.frameEnd - old.frameStart) * 1000) / fps))
  const baseConfig = { ...(old.motion.metadata?.config ?? {}) } as Record<string, number | string>
  if (!('durationMs' in patch)) baseConfig.durationMs = spanMs
  const merged = { ...baseConfig, ...patch }
  const result = bakeCameraMotionClip(preset, { cameraNode: cam, targetNode, doc }, old.frameStart, merged)
  if (!result.ok || !result.clip) return result.reason ?? 'bake-failed'
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  const next = { ...result.clip, id: old.id }
  // Panel duration (and any rebake that changes span) ripples subsequent same-camera clips
  // so gaps stay intact — shared with timeline resize via rippleShiftClipsAfter.
  const delta = next.frameEnd - old.frameEnd
  const trackClips = anim.cameraMotionClips.filter((c) => c.target.nodeId === old.target.nodeId)
  const shifts = rippleShiftClipsAfter(trackClips, old.id, delta)
  anim.cameraMotionClips = anim.cameraMotionClips.map((c) => {
    if (c.id === old.id) return next
    const pos = shifts[c.id]
    return pos ? { ...c, frameStart: pos.frameStart, frameEnd: pos.frameEnd } : c
  })
  host.docModel.touch()
  host.pushDocSnapshot('改运镜参数', before, `camera-clip-config:${clipId}`)
  return null
}

export function resizeCameraMotionClip(
  host: LibraryHost,
  clipId: string,
  edge: 'start' | 'end',
  frame: number,
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const anim = doc.content.timeline.animation
  const old = anim.cameraMotionClips.find((c) => c.id === clipId)
  if (!old) return 'clip-not-found'
  const track = anim.cameraMotionClips.filter((c) => c.target.nodeId === old.target.nodeId)
  const layout = rippleResizeClip(
    track, clipId, edge, frame, doc.content.timeline.frameStart, doc.content.timeline.frameEnd,
  )
  if (!layout) return 'resize-failed'
  const pos = layout.positions[clipId]
  if (!pos) return 'resize-failed'
  if (pos.frameStart === old.frameStart && pos.frameEnd === old.frameEnd) return null
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  anim.cameraMotionClips = anim.cameraMotionClips.map((c) => {
    const next = layout.positions[c.id]
    return next ? { ...c, frameStart: next.frameStart, frameEnd: next.frameEnd } : c
  })
  host.docModel.touch()
  host.pushDocSnapshot('调整运镜范围', before, `camera-clip-range:${clipId}`)
  return null
}

export function addCameraFromPreset(host: LibraryHost, presetId: string, name?: string): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const preset = CAMERA_PRESETS.find((p) => p.id === presetId)
  if (!preset) return 'preset-not-found'
  if (presetId === 'current') {
    const liveView = host.engine.captureEditorView()
    const pose = liveView ?? {
      position: { ...preset.position },
      rotation: { ...preset.rotation },
      lookAt: { ...preset.lookAt },
      fov: preset.fov,
    }
    const node: DraftNode = {
      id: nextIndexedId(doc.content.nodes.map((item) => item.id), 'user_cam_'),
      type: 'camera',
      name: uniqueNodeName(doc, name ?? preset.name),
      visible: true,
      locked: false,
      transform: {
        position: { ...pose.position },
        rotation: { ...pose.rotation },
        scale: { x: 1, y: 1, z: 1 },
      },
      camera: {
        projection: 'perspective',
        fov: pose.fov,
        fovAxis: 'vertical',
        near: 0.1,
        far: 2000,
        isPrimary: false,
        lookAt: { ...pose.lookAt },
      },
    }
    const subject = selectedNodeOfType(doc, host.editor.selection, 'character')
    if (subject) applyCameraPresetToSubject(node, preset, subjectAtCurrentFrame(host, subject))
    return host.commitAddedNode(node, '添加相机')
  }
  try {
    const node = buildCameraNode(doc, { type: 'add-camera', presetId })
    if (name) node.name = uniqueNodeName(doc, name)
    const subject = selectedNodeOfType(doc, host.editor.selection, 'character')
    if (subject) applyCameraPresetToSubject(node, preset, subjectAtCurrentFrame(host, subject))
    return host.commitAddedNode(node, '添加相机')
  } catch (error) {
    if (error instanceof StudioIntentError) return error.code
    throw error
  }
}

export function setNodeFlags(
  host: LibraryHost,
  nodeId: string,
  flags: { visible?: boolean; locked?: boolean },
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const node = doc.content.nodes.find((n) => n.id === nodeId)
  if (!node) return 'node-not-found'
  if (flags.visible === undefined && flags.locked === undefined) return null
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  if (flags.visible !== undefined) node.visible = flags.visible
  if (flags.locked !== undefined) node.locked = flags.locked
  host.docModel.touch()
  host.pushDocSnapshot('改节点显隐锁定', before)
  host.engine.applyNodeVisibility()
  return null
}

export function updateEnvironment(host: LibraryHost, patch: EnvironmentPatch): void {
  const doc = host.docModel.snapshot
  if (!doc) return
  const env = doc.content.environment
  const nextSky = patch.skyColor ?? env.background.skyColor
  const nextLabels = patch.characterLabelsVisible ?? env.display.characterLabelsVisible
  const nextGround = patch.groundVisible ?? env.display.groundVisible
  const nextHeight = patch.groundHeight ?? env.display.groundHeight
  const nextOpacity = patch.groundOpacity ?? env.display.groundOpacity
  const unchanged =
    nextSky === env.background.skyColor &&
    nextLabels === env.display.characterLabelsVisible &&
    nextGround === env.display.groundVisible &&
    nextHeight === env.display.groundHeight &&
    nextOpacity === env.display.groundOpacity
  if (unchanged) return
  const before = snapshotDocState(host.docModel)
  if (!before) return
  env.background.skyColor = nextSky
  env.display.characterLabelsVisible = nextLabels
  env.display.groundVisible = nextGround
  env.display.groundHeight = nextHeight
  env.display.groundOpacity = nextOpacity
  host.docModel.touch()
  host.pushDocSnapshot('改场景', before, `env:${Object.keys(patch).sort().join('+')}`)
  host.engine.invalidate()
}

export async function addCharacter(
  host: LibraryHost,
  entry: CharacterLibEntry,
): Promise<string | null> {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const node = buildCharacterNode(doc, {
    type: 'add-character',
    libraryId: entry.id,
    name: entry.name,
    modelUrl: entry.file,
    rig: entry.rig,
  }, host.engine.poseBank)
  const ok = await host.engine.addRuntimeNode(node)
  if (!ok) return '模型加载失败'
  return host.commitAddedNode(node, '添加角色')
}

export async function addMotionClipFromLibrary(
  host: LibraryHost,
  fbxKey: string,
  name: string,
): Promise<string | null> {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const selection = host.editor.selection
  const target =
    selectedNodeOfType(doc, selection, 'character') ?? undefined
  if (!target) return 'missing-character'
  const fileName = assetBasename(fbxKey)
  const assetId = `user_${fileName.replace(/\.fbx$/i, '')}`
  const url = await Promise.resolve(
    resolveMediaUrl(host.adapter, { kind: 'motion', sourcePath: fbxKey, sourceUrl: fbxKey }),
  )
  let sourceDuration: number
  try {
    sourceDuration = await host.engine.loadMotion(assetId, url)
  } catch (e) {
    return `动作加载失败: ${e instanceof Error ? e.message : String(e)}`
  }
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  const tl = doc.content.timeline
  const sameTarget = tl.animation.motionClips
    .filter((c) => c.target.nodeId === target.id)
    .sort((a, b) => a.frameStart - b.frameStart)
  // Prefer the playhead. If it is inside an existing clip, start directly
  // after that clip; any later overlap is resolved by the cascading shift
  // below. This preserves intentional gaps instead of always appending.
  const playhead = Math.round(Math.min(Math.max(host.engine.currentFrame, tl.frameStart), tl.frameEnd))
  const covering = sameTarget.find((c) => c.frameStart <= playhead && playhead < c.frameEnd)
  const frameStart = covering ? covering.frameEnd : playhead
  const clip = appendMotionClip(doc, {
    type: 'add-motion',
    libraryId: assetId,
    name,
    fbxKey,
    targetNodeId: target.id,
    frameStart,
    durationSeconds: sourceDuration,
  })
  host.docModel.touch()
  host.pushDocSnapshot('添加动作', before)
  host.editor.select({ kind: 'clip', clipType: 'motion', clipId: clip.id })
  return null
}

export async function addPropFromLibrary(
  host: LibraryHost,
  name: string,
  fileKey: string,
): Promise<string | null> {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const node = buildPropNode(doc, {
    type: 'add-prop',
    libraryId: fileKey,
    name,
    modelUrl: fileKey,
  })
  // 用户库道具默认可调色，与 CharacterColorPanel 的 appearance.color 契约对齐
  node.prop = { category: node.prop?.category ?? 'user', appearance: { color: '#cccccc' } }
  const ok = await host.engine.addRuntimeNode(node)
  if (!ok) return '道具模型加载失败'
  return host.commitAddedNode(node, '添加道具')
}

export function addPrimitive(
  host: LibraryHost,
  name: string,
  kind: string,
  parameters: Record<string, number | string | boolean>,
  transform?: Partial<{
    position: { x: number; y: number; z: number }
    rotation: { x: number; y: number; z: number }
  }>,
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const node: DraftNode = {
    id: nextIndexedId(doc.content.nodes.map((item) => item.id), 'user_prim_'),
    type: 'primitive',
    name,
    visible: true,
    locked: false,
    transform: {
      position: transform?.position ?? { x: 0, y: 0.5, z: 0 },
      rotation: transform?.rotation ?? { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    primitive: { kind, parameters, appearance: { color: '#cccccc' } },
  }
  return host.commitAddedNode(node, '添加几何体')
}

export function writeNodeTransform(
  host: LibraryHost,
  nodeId: string,
  patch: { position?: Vec3; rotation?: Vec3; scale?: Vec3 },
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const node = doc.content.nodes.find((n) => n.id === nodeId)
  if (!node) return 'node-not-found'
  if (node.locked) return 'node-locked'
  if (node.type === 'camera') return 'unsupported'
  if (node.type === 'path') {
    if (!patch.position && !patch.rotation && !patch.scale) return null
    const before = snapshotDocState(host.docModel)
    if (!before) return 'no-doc'
    if (patch.position) node.transform.position = { ...patch.position }
    if (patch.rotation) node.transform.rotation = { ...patch.rotation }
    if (patch.scale) node.transform.scale = { ...patch.scale }
    host.docModel.touch()
    host.engine.refreshPathNode?.(nodeId)
    host.pushDocSnapshot('改变变换', before, 'transform:' + nodeId)
    return null
  }
  if (!patch.position && !patch.rotation && !patch.scale) return null
  const edit: TransformEditPatch = {
    position: patch.position ? [patch.position.x, patch.position.y, patch.position.z] : undefined,
    rotation: patch.rotation ? [patch.rotation.x, patch.rotation.y, patch.rotation.z] : undefined,
    scale: patch.scale ? [patch.scale.x, patch.scale.y, patch.scale.z] : undefined,
  }
  if (host.capturePendingTransform(nodeId, edit)) {
    host.engine.applyLiveNodeTransform(nodeId, patch)
    return null
  }
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  const frame = Math.round(host.engine.currentFrame)
  // 数值编辑与拖拽同规则：无用户变换键时才落盘。
  const result = applyTransformEdit(doc, host.docModel.userKeys, nodeId, frame, edit)
  if (!result.changed) return null
  if (result.posKeyUpdated) {
    rederiveWalkPaths(doc, nodeId, host.docModel.fcurves ?? FCurveSet.empty(), result.userKeys)
    host.engine.syncPathNodes()
  }
  host.docModel.setUserKeys(result.userKeys)
  host.engine.applyLiveNodeTransform(nodeId, patch)
  host.docModel.touch()
  host.pushDocSnapshot('改变换', before, `transform:${nodeId}`)
  return null
}

export function setCharacterAppearance(
  host: LibraryHost,
  nodeId: string,
  patch: { color?: string; showLabel?: boolean },
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const node = doc.content.nodes.find((n) => n.id === nodeId)
  if (!node?.character) return 'not-a-character'
  if (node.locked) return 'node-locked'
  if (patch.color === undefined && patch.showLabel === undefined) return null
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  if (patch.color !== undefined) node.character.appearance.color = patch.color
  if (patch.showLabel !== undefined) {
    node.character.label.showLabel = patch.showLabel
  }
  host.docModel.touch()
  host.pushDocSnapshot(
    patch.color !== undefined ? '改角色颜色' : '改角色标签',
    before,
    patch.color !== undefined ? `appearance-color:${nodeId}` : undefined,
  )
  return null
}


/** Character / prop / primitive material color (+ character label). */
export function setObjectAppearance(
  host: LibraryHost,
  nodeId: string,
  patch: { color?: string; showLabel?: boolean },
): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const node = doc.content.nodes.find((n) => n.id === nodeId)
  if (!node) return 'node-not-found'
  if (node.locked) return 'node-locked'
  if (patch.color === undefined && patch.showLabel === undefined) return null

  if (node.character) {
    return setCharacterAppearance(host, nodeId, patch)
  }

  if (node.type === 'prop') {
    if (patch.color === undefined && patch.showLabel === undefined) return null
    const before = snapshotDocState(host.docModel)
    if (!before) return 'no-doc'
    if (!node.prop) node.prop = { category: 'user' }
    if (patch.color !== undefined) {
      if (!node.prop.appearance) node.prop.appearance = { color: '#cccccc' }
      node.prop.appearance.color = patch.color
    }
    if (patch.showLabel !== undefined) node.prop.label = { showLabel: patch.showLabel }
    host.docModel.touch()
    host.pushDocSnapshot(patch.color !== undefined ? '改道具颜色' : '改道具标签', before, patch.color !== undefined ? `appearance-color:${nodeId}` : undefined)
    return null
  }

  if (node.type === 'primitive') {
    if (patch.color === undefined && patch.showLabel === undefined) return null
    const before = snapshotDocState(host.docModel)
    if (!before) return 'no-doc'
    if (!node.primitive) return 'not-a-primitive'
    if (patch.color !== undefined) {
      if (!node.primitive.appearance) node.primitive.appearance = { color: '#cccccc' }
      node.primitive.appearance.color = patch.color
    }
    if (patch.showLabel !== undefined) node.primitive.label = { showLabel: patch.showLabel }
    host.docModel.touch()
    host.pushDocSnapshot(patch.color !== undefined ? '改形状颜色' : '改形状标签', before, patch.color !== undefined ? `appearance-color:${nodeId}` : undefined)
    return null
  }

  return 'unsupported'
}


export function setPoseJoints(
  host: LibraryHost,
  nodeId: string,
  joints: Record<string, { x: number; y: number; z: number }>,
): void {
  const doc = host.docModel.snapshot
  if (!doc) return
  const n = doc.content.nodes.find((x) => x.id === nodeId)
  if (!n?.character) return
  const anim = n.character.animation
  anim.mode = 'pose'
  const next = { ...anim.controlValues }
  for (const [bone, rot] of Object.entries(joints)) {
    next[`joint:${bone}:x`] = rot.x
    next[`joint:${bone}:y`] = rot.y
    next[`joint:${bone}:z`] = rot.z
  }
  anim.controlValues = next
  host.docModel.touch()
}

export function setPoseValue(host: LibraryHost, nodeId: string, key: string, value: number): void {
  const doc = host.docModel.snapshot
  if (!doc) return
  const n = doc.content.nodes.find((x) => x.id === nodeId)
  if (!n?.character) return
  const before = snapshotDocState(host.docModel)
  if (!before) return
  // 拖旋钮 = 在「手动调整姿势」。保留 posePresetId（预设高亮不清，表示在该预设
  // 基础上微调：preset id 只标记初始模板）；只确保 mode 是 pose。
  const anim = n.character.animation
  anim.mode = 'pose'
  anim.controlValues = { ...anim.controlValues, [key]: value }
  host.docModel.touch()
  host.pushDocSnapshot('姿势', before, `pose:${nodeId}:${key}`)
}

export function resetPose(host: LibraryHost, nodeId: string): void {
  const doc = host.docModel.snapshot
  if (!doc) return
  const n = doc.content.nodes.find((x) => x.id === nodeId)
  if (!n?.character) return
  const before = snapshotDocState(host.docModel)
  if (!before) return
  // 重置 = 回到姿势库 T-pose，旋钮与根下沉清零。
  const anim = n.character.animation
  anim.mode = 'pose'
  anim.posePresetId = host.engine.poseBank.defaultId()
  anim.controlValues = {}
  anim.rootPositionOffset = { x: 0, y: 0, z: 0 }
  host.docModel.touch()
  host.pushDocSnapshot('重置姿势', before)
}

/**
 * 套用姿势预设。姿势库 id 写骨骼四元数 + 髋骨相对 T-pose 的下沉；
 * 旧 25 旋钮 id（stand / sit / …）仍补齐旋钮，兼容已有草稿。
 */
export function applyPosePreset(host: LibraryHost, nodeId: string, presetId: string): string | null {
  const doc = host.docModel.snapshot
  if (!doc) return 'no-doc'
  const before = snapshotDocState(host.docModel)
  if (!before) return 'no-doc'
  try {
    applyPoseInPlace(doc, { type: 'apply-pose', nodeId, presetId }, host.engine.poseBank)
  } catch (error) {
    if (error instanceof StudioIntentError) {
      return error.code === 'missing-character' ? 'not-a-character' : error.code
    }
    throw error
  }
  host.docModel.touch()
  host.pushDocSnapshot('应用姿势预设', before)
  return null
}
