import * as THREE from 'three'

export interface FrameBBoxHalfSize {
  x: number
  y: number
  z: number
}

export interface WorldBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

const FRAME_MARGIN = 1.12
const FRAME_NEAR_CLEARANCE = 0.4
const DEFAULT_RESET_OFFSET = { x: 0, y: 2, z: 5 }

const CORNER_SIGNS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1],
  [-1, -1, 1],
  [-1, 1, -1],
  [-1, 1, 1],
  [1, -1, -1],
  [1, -1, 1],
  [1, 1, -1],
  [1, 1, 1],
]

function normalizedHalfSize(halfSize: FrameBBoxHalfSize): { x: number; y: number; z: number } {
  return {
    x: Math.max(halfSize.x, 0.25),
    y: Math.max(halfSize.y, 0.25),
    z: Math.max(halfSize.z, 0.25),
  }
}

function computeFrameAxesForOffsetDir(
  offsetDir: THREE.Vector3,
  upHint: THREE.Vector3,
): { viewDir: THREE.Vector3; viewRight: THREE.Vector3; viewUp: THREE.Vector3 } {
  const viewDir = offsetDir.clone().normalize()
  const forward = viewDir.clone().negate()
  let up = upHint.clone()
  if (up.lengthSq() < 1e-6) up.set(0, 1, 0)
  else up.normalize()

  let right = new THREE.Vector3().crossVectors(up, forward)
  if (right.lengthSq() < 1e-6) {
    up.set(Math.abs(forward.y) > 0.9 ? 1 : 0, Math.abs(forward.y) > 0.9 ? 0 : 1, 0)
    right = new THREE.Vector3().crossVectors(up, forward)
  }
  right.normalize()
  up = new THREE.Vector3().crossVectors(forward, right).normalize()
  return { viewDir, viewRight: right, viewUp: up }
}

function computeFrameDistanceMetrics(input: {
  offsetDir: THREE.Vector3
  upHint: THREE.Vector3
  halfSize: FrameBBoxHalfSize
  aspect: number
  fovDeg: number
}): { requiredDistance: number; depthExtent: number } {
  const { offsetDir, upHint, halfSize, aspect, fovDeg } = input
  const { x: hx, y: hy, z: hz } = normalizedHalfSize(halfSize)
  const { viewDir, viewRight, viewUp } = computeFrameAxesForOffsetDir(offsetDir, upHint)
  const rel = new THREE.Vector3()
  const halfVertRad = (fovDeg * Math.PI) / 180 / 2
  const halfHorizRad = Math.atan(Math.tan(halfVertRad) * Math.max(0.1, aspect))
  const tanVert = Math.tan(halfVertRad)
  const tanHoriz = Math.tan(halfHorizRad)
  let requiredDistance = 0.5
  let maxAlongView = 0
  for (const [sx, sy, sz] of CORNER_SIGNS) {
    rel.set(sx * hx, sy * hy, sz * hz)
    const alongView = rel.dot(viewDir)
    const planeRight = Math.abs(rel.dot(viewRight))
    const planeUp = Math.abs(rel.dot(viewUp))
    maxAlongView = Math.max(maxAlongView, alongView)
    requiredDistance = Math.max(
      requiredDistance,
      alongView + planeUp / tanVert,
      alongView + planeRight / tanHoriz,
    )
  }
  return {
    requiredDistance: requiredDistance * FRAME_MARGIN + FRAME_NEAR_CLEARANCE,
    depthExtent: maxAlongView + FRAME_NEAR_CLEARANCE,
  }
}

export function computeFocusCameraPose(input: {
  center: THREE.Vector3
  halfSize: FrameBBoxHalfSize
  aspect: number
  fovDeg: number
}): { position: THREE.Vector3; distance: number; rotation: { x: number; y: number; z: number } } {
  const offsetDir = new THREE.Vector3(
    DEFAULT_RESET_OFFSET.x,
    DEFAULT_RESET_OFFSET.y,
    DEFAULT_RESET_OFFSET.z,
  ).normalize()
  const metrics = computeFrameDistanceMetrics({
    offsetDir,
    upHint: new THREE.Vector3(0, 1, 0),
    halfSize: input.halfSize,
    aspect: input.aspect,
    fovDeg: input.fovDeg,
  })
  const position = input.center.clone().addScaledVector(offsetDir, metrics.requiredDistance)
  const temp = new THREE.PerspectiveCamera()
  temp.position.copy(position)
  temp.up.set(0, 1, 0)
  temp.lookAt(input.center)
  temp.rotation.order = 'YXZ'
  return {
    position,
    distance: metrics.requiredDistance,
    rotation: {
      x: THREE.MathUtils.radToDeg(temp.rotation.x),
      y: THREE.MathUtils.radToDeg(temp.rotation.y),
      z: THREE.MathUtils.radToDeg(temp.rotation.z),
    },
  }
}

function computeBoneWorldBounds(root: THREE.Object3D): WorldBounds | null {
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  let count = 0
  const boneWorldPos = new THREE.Vector3()
  root.traverse((child) => {
    if (!(child as THREE.Bone).isBone) return
    child.getWorldPosition(boneWorldPos)
    if (boneWorldPos.x < minX) minX = boneWorldPos.x
    if (boneWorldPos.x > maxX) maxX = boneWorldPos.x
    if (boneWorldPos.y < minY) minY = boneWorldPos.y
    if (boneWorldPos.y > maxY) maxY = boneWorldPos.y
    if (boneWorldPos.z < minZ) minZ = boneWorldPos.z
    if (boneWorldPos.z > maxZ) maxZ = boneWorldPos.z
    count += 1
  })
  return count > 0 ? { minX, maxX, minY, maxY, minZ, maxZ } : null
}

export function resolveObjectWorldBounds(mesh: THREE.Object3D): WorldBounds | null {
  mesh.updateMatrixWorld(true)
  if (mesh.userData.isRiggedCharacter) return computeBoneWorldBounds(mesh)
  const box = new THREE.Box3().setFromObject(mesh)
  if (box.isEmpty()) return null
  return {
    minX: box.min.x,
    maxX: box.max.x,
    minY: box.min.y,
    maxY: box.max.y,
    minZ: box.min.z,
    maxZ: box.max.z,
  }
}

export function unionWorldBounds(objects: Iterable<THREE.Object3D>): THREE.Box3 | null {
  const box = new THREE.Box3()
  let any = false
  for (const mesh of objects) {
    if (!mesh.visible) continue
    const bounds = resolveObjectWorldBounds(mesh)
    if (!bounds) continue
    box.expandByPoint(new THREE.Vector3(bounds.minX, bounds.minY, bounds.minZ))
    box.expandByPoint(new THREE.Vector3(bounds.maxX, bounds.maxY, bounds.maxZ))
    any = true
  }
  return any && !box.isEmpty() ? box : null
}
