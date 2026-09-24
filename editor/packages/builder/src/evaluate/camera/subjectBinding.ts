import type { DraftNode, Vec3 } from '../../contract/types'

export type CameraSubjectBinding = NonNullable<NonNullable<DraftNode['camera']>['subject']>

const DEG2RAD = Math.PI / 180

/**
 * 人物的水平朝向角（度）。
 *
 * 不能直接拿 `rotation.y`：three.js 默认 Euler order 是 XYZ，本地 +Z 在世界里落在
 * `(sin y, -sin x · cos y, cos x · cos y)`。草稿里的人物旋转可能写成
 * `(-180, 29.325, -180)` 这种等价形式，只读 `rotation.y` 会把朝向算差 121°。
 */
export function subjectYawDeg(rotation: Vec3): number {
  const x = rotation.x * DEG2RAD
  const y = rotation.y * DEG2RAD
  const forwardX = Math.sin(y)
  const forwardZ = Math.cos(x) * Math.cos(y)
  if (Math.abs(forwardX) < 1e-9 && Math.abs(forwardZ) < 1e-9) return rotation.y
  return Math.atan2(forwardX, forwardZ) / DEG2RAD
}

/**
 * 人物局部偏移 → 世界坐标。约定与 `samplePath` 的 `yaw = atan2(tanX, tanZ)` 一致：
 * 本地 +Z 是朝向，绕 Y 转 yaw 后本地 +Z 落在 `(sin yaw, 0, cos yaw)`、
 * 本地 +X 落在 `(cos yaw, 0, -sin yaw)`。所以 z 分量的正弦项取负号；
 * 写成 `dx·sin + dz·cos` 等于转了 -yaw，会把机位镜像到人物另一侧。
 */
export function subjectLocalToWorld(local: Vec3, subjectPos: Vec3, yawDeg: number): Vec3 {
  const yaw = yawDeg * DEG2RAD
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  return {
    x: subjectPos.x + local.x * cos + local.z * sin,
    y: subjectPos.y + local.y,
    z: subjectPos.z - local.x * sin + local.z * cos,
  }
}

/** `subjectLocalToWorld` 的逆：世界坐标 → 人物局部偏移 */
export function subjectWorldToLocal(world: Vec3, subjectPos: Vec3, yawDeg: number): Vec3 {
  const yaw = yawDeg * DEG2RAD
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const dx = world.x - subjectPos.x
  const dz = world.z - subjectPos.z
  return {
    x: dx * cos - dz * sin,
    y: world.y - subjectPos.y,
    z: dx * sin + dz * cos,
  }
}

/**
 * 跟随是否盖过运镜曲线。后设置的优先级高：点机位绑定人物时 `overridesMotion`
 * 写 true，之后再点运镜会置回 false，让运镜接管它覆盖的帧区间。
 */
export function subjectOverridesMotion(binding: CameraSubjectBinding): boolean {
  return binding.overridesMotion !== false
}

/** 看向人物时的默认点：角色原点上方胸口高度（米），与静态机位 lookAt.y≈1.2 一致 */
export const CHARACTER_LOOK_AT_HEIGHT = 1.2

/** 人物世界原点 + 可选偏移；没给偏移时看胸口。 */
export function characterLookAtPoint(subjectPos: Vec3, offset?: Vec3 | null): Vec3 {
  if (offset) {
    return {
      x: subjectPos.x + offset.x,
      y: subjectPos.y + offset.y,
      z: subjectPos.z + offset.z,
    }
  }
  return {
    x: subjectPos.x,
    y: subjectPos.y + CHARACTER_LOOK_AT_HEIGHT,
    z: subjectPos.z,
  }
}

/** 绑定 + 人物当前 pose → 相机该待的位置和 lookAt */
export function resolveSubjectCameraPose(
  binding: CameraSubjectBinding,
  subjectPos: Vec3,
  subjectRotation: Vec3,
): { position: Vec3; lookAt: Vec3 } {
  const yawDeg = binding.followRotation ? subjectYawDeg(subjectRotation) : 0
  return {
    position: subjectLocalToWorld(binding.offset, subjectPos, yawDeg),
    lookAt: subjectLocalToWorld(binding.lookAtOffset, subjectPos, yawDeg),
  }
}
