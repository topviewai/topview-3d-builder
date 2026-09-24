import * as THREE from 'three'
import { MIXAMORIG_TO_UAL1 } from '../../evaluate/retarget/RetargetMap'
import type { FrameSnapshot } from '../../evaluate/evaluateFrame'
import type { NodeSnapshot } from '../DirectorEngine'
import { applyPose } from '../rig/applyPose'
import { poseRootOffsetScale } from '../rig/poseRootScale'
import { POSE_PRESET_BY_ID } from '../../data/posePresets'
import type { StageGraph } from './graph'
import { applyEnvironment } from './environment'
import { clearSkinnedRaycastBounds } from './skinnedBounds'
import { applyNodeVisibility } from './visibility'
import { manualCameraLookAt, sameCameraAim } from '../../evaluate/camera/cameraAim'

const D2R = THREE.MathUtils.degToRad
const R2D = THREE.MathUtils.radToDeg

function ual1PoseName(mixamorigRaw: string): string | undefined {
  return MIXAMORIG_TO_UAL1[THREE.PropertyBinding.sanitizeNodeName(mixamorigRaw)]
}

export function applyFrameSnapshot(graph: StageGraph, snapshot: FrameSnapshot): void {
  applyMotionAndPose(graph, snapshot)
  applyRootTransforms(graph, snapshot)
  applyCameraSnapshot(graph, snapshot)
  applyNodeVisibility(graph)
  applyEnvironment(graph)
}

export function applyMotionAndPose(graph: StageGraph, snapshot: FrameSnapshot): void {
  const playing = new Set<string>()
  // 动作素材未加载（缺失 / 离线 / 仍在加载）的片段不算覆盖，角色继续走下面的姿势分支。
  for (const cmd of snapshot.motionPlayback) {
    const ch = graph.characters.get(cmd.nodeId)
    const clip = graph.doc?.content.timeline.animation.motionClips.find((c) => c.id === cmd.clipId)
    if (!ch || !clip) continue
    if (ch.rig === 'ual1' && ch.retargeter) {
      const raw = graph.motionPlayer.getRaw(clip.motion.assetId)
      if (raw) {
        ch.retargeter.setClip(clip.id, raw.group, raw.clip)
        ch.retargeter.apply(cmd.timeSeconds)
        playing.add(cmd.nodeId)
      }
    } else {
      const ac = graph.motionPlayer.getClipForDirectBind(clip.motion.assetId, ch.inner, ch.restPose, ch.restPos)
      if (ac) {
        ch.animator.playAt(clip.id, ac, cmd.timeSeconds)
        playing.add(cmd.nodeId)
      }
    }
  }
  for (const [id, ch] of graph.characters) {
    const anim = ch.node.character?.animation
    if (playing.has(id)) {
      // 当前帧有动作片段则播动作；姿势只在无片段覆盖时生效（与时间轴提示一致）。
      ch.inner.position.set(0, 0, 0)
      continue
    }
    if (graph.poseJointBusy?.() && graph.poseJointNodeId?.() === id) continue
    // 拖 gizmo 时根朝向已是对的：不要按已旋转的根重算姿势库世界增量，
    // 只保留上一帧姿势，让 gizmo 整棵转。
    if (skipGizmoNode(graph, id)) continue
    ch.animator.stopAll()
    // 只看 mode，不再要求 controlValues 非空：空值也要走 pose 分支，applyPose 会把
    // 骨架复位到基准姿态（载入时捕获的 restPose；
    // 内置人物为 T-pose，与新角色默认 tpose 一致），新角色和「重置」后
    // 姿势能立即正确显示，而不是停在上一帧的残影。rootPositionOffset 同理，空值归零。
    if (anim?.mode === 'pose') {
      // 姿势库 D 是世界系增量。根上若已有路径 yaw，D·W_rest 与 yaw 不对易，姿势会拧。
      // 先在单位朝向上采样，再由 applyRootTransforms 套切线 / 关键帧根旋转（与 gizmo 同序）。
      ch.root.quaternion.identity()
      ch.root.rotation.set(0, 0, 0)
      ch.root.updateMatrixWorld(true)
      applyPose(
        ch.root,
        ch.restPose,
        anim.controlValues ?? {},
        ch.rig === 'ual1' ? ual1PoseName : undefined,
        (() => {
          const pose = graph.poseBank.get(anim.posePresetId)
          return pose?.bonesLoaded ? pose.bones : undefined
        })(),
      )
      for (const [key, value] of Object.entries(anim.controlValues ?? {})) {
        const match = /^joint:(.+):(x|y|z)$/.exec(key)
        if (!match) continue
        const bone = ch.root.getObjectByName(match[1])
        if (!bone) continue
        bone.rotation[match[2] as 'x' | 'y' | 'z'] = D2R(value)
      }
      // 坐 / 蹲 / 跪的骨架根下沉。挂在 inner 上而不是 root：root.position 每帧被
      // 求值结果覆盖，写这里等于 applyRootPositionOffset，节点坐标保持干净。
      // 姿势库 hips 按参考成人骨架烘焙，按腿长缩放；旧旋钮预设的 rootOffsetY 已按内置人物调好。
      const off = anim.rootPositionOffset
      const scale = anim.posePresetId && POSE_PRESET_BY_ID[anim.posePresetId] ? 1 : poseRootOffsetScale(ch.legLength)
      ch.inner.position.set((off?.x ?? 0) * scale, (off?.y ?? 0) * scale, (off?.z ?? 0) * scale)
    } else {
      ch.inner.position.set(0, 0, 0)
    }
  }
  // 播片段 / 关节拖拽 / gizmo 三条 continue 也改过骨骼，统一在收尾清一次。
  for (const [, ch] of graph.characters) clearSkinnedRaycastBounds(ch.inner)
}

