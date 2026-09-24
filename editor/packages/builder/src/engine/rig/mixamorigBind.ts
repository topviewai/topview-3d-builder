// mixamorig GLB 有两套绑定单位：
//   厘米：内置 Youth / Female / Man，hips 局部位移约 100
//   米：  库里部分 Child（如 X Bot），hips 局部位移约 0.6
// FBX 动作始终是厘米。直绑时位移必须按 dest/src 髋骨长度比缩放，
// 厘米模型才套 CENTIMETER_MIXAMORIG_SCALE。
import type * as THREE from 'three'

/** 髋骨局部位移 ≥ 此值视为厘米绑定（厘米制 ≈ 101，米制 Child ≈ 0.64） */
export const MIXAMORIG_CM_HIPS_MIN = 8

export function mixamorigHips(root: THREE.Object3D): THREE.Object3D | undefined {
  return root.getObjectByName('mixamorigHips')
}

export function isCentimeterMixamorig(root: THREE.Object3D): boolean {
  const hips = mixamorigHips(root)
  return !!hips && hips.position.length() >= MIXAMORIG_CM_HIPS_MIN
}

/** 直绑 clip 缓存键：同一 asset 在厘米 / 米骨架上各烘一份 */
export function mixamorigBindKey(root: THREE.Object3D): string {
  const hips = mixamorigHips(root)
  if (!hips) return 'none'
  return isCentimeterMixamorig(root) ? 'cm' : 'm'
}

export function mixamorigPositionScale(destLen: number, srcLen: number, fallback: number): number {
  if (srcLen < 1e-4) return fallback
  return destLen / srcLen
}
