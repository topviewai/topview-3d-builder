import * as THREE from 'three'
import { CHARACTER_LABEL_KIND, OBJECT_LABEL_KIND } from './environment'
import type { StageGraph } from './graph'

const _box = new THREE.Box3()
const _meshBox = new THREE.Box3()
const _center = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _origin = new THREE.Vector3()
const _down = new THREE.Vector3(0, -1, 0)
const _worldNormal = new THREE.Vector3()
const _raycaster = new THREE.Raycaster()
const _meshes: THREE.Mesh[] = []

/** 只把朝上的面当成承托面，排除侧板 / 背板。 */
const UP_FACE_DOT = 0.55

const SUPPORT_HIT_GRID = 9

function isLabel(obj: THREE.Object3D): boolean {
  return obj.userData?.t3dKind === CHARACTER_LABEL_KIND || obj.userData?.t3dKind === OBJECT_LABEL_KIND
}

function sanitizeBone(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isFootBoneName(name: string): boolean {
  const n = sanitizeBone(name)
  if (!n || n.includes('footstep')) return false
  return n.includes('foot') || n.includes('toe') || n.includes('ankle')
}

function isBone(obj: THREE.Object3D): boolean {
  return (obj as THREE.Bone).isBone === true
}

function isHipBoneName(name: string): boolean {
  const n = sanitizeBone(name)
  return n === 'hips' || n === 'mixamorighips' || n === 'pelvis' || n === 'hip' || n === 'ccbasehip'
}

function isCrownBoneName(name: string): boolean {
  const n = sanitizeBone(name)
  if (n.includes('headtop')) return true
  return n === 'head' || n === 'mixamorighead' || n === 'ccbasehead'
}

function crownBonePriority(name: string): number {
  return sanitizeBone(name).includes('headtop') ? 2 : 1
}

function isAimBoneName(name: string): boolean {
  const n = sanitizeBone(name)
  return (
    n === 'mixamorigspine2' ||
    n === 'spine2' ||
    n === 'chest' ||
    n === 'mixamorigspine1' ||
    n === 'spine1' ||
    n === 'mixamorighead' ||
    n === 'head' ||
    n === 'hips' ||
    n === 'mixamorighips'
  )
}

function aimBonePriority(name: string): number {
  const n = sanitizeBone(name)
  if (n.includes('spine2') || n === 'chest') return 3
  if (n.includes('spine1') || n.includes('spine')) return 2
  if (n.includes('head')) return 1
  if (n.includes('hip')) return 0
  return -1
}

function expandVisibleMesh(root: THREE.Object3D, box: THREE.Box3): void {
  box.makeEmpty()
  root.traverse((obj) => {
    if (isLabel(obj)) return
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    const geoBox = mesh.geometry.boundingBox
    if (!geoBox || geoBox.isEmpty()) return
    _meshBox.copy(geoBox).applyMatrix4(mesh.matrixWorld)
    box.union(_meshBox)
  })
}

function objectForBounds(graph: StageGraph, nodeId: string): THREE.Object3D | null {
  return (
    graph.characters.get(nodeId)?.root ??
    graph.props.get(nodeId) ??
    graph.primitives.get(nodeId) ??
    graph.groups.get(nodeId) ??
    null
  )
}

export interface WorldAabb {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
  centerX: number
  centerY: number
  centerZ: number
}

function fillVisibleBounds(graph: StageGraph, nodeId: string): boolean {
  const ch = graph.characters.get(nodeId)
  if (ch) {
    ch.root.updateWorldMatrix(true, true)
    expandVisibleMesh(ch.inner, _box)
    return !_box.isEmpty()
  }
  const obj = objectForBounds(graph, nodeId)
  if (!obj) return false
  obj.updateWorldMatrix(true, true)
  expandVisibleMesh(obj, _box)
  return !_box.isEmpty()
}

/** 可见网格的世界 AABB（人物不含姓名牌）。 */
export function worldAabb(graph: StageGraph, nodeId: string): WorldAabb | null {
  if (!fillVisibleBounds(graph, nodeId)) return null
  _box.getCenter(_center)
  return {
    minX: _box.min.x,
    minY: _box.min.y,
    minZ: _box.min.z,
    maxX: _box.max.x,
    maxY: _box.max.y,
    maxZ: _box.max.z,
    centerX: _center.x,
    centerY: _center.y,
    centerZ: _center.z,
  }
}

/** 当前姿势下与地面的接触点：人物用脚底中点，道具用可见网格底面中心。 */
export function worldContactPoint(
  graph: StageGraph,
  nodeId: string,
): { x: number; y: number; z: number } | null {
  const ch = graph.characters.get(nodeId)
  if (ch) {
    ch.root.updateWorldMatrix(true, true)
    let minY: number | null = null
    let sx = 0
    let sz = 0
    let n = 0
    ch.inner.traverse((obj) => {
      if (!obj.name || !isFootBoneName(obj.name)) return
      obj.getWorldPosition(_pos)
      minY = minY === null ? _pos.y : Math.min(minY, _pos.y)
      sx += _pos.x
      sz += _pos.z
      n += 1
    })
    if (n > 0 && minY !== null) return { x: sx / n, y: minY, z: sz / n }
    expandVisibleMesh(ch.inner, _box)
    if (_box.isEmpty()) return null
    _box.getCenter(_center)
    return { x: _center.x, y: _box.min.y, z: _center.z }
  }
  const obj = objectForBounds(graph, nodeId)
  if (!obj) return null
  obj.updateWorldMatrix(true, true)
  expandVisibleMesh(obj, _box)
  if (_box.isEmpty()) return null
  _box.getCenter(_center)
  return { x: _center.x, y: _box.min.y, z: _center.z }
}

/** 当前姿势下与地面的接触高度：人物用脚/脚趾世界 Y，道具用包围盒底。 */
export function worldContactY(graph: StageGraph, nodeId: string): number | null {
  return worldContactPoint(graph, nodeId)?.y ?? null
}

function collectVisibleMeshes(root: THREE.Object3D, out: THREE.Mesh[]): void {
  root.traverse((obj) => {
    if (isLabel(obj) || !obj.visible) return
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    out.push(mesh)
  })
}

function supportMeshRoot(graph: StageGraph, nodeId: string): THREE.Object3D | null {
  const ch = graph.characters.get(nodeId)
  if (ch) {
    ch.root.updateWorldMatrix(true, true)
    return ch.inner
  }
  const obj = objectForBounds(graph, nodeId)
  if (!obj) return null
  obj.updateWorldMatrix(true, true)
  return obj
}

/**
 * 人物蒙皮网格的 bind-pose 射线会打到脚面，不能当承托面。
 * 用当前姿势的髋骨水平位置 + 头顶骨骼高度。
 */
function characterSupportRest(
  graph: StageGraph,
  nodeId: string,
): { x: number; y: number; z: number } | null {
  const ch = graph.characters.get(nodeId)
  if (!ch) return null
  ch.root.updateWorldMatrix(true, true)
  let hipX: number | null = null
  let hipZ: number | null = null
  let crownPri = -1
  let crownX = 0
  let crownY = 0
  let crownZ = 0
  let maxY = -Infinity
  let maxX = 0
  let maxZ = 0
  ch.inner.traverse((obj) => {
    if (!isBone(obj) || !obj.name) return
    obj.getWorldPosition(_pos)
    if (isHipBoneName(obj.name)) {
      hipX = _pos.x
      hipZ = _pos.z
    }
    if (isCrownBoneName(obj.name)) {
      const pri = crownBonePriority(obj.name)
      if (pri > crownPri) {
        crownPri = pri
        crownX = _pos.x
        crownY = _pos.y
        crownZ = _pos.z
      }
    }
    if (_pos.y > maxY) {
      maxY = _pos.y
      maxX = _pos.x
      maxZ = _pos.z
    }
  })
  const topY = crownPri >= 0 ? crownY : maxY
  if (topY === -Infinity) return null
  const pad = crownPri >= 2 ? 0.04 : crownPri === 1 ? 0.12 : 0.06
  return {
    x: hipX ?? (crownPri >= 0 ? crownX : maxX),
    y: topY + pad,
    z: hipZ ?? (crownPri >= 0 ? crownZ : maxZ),
  }
}

function hitWorldNormal(hit: THREE.Intersection): THREE.Vector3 | null {
  if (hit.normal) return hit.normal
  if (!hit.face) return null
  _worldNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld)
  return _worldNormal
}

