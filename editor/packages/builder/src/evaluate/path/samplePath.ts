// pathMotionClips：沿 path 节点的曲线取根位移，facing=path-tangent 时算切线朝向。
//
// 两种路径参数化：
//   1. parameterization='arc-length' + curve='catmullRom'（用户手绘/点击轨迹）
//      centripetal Catmull-Rom，按弧长匀速推进；世界位姿 = 绕控制点中心的 scale/rotation + transform.position。
//   2. parameterization='time-ratio' + curve='polyline'（关键帧派生路径）
//      按点上的 timeRatio 在相邻点间线性插值。
import type { DraftNode, PathMotionClip, Transform, Vec3 } from '../../contract/types'
import {
  catmullRomLength,
  catmullRomPointAt,
  catmullRomSpacedPoints,
  catmullRomTangentAt,
  type SampledPoint,
} from './catmullRom'

export interface PathEval {
  position: Vec3
  yaw: number
}

const _pts: NonNullable<DraftNode['path']>['points'] = []
const _eval: PathEval = { position: { x: 0, y: 0, z: 0 }, yaw: 0 }
const _pos: SampledPoint = { x: 0, y: 0, z: 0 }
const _tan: SampledPoint = { x: 0, y: 0, z: 0 }

export const PATH_WALK_SPEED = 2
export const PATH_CLIP_MAX_SECONDS = 15


const D2R = Math.PI / 180

/** Control-point centroid — pivot for path rotation / scale. */
export function pathControlCentroid(pathNode: DraftNode): Vec3 {
  const pts = pathNode.path?.points
  if (!pts || pts.length === 0) return { x: 0, y: 0, z: 0 }
  let x = 0
  let y = 0
  let z = 0
  for (const p of pts) {
    x += p.position.x
    y += p.position.y
    z += p.position.z
  }
  const n = pts.length
  return { x: x / n, y: y / n, z: z / n }
}

/** Apply X, then Y, then Z: v' = Rz * Ry * Rx * v (Three.js order ZYX). */
function rotateEulerXYZ(x: number, y: number, z: number, rotDeg: Vec3): [number, number, number] {
  const rx = rotDeg.x * D2R
  const ry = rotDeg.y * D2R
  const rz = rotDeg.z * D2R
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  const x1 = x
  const y1 = cx * y - sx * z
  const z1 = sx * y + cx * z
  const x2 = cy * x1 + sy * z1
  const y2 = y1
  const z2 = -sy * x1 + cy * z1
  return [cz * x2 - sz * y2, sz * x2 + cz * y2, z2]
}

/** Inverse of rotateEulerXYZ: undo Rz, then Ry, then Rx. */
function unrotateEulerXYZ(x: number, y: number, z: number, rotDeg: Vec3): [number, number, number] {
  const rx = rotDeg.x * D2R
  const ry = rotDeg.y * D2R
  const rz = rotDeg.z * D2R
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  const x2 = cz * x + sz * y
  const y2 = -sz * x + cz * y
  const z2 = z
  const x1 = cy * x2 - sy * z2
  const y1 = y2
  const z1 = sy * x2 + cy * z2
  return [x1, cx * y1 + sx * z1, -sx * y1 + cx * z1]
}

/**
 * Local path control / sample → world.
 * world = R * S * (P - C) + C + T  (identity R/S keeps legacy P + T)
 */
export function transformPathLocalPoint(
  local: { x: number; y: number; z: number },
  transform: Transform,
  center: { x: number; y: number; z: number },
): Vec3 {
  const dx = (local.x - center.x) * transform.scale.x
  const dy = (local.y - center.y) * transform.scale.y
  const dz = (local.z - center.z) * transform.scale.z
  const [rx, ry, rz] = rotateEulerXYZ(dx, dy, dz, transform.rotation)
  return {
    x: rx + center.x + transform.position.x,
    y: ry + center.y + transform.position.y,
    z: rz + center.z + transform.position.z,
  }
}

/**
 * World → local path control. Inverse of transformPathLocalPoint with a fixed center.
 * Identity R/S reduces to P = world - T (centroid cancels).
 */
export function inverseTransformPathWorldPoint(
  world: { x: number; y: number; z: number },
  transform: Transform,
  center: { x: number; y: number; z: number },
): Vec3 {
  const dx = world.x - center.x - transform.position.x
  const dy = world.y - center.y - transform.position.y
  const dz = world.z - center.z - transform.position.z
  const [ux, uy, uz] = unrotateEulerXYZ(dx, dy, dz, transform.rotation)
  const sx = Math.abs(transform.scale.x) > 1e-8 ? transform.scale.x : 1
  const sy = Math.abs(transform.scale.y) > 1e-8 ? transform.scale.y : 1
  const sz = Math.abs(transform.scale.z) > 1e-8 ? transform.scale.z : 1
  return {
    x: ux / sx + center.x,
    y: uy / sy + center.y,
    z: uz / sz + center.z,
  }
}

export function samplePathWorldFromControls(
  worlds: readonly Vec3[],
  closed: boolean,
  parameterization: string,
  divisions = 120,
): Vec3[] {
  if (worlds.length < 2) return []
  if (parameterization === 'arc-length') {
    return catmullRomSpacedPoints(worlds.map((p) => ({ position: p })), closed, divisions)
  }
  return worlds.map((p) => ({ x: p.x, y: p.y, z: p.z }))
}

