import type { DraftNode, Transform } from '../contract/types'
import type { FCurveSet } from './curves/FCurveSet'
import { lookAtFromEulerDeg, lookDistance } from './camera/cameraAim'
import { evaluateCameraPoseInto, type CamPose } from './camera/CameraRig'
import {
  characterLookAtPoint,
  resolveSubjectCameraPose,
  subjectOverridesMotion,
} from './camera/subjectBinding'
import { motionClipAt, motionTimeSeconds } from './clips'
import {
  cmdPoolOf,
  copyVec3,
  ensureTransform,
  type BonePose,
  type FrameSnapshot,
  type SceneContract,
  type TransformValue,
} from './FrameSnapshot'
import { sampleKeyframesInto, type TrackProp, type UserKeys } from './curves/KeyframeTrack'
import { evaluatePathMotionInto, type PathEval } from './path/samplePath'

const RAD2DEG = 180 / Math.PI
const AXES = ['x', 'y', 'z'] as const
const POSE_KEYS = [
  'bodyBend', 'bodyTilt', 'bodyTurn',
  'torsoBend', 'torsoTilt', 'torsoTurn',
  'headNod', 'headTilt', 'headTurn',
  'lArmRaise', 'lArmStraddle', 'lArmTurn', 'lElbowBend',
  'rArmRaise', 'rArmStraddle', 'rArmTurn', 'rElbowBend',
  'lLegRaise', 'lLegStraddle', 'lLegTurn', 'lKneeBend',
  'rLegRaise', 'rLegStraddle', 'rLegTurn', 'rKneeBend',
] as const

const _sample = [0, 0, 0]
const _path: PathEval = { position: { x: 0, y: 0, z: 0 }, yaw: 0 }
const _cam: CamPose = { position: [0, 0, 0], lookAt: [0, 0, 0], fov: 50, clipId: null }
const _nodeById = new Map<string, DraftNode>()

export function indexSceneNodes(nodes: readonly DraftNode[]): void {
  _nodeById.clear()
  for (const node of nodes) _nodeById.set(node.id, node)
}

export function writeStaticTransform(xf: TransformValue, t: Transform): void {
  copyVec3(xf.position, t.position)
  copyVec3(xf.rotation, t.rotation)
  copyVec3(xf.scale, t.scale)
}

export function applyFcurvesToTransform(
  xf: TransformValue,
  fcurves: FCurveSet,
  nodeId: string,
  frame: number,
): void {
  for (let i = 0; i < 3; i++) {
    const p = fcurves.evalScalar(nodeId, 'transform.position', i, frame)
    if (p !== null) xf.position[AXES[i]] = p
    const r = fcurves.evalScalar(nodeId, 'transform.rotation', i, frame)
    if (r !== null) xf.rotation[AXES[i]] = r
    const s = fcurves.evalScalar(nodeId, 'transform.scale', i, frame)
    if (s !== null) xf.scale[AXES[i]] = s
  }
}

function emitPlayback(
  out: FrameSnapshot,
  nodeId: string,
  clipId: string,
  timeSeconds: number,
): void {
  const i = out.motionPlayback.length
  const pool = cmdPoolOf(out)
  let cmd = pool[i]
  if (!cmd) {
    cmd = { nodeId, clipId, timeSeconds, weight: 1 }
    pool[i] = cmd
  } else {
    cmd.nodeId = nodeId
    cmd.clipId = clipId
    cmd.timeSeconds = timeSeconds
    cmd.weight = 1
  }
  out.motionPlayback.push(cmd)
}

function writePoseKnobs(out: FrameSnapshot, nodeId: string, values: Record<string, number>): void {
  let arr = out.poses.get(nodeId)
  if (!arr) {
    arr = []
    out.poses.set(nodeId, arr)
  }
  let n = 0
  for (const key of POSE_KEYS) {
    const value = values[key]
    if (value === undefined) continue
    let pose: BonePose | undefined = arr[n]
    if (!pose) {
      pose = { key, value }
      arr[n] = pose
    } else {
      pose.key = key
      pose.value = value
    }
    n += 1
  }
  arr.length = n
}

