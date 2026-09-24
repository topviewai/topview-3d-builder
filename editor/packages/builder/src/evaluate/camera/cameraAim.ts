import type { Vec3 } from '../../contract/types'

const D2R = Math.PI / 180

/** Compare view directions, so a roll or an equivalent Euler representation keeps the target. */
export function sameCameraAim(position: Vec3, first: Vec3, second: Vec3): boolean {
  const a = lookDistance(position, first)
  const b = lookDistance(position, second)
  return Math.hypot(
    (first.x - position.x) / a - (second.x - position.x) / b,
    (first.y - position.y) / a - (second.y - position.y) / b,
    (first.z - position.z) / a - (second.z - position.z) / b,
  ) < 1e-6
}

/** Manual camera controls use Three.js' default XYZ order; local Z is roll. */
export function manualCameraLookAt(position: Vec3, rotation: Vec3, distance: number): Vec3 {
  const x = rotation.x * D2R
  const y = rotation.y * D2R
  return {
    x: position.x - Math.sin(y) * distance,
    y: position.y + Math.sin(x) * Math.cos(y) * distance,
    z: position.z - Math.cos(x) * Math.cos(y) * distance,
  }
}

export function lookDistance(pos: Vec3, lookAt: Vec3 | null | undefined): number {
  if (!lookAt) return 2
  return Math.hypot(lookAt.x - pos.x, lookAt.y - pos.y, lookAt.z - pos.z) || 2
}

/**
 * Three.js Euler XYZ：把相机本地 -Z 转到世界，得到注视点。
 * 定向以 lookAt 为准，旋转只是 lookAt() 的派生；改旋转 = 改这个点。
 */
export function lookAtFromEulerDeg(pos: Vec3, rotDeg: Vec3, dist: number): Vec3 {
  const x = rotDeg.x * D2R
  const y = rotDeg.y * D2R
  const z = rotDeg.z * D2R
  const cx = Math.cos(x)
  const sx = Math.sin(x)
  const cy = Math.cos(y)
  const sy = Math.sin(y)
  const cz = Math.cos(z)
  const sz = Math.sin(z)
  const iy = sx
  const iz = -cx
  const jx = sy * iz
  const jy = iy
  const jz = cy * iz
  const fx = cz * jx - sz * jy
  const fy = sz * jx + cz * jy
  const fz = jz
  const len = Math.hypot(fx, fy, fz) || 1
  const d = dist > 1e-4 ? dist : 2
  return {
    x: pos.x + (fx / len) * d,
    y: pos.y + (fy / len) * d,
    z: pos.z + (fz / len) * d,
  }
}
