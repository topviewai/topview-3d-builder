import * as THREE from 'three'

const _ndc = new THREE.Vector2(0, 0)
const _raycaster = new THREE.Raycaster()
const _ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const _hit = new THREE.Vector3()
const _dir = new THREE.Vector3()

const VIEW_CENTER_FALLBACK_DIST = 4
/** 视线接近水平时地面命中点会跑到几百米外，支点太远环绕就退化成平移，所以要夹住。 */
const VIEW_CENTER_MAX_DIST = 30
const VIEW_CENTER_MIN_DIST = 0.5

function pointOnCenterRay(camera: THREE.PerspectiveCamera, distance: number): { x: number; y: number; z: number } {
  const origin = _raycaster.ray.origin
  const dir = _raycaster.ray.direction
  return {
    x: origin.x + dir.x * distance,
    y: origin.y + dir.y * distance,
    z: origin.z + dir.z * distance,
  }
}

/** 屏幕正中对应的场景点：先打物体，再打地面，最后退到当前看点。距离统一夹在可用区间内。 */
export function computeViewCenterPivot(
  camera: THREE.PerspectiveCamera,
  meshes: THREE.Object3D[],
  fallback: { x: number; y: number; z: number } | null,
): { x: number; y: number; z: number } {
  camera.updateMatrixWorld()
  _raycaster.setFromCamera(_ndc, camera)
  if (meshes.length > 0) {
    const hits = _raycaster.intersectObjects(meshes, true)
    if (hits[0]) return pointOnCenterRay(camera, clampCenterDist(hits[0].distance))
  }
  if (_raycaster.ray.intersectPlane(_ground, _hit)) {
    return pointOnCenterRay(camera, clampCenterDist(_hit.distanceTo(_raycaster.ray.origin)))
  }
  if (fallback) return { x: fallback.x, y: fallback.y, z: fallback.z }
  camera.getWorldDirection(_dir)
  return {
    x: camera.position.x + _dir.x * VIEW_CENTER_FALLBACK_DIST,
    y: camera.position.y + _dir.y * VIEW_CENTER_FALLBACK_DIST,
    z: camera.position.z + _dir.z * VIEW_CENTER_FALLBACK_DIST,
  }
}

function clampCenterDist(distance: number): number {
  return Math.max(VIEW_CENTER_MIN_DIST, Math.min(VIEW_CENTER_MAX_DIST, distance))
}