/** 1–3：角色复位 → 动作指令 / pose → fcurves 覆写根 transform */
export function evaluateCharacters(scene: SceneContract, frame: number, out: FrameSnapshot): void {
  const clips = scene.timeline.animation.motionClips
  const fps = scene.meta.fps
  const fcurves = scene.fcurves
  for (const node of scene.nodes) {
    if (node.type !== 'character') continue
    const xf = ensureTransform(out, node.id)
    writeStaticTransform(xf, node.transform)
    const clip = motionClipAt(clips, node.id, frame)
    if (clip) {
      emitPlayback(out, node.id, clip.id, motionTimeSeconds(clip, frame, fps))
    } else if (node.character?.animation.mode === 'pose') {
      writePoseKnobs(out, node.id, node.character.animation.controlValues ?? {})
    }
    if (fcurves) {
      for (let i = 0; i < 3; i++) {
        const p = fcurves.evalScalar(node.id, 'transform.position', i, frame)
        if (p !== null) xf.position[AXES[i]] = p
        if (!clip) {
          const r = fcurves.evalScalar(node.id, 'transform.rotation', i, frame)
          if (r !== null) xf.rotation[AXES[i]] = r
        }
        const s = fcurves.evalScalar(node.id, 'transform.scale', i, frame)
        if (s !== null) xf.scale[AXES[i]] = s
      }
    }
  }
}

/** 5：路径。派生 [frameStart, frameEnd)；用户轨迹闭区间 [frameStart, frameEnd]。
 * 必须在道具 / primitive 静态复位之后写，否则走位会被静态 transform 盖掉。 */
export function evaluatePaths(scene: SceneContract, frame: number, out: FrameSnapshot): void {
  const fcurves = scene.fcurves
  for (const clip of scene.timeline.animation.pathMotionClips) {
    const derivedRange = clip.lockedReason === 'derived-from-keyframes'
    if (frame < clip.frameStart) continue
    if (derivedRange ? frame >= clip.frameEnd : frame > clip.frameEnd) continue
    const pathNode = _nodeById.get(clip.pathNodeId)
    if (!pathNode || !evaluatePathMotionInto(pathNode, clip, frame, _path)) continue
    const target = _nodeById.get(clip.target.nodeId)
    if (target?.type === 'camera') continue
    const xf = out.transforms.get(clip.target.nodeId)
    if (!xf) continue
    const derived = clip.lockedReason === 'derived-from-keyframes'
    // 派生 clip 的目标已有 position 关键帧（官方 fcurves 或用户 userKeys）时，
    // 位置由关键帧决定（别双重叠加），path 只提供朝向 yaw。
    const fcPos = derived && !!(
      fcurves?.hasTrack(clip.target.nodeId, 'transform.position') ||
      scene.userKeys?.[clip.target.nodeId]?.position?.length
    )
    if (!fcPos) copyVec3(xf.position, _path.position)
    if (clip.facing !== 'path-tangent') continue
    const yawDeg = _path.yaw * RAD2DEG
    xf.rotation.x = 0
    xf.rotation.y = yawDeg
    xf.rotation.z = 0
  }
}

/** 4：道具 / group / primitive 复位到静态 transform，再叠 fcurves（gizmo 提交的位移/旋转/缩放） */
export function evaluateStaticNodes(scene: SceneContract, frame: number, out: FrameSnapshot): void {
  const fcurves = scene.fcurves
  for (const node of scene.nodes) {
    if (node.type !== 'prop' && node.type !== 'group' && node.type !== 'primitive') continue
    const xf = ensureTransform(out, node.id)
    writeStaticTransform(xf, node.transform)
    if (fcurves) applyFcurvesToTransform(xf, fcurves, node.id, frame)
  }
}

