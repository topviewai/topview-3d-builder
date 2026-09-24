import * as THREE from 'three'

export interface ContainerScreenRect {
  left: number
  top: number
  width: number
  height: number
}

/** Project all twelve edges of a world-space bounding box, preserving its depth. */
export function projectObjectWireframe(mesh: THREE.Object3D, camera: THREE.Camera, container: HTMLElement) {
  mesh.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(mesh)
  if (box.isEmpty()) return []
  const corners = Array.from({ length: 8 }, (_, i) => projectWorldToContainer(camera, container,
    new THREE.Vector3(i & 4 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 1 ? box.max.z : box.min.z)))
  const edges: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (let i = 0; i < 8; i++) {
    for (const axis of [1, 2, 4]) {
      if (i & axis) continue
      const a = corners[i], b = corners[i | axis]
      if (a?.visible && b?.visible) edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
    }
  }
  return edges
}

export function normalizeContainerScreenRect(
  container: HTMLElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): ContainerScreenRect {
  const bounds = container.getBoundingClientRect()
  const left = Math.min(x0, x1) - bounds.left
  const top = Math.min(y0, y1) - bounds.top
  return {
    left,
    top,
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  }
}

export function rectsIntersect(a: ContainerScreenRect, b: ContainerScreenRect): boolean {
  return (
    a.left < b.left + b.width
    && a.left + a.width > b.left
    && a.top < b.top + b.height
    && a.top + a.height > b.top
  )
}

export function projectWorldToContainer(
  camera: THREE.Camera,
  container: HTMLElement,
  point: THREE.Vector3,
): { x: number; y: number; visible: boolean } | null {
  const bounds = container.getBoundingClientRect()
  const width = bounds.width
  const height = bounds.height
  if (width === 0 || height === 0) return null
  const projected = point.clone().project(camera)
  return {
    x: (projected.x * 0.5 + 0.5) * width,
    y: (-projected.y * 0.5 + 0.5) * height,
    visible: projected.z >= -1 && projected.z <= 1,
  }
}

export function projectObjectToContainerRect(
  mesh: THREE.Object3D,
  camera: THREE.Camera,
  container: HTMLElement,
): ContainerScreenRect | null {
  mesh.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(mesh)
  if (box.isEmpty()) return null

  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ]

  const bounds = container.getBoundingClientRect()
  const width = bounds.width
  const height = bounds.height
  if (width === 0 || height === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let visible = false

  for (const corner of corners) {
    const projected = corner.clone().project(camera)
    if (projected.z < -1 || projected.z > 1) continue
    visible = true
    const sx = (projected.x * 0.5 + 0.5) * width
    const sy = (-projected.y * 0.5 + 0.5) * height
    minX = Math.min(minX, sx)
    minY = Math.min(minY, sy)
    maxX = Math.max(maxX, sx)
    maxY = Math.max(maxY, sy)
  }

  if (!visible || !Number.isFinite(minX)) return null
  return {
    left: minX,
    top: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  }
}

export function pickObjectIdsInContainerRect(
  camera: THREE.Camera,
  container: HTMLElement,
  objectMeshMap: ReadonlyMap<string, THREE.Object3D>,
  rect: ContainerScreenRect,
): string[] {
  const result: string[] = []
  objectMeshMap.forEach((mesh, id) => {
    if (!mesh.visible) return
    const objectRect = projectObjectToContainerRect(mesh, camera, container)
    if (objectRect && rectsIntersect(rect, objectRect)) result.push(id)
  })
  return result
}