function firstUpwardHit(
  found: THREE.Intersection[],
): { x: number; y: number; z: number } | null {
  for (const hit of found) {
    const normal = hitWorldNormal(hit)
    if (normal && normal.y < UP_FACE_DOT) continue
    const p = hit.point
    return { x: p.x, y: p.y, z: p.z }
  }
  return null
}

/**
 * 对承托节点可见网格做向下射线采样，返回实际三角形命中。
 * 网格未加载或无几何时返回空数组；节点不存在返回 null。
 */
export function meshSupportHits(
  graph: StageGraph,
  nodeId: string,
): { x: number; y: number; z: number }[] | null {
  const root = supportMeshRoot(graph, nodeId)
  if (!root) return null
  const crown = characterSupportRest(graph, nodeId)
  if (crown) return [crown]
  if (!fillVisibleBounds(graph, nodeId)) return []
  _meshes.length = 0
  collectVisibleMeshes(root, _meshes)
  if (_meshes.length === 0) return []

  const minX = _box.min.x
  const maxX = _box.max.x
  const minY = _box.min.y
  const maxY = _box.max.y
  const minZ = _box.min.z
  const maxZ = _box.max.z
  const height = Math.max(1e-4, maxY - minY)
  const fromY = maxY + Math.max(0.05, height * 0.05)
  _raycaster.near = 0
  _raycaster.far = fromY - minY + Math.max(0.1, height * 0.1)
  _raycaster.ray.direction.copy(_down)

  const spanX = maxX - minX
  const spanZ = maxZ - minZ
  const hits: { x: number; y: number; z: number }[] = []
  const last = SUPPORT_HIT_GRID - 1
  for (let ix = 0; ix <= last; ix += 1) {
    for (let iz = 0; iz <= last; iz += 1) {
      const x = minX + (spanX * ix) / last
      const z = minZ + (spanZ * iz) / last
      _origin.set(x, fromY, z)
      _raycaster.ray.origin.copy(_origin)
      const found = _raycaster.intersectObjects(_meshes, false)
      const hit = firstUpwardHit(found)
      if (!hit) continue
      hits.push(hit)
    }
  }
  return hits
}

