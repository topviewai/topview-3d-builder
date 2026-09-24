import * as THREE from 'three'
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'

export interface GizmoDuplicateTransform {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
}

export interface GizmoDuplicateItem extends GizmoDuplicateTransform {
  id: string
  from?: GizmoDuplicateTransform
}

const GHOST_OPACITY = 0.35

function toGhostMaterial(mat: THREE.Material): THREE.Material {
  const cloned = mat.clone()
  cloned.transparent = true
  cloned.opacity = GHOST_OPACITY
  cloned.depthWrite = false
  return cloned
}

export function createGhostClone(source: THREE.Object3D): THREE.Object3D {
  const ghost = source.userData.isRiggedCharacter ? skeletonClone(source) : source.clone(true)
  ghost.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.userData.__ghostSharedGeometry = true
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(toGhostMaterial)
    } else if (mesh.material) {
      mesh.material = toGhostMaterial(mesh.material)
    }
  })
  ghost.userData.isDuplicateGhost = true
  return ghost
}

export function disposeGhostMesh(ghost: THREE.Object3D): void {
  ghost.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    const mat = mesh.material
    if (Array.isArray(mat)) mat.forEach((item) => item.dispose())
    else mat?.dispose()
  })
}

export function localTransformOf(object: THREE.Object3D): GizmoDuplicateTransform {
  return localTransformFromTRS(object.position, object.quaternion, object.scale)
}

export function localTransformFromTRS(
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  scale: THREE.Vector3,
): GizmoDuplicateTransform {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ')
  return {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: {
      x: THREE.MathUtils.radToDeg(euler.x),
      y: THREE.MathUtils.radToDeg(euler.y),
      z: THREE.MathUtils.radToDeg(euler.z),
    },
    scale: { x: scale.x, y: scale.y, z: scale.z },
  }
}
