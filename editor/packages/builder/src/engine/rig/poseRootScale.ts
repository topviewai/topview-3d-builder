// 姿势库 `hips` 是在一副成人参考骨架上烘焙的髋骨位移（米）。直接套到更矮的人物上，
// 坐 / 蹲 / 跪 / 躺会整体下沉穿地（Child 约 0.3–0.5 m）。按人物腿长（髋关节 → 脚踝，
// root 局部系，rest 姿态）相对参考腿长缩放根下沉，Studio 与无头渲染共用 applySnapshot。
import * as THREE from 'three'
import { findCanonicalBones } from './applyPose'

/**
 * 参考骨架腿长（米）。用四个内置人物（Child / Youth / Female / Man）在 7 个坐 / 蹲 / 跪 / 躺
 * 姿势上的实测落地误差拟合：取值使跪姿都不低于地面 0.02 m。
 */
export const POSE_LIBRARY_LEG_LENGTH = 0.95

const MIN_SCALE = 0.2
const MAX_SCALE = 2

/** rest 姿态下左腿（缺失时右腿）髋关节到脚踝的长度，root 局部系；找不到骨骼时为 null。 */
export function measureLegLength(root: THREE.Object3D, skeleton: THREE.Object3D): number | null {
  root.updateMatrixWorld(true)
  const bones = findCanonicalBones(skeleton)
  const byName = (name: string) => skeleton.getObjectByName(name)
  const pairs: Array<[THREE.Object3D | undefined, THREE.Object3D | undefined]> = [
    [bones.leftUpperLeg, bones.leftFoot],
    [bones.rightUpperLeg, bones.rightFoot],
    [byName('thigh_l'), byName('foot_l')],
  ]
  for (const [hip, ankle] of pairs) {
    if (!hip || !ankle) continue
    const a = root.worldToLocal(hip.getWorldPosition(new THREE.Vector3()))
    const b = root.worldToLocal(ankle.getWorldPosition(new THREE.Vector3()))
    const length = a.distanceTo(b)
    if (Number.isFinite(length) && length > 0) return length
  }
  return null
}

/** 姿势库根下沉的缩放系数；未测到腿长时保持 1（原行为）。 */
export function poseRootOffsetScale(legLength: number | null | undefined): number {
  if (!legLength || !Number.isFinite(legLength)) return 1
  return THREE.MathUtils.clamp(legLength / POSE_LIBRARY_LEG_LENGTH, MIN_SCALE, MAX_SCALE)
}
