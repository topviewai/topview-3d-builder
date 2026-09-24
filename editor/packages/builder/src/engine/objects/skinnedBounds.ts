import * as THREE from 'three'

/** @types/three 把这两个字段写成非空，运行时默认是 null，three 自己也按 null 判断是否重算。 */
interface SkinnedBoundsCache {
  boundingBox: THREE.Box3 | null
  boundingSphere: THREE.Sphere | null
}

/**
 * SkinnedMesh 的 boundingBox / boundingSphere 只在为 null 时算一次就长期缓存，
 * Box3.setFromObject（量标签高度、框选、取景）也会顺手把当时的体积写进去。
 * 骨骼摆过姿势后这份缓存还是旧体积，而 SkinnedMesh.raycast 会先拿它做剔除，
 * 身体一旦离开旧盒子，射线直接返回，人物在视口里就点不中。
 *
 * 姿势变更后置空，交给下一次 raycast 按当时的骨骼世界矩阵重算；不要在这里重算，
 * 此刻骨骼的 matrixWorld 还没随本帧更新。
 */
export function clearSkinnedRaycastBounds(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    const cache = mesh as unknown as SkinnedBoundsCache
    cache.boundingBox = null
    cache.boundingSphere = null
  })
}