function applyUserProp(
  xf: TransformValue,
  prop: TrackProp,
  keys: NonNullable<UserKeys[string]>[TrackProp],
  frame: number,
): void {
  // 首键之前不外推（回退官方 fcurves / 静态 transform）；末键之后钉住最后一键，
  // 播完不会弹回打键前的静态值。
  if (!keys || !sampleKeyframesInto(keys, frame, _sample, false)) return
  if (prop === 'position') {
    xf.position.x = _sample[0]
    xf.position.y = _sample[1]
    xf.position.z = _sample[2]
    return
  }
  if (prop === 'rotation') {
    xf.rotation.x = _sample[0]
    xf.rotation.y = _sample[1]
    xf.rotation.z = _sample[2]
    return
  }
  if (prop === 'scale') {
    xf.scale.x = _sample[0]
    xf.scale.y = _sample[1]
    xf.scale.z = _sample[2]
  }
}

/** 该帧是否有覆盖此角色的派生走位路径（facing=path-tangent）：朝向应跟随路径 */
function derivedFacingAt(scene: SceneContract, nodeId: string, frame: number): boolean {
  for (const clip of scene.timeline.animation.pathMotionClips) {
    if (clip.lockedReason !== 'derived-from-keyframes') continue
    if (clip.facing !== 'path-tangent') continue
    if (clip.target?.nodeId !== nodeId) continue
    // 与 evaluatePaths 的派生区间一致：[frameStart, frameEnd)
    if (frame >= clip.frameStart && frame < clip.frameEnd) return true
  }
  return false
}

/** 6：用户关键帧覆写（非相机） */
export function evaluateUserKeys(scene: SceneContract, frame: number, out: FrameSnapshot): void {
  if (!scene.userKeysEnabled || !scene.userKeys) return
  for (const node of scene.nodes) {
    if (node.type === 'camera' || node.type === 'path') continue
    const uk = scene.userKeys[node.id]
    if (!uk) continue
    const xf = out.transforms.get(node.id)
    if (!xf) continue
    applyUserProp(xf, 'position', uk.position, frame)
    // 角色在派生走位路径覆盖的帧上，朝向跟随路径方向（第 4 步已写入 path-tangent
    // yaw）——此时旋转用户键让路，否则人物沿轨迹移动但朝向不转。
    const rotationLockedByPath =
      node.type === 'character' && derivedFacingAt(scene, node.id, frame)
    if (!rotationLockedByPath) applyUserProp(xf, 'rotation', uk.rotation, frame)
    applyUserProp(xf, 'scale', uk.scale, frame)
  }
}

function writeCameraSlot(xf: TransformValue, pose: CamPose): void {
  xf.position.x = pose.position[0]
  xf.position.y = pose.position[1]
  xf.position.z = pose.position[2]
  if (!xf.lookAt) xf.lookAt = { x: 0, y: 0, z: 0 }
  xf.lookAt.x = pose.lookAt[0]
  xf.lookAt.y = pose.lookAt[1]
  xf.lookAt.z = pose.lookAt[2]
  xf.fov = pose.fov
  xf.rotation.x = 0
  xf.rotation.y = 0
  xf.rotation.z = 0
  xf.useEuler = false
}

/**
 * 相机平移是刚体运动：注视点跟着位置等量位移，朝向不变。
 * 注视点是世界坐标，位置一动却把它钉在原地，相机就会绕着它转——这才是「移动时朝向
 * 乱漂」。移动改朝向只有一种情况：看点被显式驱动（lookAtTarget / 人物绑定 / 运镜
 * 曲线 / 看点关键帧），那些步骤在本函数之后覆盖 lookAt。
 */
function moveCameraKeepingAim(xf: TransformValue, next: { x: number; y: number; z: number }): void {
  const look = xf.lookAt
  if (look) {
    look.x += next.x - xf.position.x
    look.y += next.y - xf.position.y
    look.z += next.z - xf.position.z
  }
  copyVec3(xf.position, next)
}