/** 看向人物时的瞄准点：胸口 / 头 / 髋骨骼，否则包围盒中心。 */
export function worldAimPoint(
  graph: StageGraph,
  nodeId: string,
): { x: number; y: number; z: number } | null {
  const ch = graph.characters.get(nodeId)
  if (ch) {
    ch.root.updateWorldMatrix(true, true)
    let bestPriority = -1
    let aimX = 0
    let aimY = 0
    let aimZ = 0
    ch.inner.traverse((obj) => {
      if (!obj.name || !isAimBoneName(obj.name)) return
      const priority = aimBonePriority(obj.name)
      if (priority < 0 || priority <= bestPriority) return
      obj.getWorldPosition(_pos)
      bestPriority = priority
      aimX = _pos.x
      aimY = _pos.y
      aimZ = _pos.z
    })
    if (bestPriority >= 0) return { x: aimX, y: aimY, z: aimZ }
    expandVisibleMesh(ch.inner, _box)
    if (!_box.isEmpty()) {
      _box.getCenter(_center)
      return { x: _center.x, y: _center.y, z: _center.z }
    }
    return null
  }
  const obj = objectForBounds(graph, nodeId)
  if (!obj) return null
  obj.updateWorldMatrix(true, true)
  expandVisibleMesh(obj, _box)
  if (_box.isEmpty()) return null
  _box.getCenter(_center)
  return { x: _center.x, y: _center.y, z: _center.z }
}
