import * as THREE from 'three'
import { resolveObjectWorldBounds } from '../frameSelection'

/**
 * 单体 Gumball 枢轴：角色取当前姿势骨骼包围盒中心，其它对象取世界 AABB 中心。
 * 与 topview canvas `resolveGizmoPivotWorld` 同一口径。
 */
export function resolveGizmoPivotWorld(mesh: THREE.Object3D): { x: number; y: number; z: number } {
  const bounds = resolveObjectWorldBounds(mesh)
  if (bounds) {
    return {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
    }
  }
  const wp = mesh.getWorldPosition(new THREE.Vector3())
  return { x: wp.x, y: wp.y, z: wp.z }
}

/**
 * 多选枢轴：各对象几何中心的算术平均，不用并集包围盒
 * （角色手臂展开会把并集中心拉偏）。
 */
export function resolveMultiSelectionPivotWorld(
  meshes: readonly THREE.Object3D[],
): { x: number; y: number; z: number } | null {
  let sumX = 0
  let sumY = 0
  let sumZ = 0
  let count = 0
  for (const mesh of meshes) {
    const center = resolveGizmoPivotWorld(mesh)
    sumX += center.x
    sumY += center.y
    sumZ += center.z
    count += 1
  }
  if (count === 0) return null
  return { x: sumX / count, y: sumY / count, z: sumZ / count }
}