function overlayCameraFcurves(
  xf: TransformValue,
  fcurves: FCurveSet,
  nodeId: string,
  frame: number,
): void {
  const look = xf.lookAt
  if (!look) return
  let hitRotation = false
  for (let i = 0; i < 3; i++) {
    const pv = fcurves.evalScalar(nodeId, 'transform.position', i, frame)
    const lv = fcurves.evalScalar(nodeId, 'camera.lookAt', i, frame)
    if (pv !== null) {
      // 该轴没有看点曲线时，看点随位置等量位移（见 moveCameraKeepingAim）。
      if (lv === null) look[AXES[i]] += pv - xf.position[AXES[i]]
      xf.position[AXES[i]] = pv
    }
    if (lv !== null) look[AXES[i]] = lv
    const rv = fcurves.evalScalar(nodeId, 'transform.rotation', i, frame)
    if (rv !== null) {
      xf.rotation[AXES[i]] = rv
      hitRotation = true
    }
  }
  if (hitRotation) applyRotationToLookAt(xf)
  const fv = fcurves.evalScalar(nodeId, 'camera.fov', 0, frame)
  if (fv !== null) xf.fov = fv
}

function overlayCameraUserKeys(
  xf: TransformValue,
  uk: NonNullable<UserKeys[string]>,
  frame: number,
): void {
  if (uk.position && sampleKeyframesInto(uk.position, frame, _sample)) {
    moveCameraKeepingAim(xf, { x: _sample[0], y: _sample[1], z: _sample[2] })
  }
  if (uk.lookAt && xf.lookAt && sampleKeyframesInto(uk.lookAt, frame, _sample)) {
    xf.lookAt.x = _sample[0]
    xf.lookAt.y = _sample[1]
    xf.lookAt.z = _sample[2]
  }
  if (uk.rotation && sampleKeyframesInto(uk.rotation, frame, _sample)) {
    xf.rotation.x = _sample[0]
    xf.rotation.y = _sample[1]
    xf.rotation.z = _sample[2]
    applyRotationToLookAt(xf)
  }
  if (uk.fov && sampleKeyframesInto(uk.fov, frame, _sample)) xf.fov = _sample[0]
}

/** 改旋转 = 改注视点；上机走欧拉，避免 lookAt() 用世界上方向把朝向拧偏。 */
function applyRotationToLookAt(xf: TransformValue): void {
  if (!xf.lookAt) xf.lookAt = { x: 0, y: 0, z: 0 }
  const dist = lookDistance(xf.position, xf.lookAt)
  copyVec3(xf.lookAt, lookAtFromEulerDeg(xf.position, xf.rotation, dist))
  xf.useEuler = true
}

function writeActiveCamera(out: FrameSnapshot, xf: TransformValue): void {
  if (!out.camera) {
    out.camera = {
      position: { x: 0, y: 0, z: 0 },
      lookAt: { x: 0, y: 1.2, z: 0 },
      fov: 50,
    }
  }
  copyVec3(out.camera.position, xf.position)
  if (xf.lookAt) copyVec3(out.camera.lookAt, xf.lookAt)
  out.camera.fov = xf.fov ?? 50
}

