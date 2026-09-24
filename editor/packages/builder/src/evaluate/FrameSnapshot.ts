import type { NodeId, SceneContract as SceneWire, Vec3 } from '../contract/types'
import type { FCurveSet } from './curves/FCurveSet'
import type { UserKeys } from './curves/KeyframeTrack'

export interface TransformValue {
  position: Vec3
  rotation: Vec3
  scale: Vec3
  lookAt?: Vec3
  fov?: number
  /** 用户改过旋转时按欧拉上机，避免 lookAt() 用世界上方向把朝向拧回去 */
  useEuler?: boolean
}

export interface BonePose {
  key: string
  value: number
}

export interface MotionPlaybackCommand {
  nodeId: NodeId
  clipId: string
  timeSeconds: number
  weight: number
}

export interface FrameSnapshot {
  transforms: Map<NodeId, TransformValue>
  poses: Map<NodeId, BonePose[]>
  motionPlayback: MotionPlaybackCommand[]
  camera: { position: Vec3; lookAt: Vec3; fov: number } | null
}

/** 运行时求值场景：契约 + 非 wire 覆写（fcurves / 用户关键帧 / 运镜衔接）。 */
export interface SceneContract extends SceneWire {
  fcurves?: FCurveSet | null
  userKeys?: UserKeys
  userKeysEnabled?: boolean
  chainCameraMotion?: boolean
}

function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

const CMD_POOL = Symbol('cmdPool')

type SnapshotWithPool = FrameSnapshot & { [CMD_POOL]?: MotionPlaybackCommand[] }

/** 每份 `out` 自己的 command 池。挂在 snapshot 上，不进序列化。 */
export function cmdPoolOf(out: FrameSnapshot): MotionPlaybackCommand[] {
  const snap = out as SnapshotWithPool
  let pool = snap[CMD_POOL]
  if (!pool) {
    pool = []
    snap[CMD_POOL] = pool
  }
  return pool
}

export function createFrameSnapshot(): FrameSnapshot {
  const out: SnapshotWithPool = {
    transforms: new Map(),
    poses: new Map(),
    motionPlayback: [],
    camera: { position: vec3(), lookAt: vec3(0, 1.2, 0), fov: 50 },
  }
  out[CMD_POOL] = []
  return out
}

export function prepareFrameSnapshot(out: FrameSnapshot, nodeIds: readonly string[]): void {
  for (const id of nodeIds) {
    if (!out.transforms.has(id)) {
      out.transforms.set(id, {
        position: vec3(),
        rotation: vec3(),
        scale: vec3(1, 1, 1),
        lookAt: vec3(0, 1.2, 0),
        fov: 50,
      })
    }
    if (!out.poses.has(id)) out.poses.set(id, [])
  }
}

export function resetFrameSnapshot(out: FrameSnapshot): void {
  out.motionPlayback.length = 0
  for (const poses of out.poses.values()) poses.length = 0
}

export function copyVec3(dst: Vec3, src: Vec3): void {
  dst.x = src.x
  dst.y = src.y
  dst.z = src.z
}

export function ensureTransform(out: FrameSnapshot, nodeId: string): TransformValue {
  let xf = out.transforms.get(nodeId)
  if (xf) return xf
  xf = {
    position: vec3(),
    rotation: vec3(),
    scale: vec3(1, 1, 1),
    lookAt: vec3(0, 1.2, 0),
    fov: 50,
  }
  out.transforms.set(nodeId, xf)
  return xf
}