/** Write one control point from a world position. Returns false if the index is invalid. */
export function writePathPointWorld(
  node: DraftNode,
  index: number,
  world: Vec3,
): boolean {
  const path = node.path
  if (!path || index < 0 || index >= path.points.length) return false
  const center = pathControlCentroid(node)
  const local = inverseTransformPathWorldPoint(world, node.transform, center)
  const point = path.points[index]
  // Curve/arc-length caches are keyed by the control array. Publish a new
  // array so rendering and playback both sample the edited curve.
  path.points = path.points.map((item, i) => i === index ? { ...point, position: local } : item)
  // Moving a control changes the centroid. Keep the existing world mapping
  // fixed so rotation/scale do not also displace every untouched control.
  const nextCenter = pathControlCentroid(node)
  const oldOrigin = transformPathLocalPoint({ x: 0, y: 0, z: 0 }, node.transform, center)
  const nextOrigin = transformPathLocalPoint({ x: 0, y: 0, z: 0 }, node.transform, nextCenter)
  node.transform.position = {
    x: node.transform.position.x + oldOrigin.x - nextOrigin.x,
    y: node.transform.position.y + oldOrigin.y - nextOrigin.y,
    z: node.transform.position.z + oldOrigin.z - nextOrigin.z,
  }
  return true
}

function transformPathDirection(
  dir: { x: number; y: number; z: number },
  transform: Transform,
): { x: number; y: number; z: number } {
  const dx = dir.x * transform.scale.x
  const dy = dir.y * transform.scale.y
  const dz = dir.z * transform.scale.z
  const [rx, ry, rz] = rotateEulerXYZ(dx, dy, dz, transform.rotation)
  return { x: rx, y: ry, z: rz }
}

export function pathArcLength(pathNode: DraftNode): number {
  const path = pathNode.path
  if (!path || path.points.length < 2) return 0
  if (path.parameterization === 'arc-length') return catmullRomLength(path.points, path.closed)
  let len = 0
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1].position
    const b = path.points[i].position
    len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
  }
  return len
}

export function pathClipDurationFrames(pathNode: DraftNode, fps: number): number {
  const seconds = Math.min(pathArcLength(pathNode) / PATH_WALK_SPEED, PATH_CLIP_MAX_SECONDS)
  return Math.max(1, Math.round(seconds * fps))
}

export function samplePathPoints(pathNode: DraftNode, divisions = 120): Vec3[] {
  const path = pathNode.path
  if (!path || path.points.length < 2) return []
  const center = pathControlCentroid(pathNode)
  const xf = pathNode.transform
  const toWorld = (p: { x: number; y: number; z: number }): Vec3 => transformPathLocalPoint(p, xf, center)
  if (path.parameterization === 'arc-length') {
    return catmullRomSpacedPoints(path.points, path.closed, divisions).map(toWorld)
  }
  return [...path.points]
    .sort((a, b) => (a.timeRatio ?? 0) - (b.timeRatio ?? 0))
    .map((p) => toWorld(p.position))
}

export function evaluatePathMotionInto(
  pathNode: DraftNode,
  clip: PathMotionClip,
  frame: number,
  out: PathEval,
): boolean {
  const path = pathNode.path
  if (!path || path.points.length < 2) return false

  const span = clip.frameEnd - clip.frameStart
  const progress = span > 0 ? Math.min(Math.max((frame - clip.frameStart) / span, 0), 1) : 0
  const a = clip.pathStartPercent / 100
  const b = clip.pathEndPercent / 100
  const u = clip.direction === 'backward' ? b - progress * (b - a) : a + progress * (b - a)

  const center = pathControlCentroid(pathNode)
  const xf = pathNode.transform
  let tanX: number
  let tanZ: number

  if (path.parameterization === 'arc-length') {
    const uc = Math.min(Math.max(u, 0), 1)
    catmullRomPointAt(path.points, path.closed, uc, _pos)
    catmullRomTangentAt(path.points, path.closed, uc, _tan)
    const world = transformPathLocalPoint(_pos, xf, center)
    out.position.x = world.x
    out.position.y = world.y
    out.position.z = world.z
    const dir = transformPathDirection(_tan, xf)
    tanX = dir.x
    tanZ = dir.z
  } else {
    _pts.length = 0
    for (const point of path.points) _pts.push(point)
    _pts.sort((x, y) => (x.timeRatio ?? 0) - (y.timeRatio ?? 0))
    let i = 0
    while (i < _pts.length - 2 && (_pts[i + 1].timeRatio ?? 0) < u) i++
    const p0 = _pts[i]
    const p1 = _pts[i + 1]
    const segSpan = (p1.timeRatio ?? 0) - (p0.timeRatio ?? 0)
    const t = segSpan > 1e-6 ? Math.min(Math.max((u - (p0.timeRatio ?? 0)) / segSpan, 0), 1) : 0
    const local = {
      x: p0.position.x + (p1.position.x - p0.position.x) * t,
      y: p0.position.y + (p1.position.y - p0.position.y) * t,
      z: p0.position.z + (p1.position.z - p0.position.z) * t,
    }
    const world = transformPathLocalPoint(local, xf, center)
    out.position.x = world.x
    out.position.y = world.y
    out.position.z = world.z
    const dir = transformPathDirection(
      {
        x: p1.position.x - p0.position.x,
        y: p1.position.y - p0.position.y,
        z: p1.position.z - p0.position.z,
      },
      xf,
    )
    tanX = dir.x
    tanZ = dir.z
  }

  out.yaw = tanX * tanX + tanZ * tanZ > 1e-12 ? Math.atan2(tanX, tanZ) : 0
  return true
}

export function evaluatePathMotion(
  pathNode: DraftNode,
  clip: PathMotionClip,
  frame: number,
): PathEval | null {
  if (!evaluatePathMotionInto(pathNode, clip, frame, _eval)) return null
  return {
    position: { x: _eval.position.x, y: _eval.position.y, z: _eval.position.z },
    yaw: _eval.yaw,
  }
}