/** 相机：运镜片段内独占；片段外让位给路径走位；关键帧只要有运镜就整段挂起。写入激活相机 */
export function evaluateCameras(scene: SceneContract, frame: number, out: FrameSnapshot): void {
  const clips = scene.timeline.animation.cameraMotionClips
  const fps = scene.meta.fps
  const chained = scene.chainCameraMotion === true
  const fcurves = scene.fcurves
  const userKeys = scene.userKeysEnabled ? scene.userKeys : undefined
  let primary: TransformValue | null = null
  let firstCam: TransformValue | null = null
  for (const node of scene.nodes) {
    if (node.type !== 'camera') continue
    evaluateCameraPoseInto(node, clips, frame, fps, chained, _cam)
    const xf = ensureTransform(out, node.id)
    writeCameraSlot(xf, _cam)
    // 运镜 / 路径走位 / 变换关键帧的分时仲裁：
    // - 关键帧（官方 fcurves + userKeys）：机位上只要存在任意运镜片段就整段挂起，
    //   数据保留（UI 同步置灰），删光运镜后自动恢复。片段外 / 链式 hold 同样不叠，
    //   否则会盖住运镜轨迹。
    // - 运镜片段覆盖的帧：运镜独占运动输出，遮蔽同帧的路径走位。
    // - 运镜片段之外的帧：路径走位解除压制，在它自己的片段内独占驱动机位；
    //   走位片段之外再由关键帧接力。
    const motionOwnsKeyframes = clips.some((c) => c.target.nodeId === node.id)
    const motionActive = clips.some(
      (c) => c.target.nodeId === node.id && frame >= c.frameStart && frame <= c.frameEnd,
    )
    if (fcurves && _cam.clipId === null && !motionOwnsKeyframes) overlayCameraFcurves(xf, fcurves, node.id, frame)
    const uk = userKeys?.[node.id]
    if (uk && !motionOwnsKeyframes) overlayCameraUserKeys(xf, uk, frame)
    // 走位最后写位置：轨迹片段内它独占运动；片段外没人覆写，位置自然落回关键帧，
    // 于是无运镜时形成「轨迹段走轨迹、轨迹段外关键帧接力」的分时混合。
    if (!motionActive) {
      const pathClip = scene.timeline.animation.pathMotionClips.find((c) => {
        if (c.target.nodeId !== node.id) return false
        const derivedRange = c.lockedReason === 'derived-from-keyframes'
        if (derivedRange) {
          // 派生轨迹只是关键帧的另一种表达：关键帧被运镜挂起时它得一起挂起，否则
          // 会从侧门把失效的关键帧放回来；关键帧还生效时也让位给关键帧本身，
          // 免得同一份数据按两种插值算两遍。
          if (motionOwnsKeyframes) return false
          if (fcurves?.hasTrack(node.id, 'transform.position') || uk?.position?.length) return false
        }
        if (frame < c.frameStart) return false
        return derivedRange ? frame < c.frameEnd : frame <= c.frameEnd
      })
      if (pathClip) {
        const pathNode = _nodeById.get(pathClip.pathNodeId)
        if (pathNode && evaluatePathMotionInto(pathNode, pathClip, frame, _path)) {
          // 走位只驱动位置，朝向保持不变（切线 yaw 是人物的语义，相机不用）。
          moveCameraKeepingAim(xf, _path.position)
        }
      }
    }
    const binding = node.camera?.subject
    // 用人物在**本帧求值后**的 transform，而不是静态 transform：否则相机不会跟着
    // 动作 / 轨迹 / 关键帧走，点机位时算出的位置和求值结果还会差一截。
    const tp = binding?.follow ? out.transforms.get(binding.nodeId) : undefined
    // 后设置的优先级高：运镜片段比绑定新时，让运镜接管它覆盖的帧。
    const followOwns = Boolean(binding && tp && (_cam.clipId === null || subjectOverridesMotion(binding)))
    if (followOwns && binding && tp) {
      const pose = resolveSubjectCameraPose(binding, tp.position, tp.rotation)
      copyVec3(xf.position, pose.position)
      if (xf.lookAt) copyVec3(xf.lookAt, pose.lookAt)
      else xf.lookAt = pose.lookAt
      xf.useEuler = false
    }
    const lookAtTarget = node.camera?.lookAtTarget
    const clipOwnsLookAt = _cam.clipId !== null && !followOwns
    if (lookAtTarget?.nodeId && !clipOwnsLookAt) {
      const targetXf = out.transforms.get(lookAtTarget.nodeId)
      if (targetXf) {
        const aim = characterLookAtPoint(targetXf.position, lookAtTarget.offset)
        if (xf.lookAt) copyVec3(xf.lookAt, aim)
        else xf.lookAt = aim
        xf.useEuler = false
      }
    }
    if (!firstCam) firstCam = xf
    if (node.camera?.isPrimary) primary = xf
  }
  const active = primary ?? firstCam
  if (active) writeActiveCamera(out, active)
  else out.camera = null
}
