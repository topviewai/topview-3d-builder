import * as THREE from 'three'

interface Vec3 {
  x: number
  y: number
  z: number
}

const FACE_EPS = 1e-5

let box3Scratch: THREE.Box3 | null = null
let pointScratch: THREE.Vector3 | null = null
let closestScratch: THREE.Vector3 | null = null

function ensureClearanceScratch(): {
  box: THREE.Box3
  point: THREE.Vector3
  closest: THREE.Vector3
} {
  if (!box3Scratch) box3Scratch = new THREE.Box3()
  if (!pointScratch) pointScratch = new THREE.Vector3()
  if (!closestScratch) closestScratch = new THREE.Vector3()
  return { box: box3Scratch, point: pointScratch, closest: closestScratch }
}

function isEnvironmentGround(mesh: THREE.Object3D): boolean {
  return mesh.name === 't3d-ground'
    || mesh.name === 't3d-grid'
    || mesh.userData.t3dKind === 'groundGrid'
    || mesh.type === 'GridHelper'
}

function isGroundLikeBox(box: THREE.Box3): boolean {
  const hx = box.max.x - box.min.x
  const hy = box.max.y - box.min.y
  const hz = box.max.z - box.min.z
  const horiz = Math.max(hx, hz)
  return horiz >= 4 && hy <= Math.max(1, horiz * 0.2)
}

/** 顶面命中：相机在盒顶之上（或贴顶）。这是高度限制，漫游相机不再拦。 */
function isDownwardGroundHit(point: THREE.Vector3, closest: THREE.Vector3, box: THREE.Box3): boolean {
  return closest.y >= box.max.y - FACE_EPS && point.y >= closest.y - FACE_EPS
}

function isVerticalOnlyHit(point: THREE.Vector3, closest: THREE.Vector3): boolean {
  return Math.abs(point.x - closest.x) <= FACE_EPS && Math.abs(point.z - closest.z) <= FACE_EPS
}

/** 在盒内时，若最近出口是顶面，或盒子本身是地面薄板，不按撞墙处理。 */
function isInsideGroundSlab(point: THREE.Vector3, box: THREE.Box3): boolean {
  if (isGroundLikeBox(box)) return true
  const distTop = box.max.y - point.y
  const distBottom = point.y - box.min.y
  const distX = Math.min(point.x - box.min.x, box.max.x - point.x)
  const distZ = Math.min(point.z - box.min.z, box.max.z - point.z)
  return distTop <= distBottom && distTop <= distX && distTop <= distZ
}

/**
 * 相机到最近场景物体的净空（世界单位）。
 * 只计侧向 / 底面，不计地面顶面与环境地面网格，避免下降贴地时被顶回而震颤。
 */
export function measureNearestSurfaceClearance(
  origin: Vec3,
  sceneMeshes: readonly THREE.Object3D[],
): number | null {
  if (sceneMeshes.length === 0) return null

  let nearest: number | null = null
  const { box, point, closest } = ensureClearanceScratch()
  point.set(origin.x, origin.y, origin.z)

  for (const mesh of sceneMeshes) {
    if (isEnvironmentGround(mesh)) continue
    box.setFromObject(mesh)
    if (box.isEmpty()) continue
    if (box.containsPoint(point)) {
      if (isInsideGroundSlab(point, box)) continue
      nearest = 0
      continue
    }
    box.clampPoint(point, closest)
    if (isDownwardGroundHit(point, closest, box)) continue
    if (isGroundLikeBox(box) && isVerticalOnlyHit(point, closest)) continue
    const dist = point.distanceTo(closest)
    nearest = nearest === null ? dist : Math.min(nearest, dist)
  }

  return nearest
}

export function computeProximitySpeedFactor(
  surfaceDistance: number | null,
  dampStart: number,
  dampEnd: number,
  minFactor: number,
): number {
  if (surfaceDistance === null || surfaceDistance >= dampStart) return 1
  if (surfaceDistance <= dampEnd) return minFactor
  const t = (surfaceDistance - dampEnd) / (dampStart - dampEnd)
  const smooth = t * t * (3 - 2 * t)
  return minFactor + smooth * (1 - minFactor)
}

export function computeWheelProximitySpeedFactor(
  clearance: number | null,
  zoomIn: boolean,
  dampStart: number,
  dampEnd: number,
  minFactor: number,
): number {
  if (clearance === null) return 1

  if (!zoomIn) {
    if (clearance >= dampEnd) return 1
    const t = clearance / dampEnd
    const smooth = t * t * (3 - 2 * t)
    return minFactor + smooth * (1 - minFactor)
  }

  const factor = computeProximitySpeedFactor(clearance, dampStart, dampEnd, minFactor)
  if (factor >= 1) return 1
  const span = 1 - minFactor
  if (span <= 0) return factor
  const normalized = (factor - minFactor) / span
  return minFactor + normalized * normalized * span
}

export function collectSceneObjectMeshes(
  meshMap: ReadonlyMap<string, THREE.Object3D>,
): THREE.Object3D[] {
  return Array.from(meshMap.values())
}