function skipGizmoNode(graph: StageGraph, id: string): boolean {
  if (!graph.gizmoBusy?.()) return false
  const ids = graph.gizmoAttachedNodeIds?.()
  if (ids?.length) return ids.includes(id)
  return graph.gizmoAttachedNodeId?.() === id
}

function applyRootTransforms(graph: StageGraph, snapshot: FrameSnapshot): void {
  for (const [id, xf] of snapshot.transforms) {
    if (skipGizmoNode(graph, id)) continue
    const obj =
      graph.characters.get(id)?.root ??
      graph.props.get(id) ??
      graph.groups.get(id) ??
      graph.primitives.get(id) ??
      null
    if (!obj) continue
    obj.position.set(xf.position.x, xf.position.y, xf.position.z)
    obj.rotation.set(D2R(xf.rotation.x), D2R(xf.rotation.y), D2R(xf.rotation.z))
    obj.scale.set(xf.scale.x, xf.scale.y, xf.scale.z)
  }
}

function applyCameraSnapshot(graph: StageGraph, snapshot: FrameSnapshot): void {
  for (const [id, cam] of graph.cameras) {
    if (skipGizmoNode(graph, id)) continue
    const xf = snapshot.transforms.get(id)
    if (!xf) continue
    cam.camera.position.set(xf.position.x, xf.position.y, xf.position.z)
    if (xf.lookAt) cam.lookAt.set(xf.lookAt.x, xf.lookAt.y, xf.lookAt.z)
    if (xf.useEuler) {
      cam.camera.rotation.set(D2R(xf.rotation.x), D2R(xf.rotation.y), D2R(xf.rotation.z))
    } else {
      cam.camera.lookAt(cam.lookAt)
      // Keep a manually authored roll when its viewing direction still satisfies the evaluated aim.
      const node = graph.doc?.content.nodes.find((item) => item.id === id) ?? graph.nodeById.get(id)
      const rotation = node?.transform.rotation
      if (rotation && xf.lookAt && sameCameraAim(xf.position, xf.lookAt, manualCameraLookAt(xf.position, rotation, 1))) {
        cam.camera.rotation.set(D2R(rotation.x), D2R(rotation.y), D2R(rotation.z))
      }
    }
    const fov = xf.fov ?? cam.camera.fov
    if (cam.camera.fov !== fov) {
      cam.camera.fov = fov
      cam.camera.updateProjectionMatrix()
    }
    cam.camera.updateMatrixWorld()
  }
}

export function writeInspectorSnapshot(graph: StageGraph): void {
  graph.snapshot.clear()
  const snapObj = (id: string, o: THREE.Object3D) => {
    graph.snapshot.set(id, {
      position: [o.position.x, o.position.y, o.position.z],
      rotation: [R2D(o.rotation.x), R2D(o.rotation.y), R2D(o.rotation.z)],
      scale: [o.scale.x, o.scale.y, o.scale.z],
    })
  }
  for (const [id, ch] of graph.characters) snapObj(id, ch.root)
  for (const [id, o] of graph.props) snapObj(id, o)
  for (const [id, o] of graph.groups) snapObj(id, o)
  for (const [id, o] of graph.primitives) snapObj(id, o)
  for (const [id, cam] of graph.cameras) {
    graph.snapshot.set(id, {
      position: [cam.camera.position.x, cam.camera.position.y, cam.camera.position.z],
      rotation: [R2D(cam.camera.rotation.x), R2D(cam.camera.rotation.y), R2D(cam.camera.rotation.z)],
      scale: [1, 1, 1],
      lookAt: [cam.lookAt.x, cam.lookAt.y, cam.lookAt.z],
      fov: cam.camera.fov,
    } satisfies NodeSnapshot)
  }
}
