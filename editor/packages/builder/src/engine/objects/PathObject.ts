import * as THREE from 'three'
import type { DraftNode } from '../../contract/types'
import { isDerivedTransformPath } from '../../evaluate/path/deriveWalk'
import {
  pathControlCentroid,
  samplePathPoints,
  samplePathWorldFromControls,
  transformPathLocalPoint,
} from '../../evaluate/path/samplePath'
import { EDITOR_LAYER } from '../core/Layers'
import type { StageGraph } from './graph'
import { projectObjectToContainerRect, rectsIntersect, type ContainerScreenRect } from '../interact/selectionBox'

const PATH_COLORS = {
  line: { color: 0x6f9fb2, opacity: 0.62 },
  lineSelected: { color: 0xffb13b, opacity: 1 },
  direction: { color: 0x74aabd, opacity: 0.62 },
  directionSelected: { color: 0xffa12b, opacity: 1 },
  point: { color: 0xf7fbff, opacity: 0.82 },
  pointStart: { color: 0x61d394, opacity: 0.82 },
  pointEnd: { color: 0xff6b6b, opacity: 0.82 },
  pointSelected: { color: 0xffc766, opacity: 1 },
  pointEdit: { color: 0xffe08a, opacity: 1 },
  pointEditActive: { color: 0xffffff, opacity: 1 },
} as const

const PATH_POINT_RADIUS = 0.11
const PATH_END_POINT_RADIUS = 0.15
const PATH_POINT_HIT_RADIUS = 0.16
const PATH_EDIT_DIM_OPACITY = 0.24

const DIMMED_OPACITY = '__pathEditDimmedOpacity'
const DIMMED_TRANSPARENT = '__pathEditDimmedTransparent'
const DIMMED_DEPTH_WRITE = '__pathEditDimmedDepthWrite'

export interface PathMaterials {
  line: THREE.LineBasicMaterial | null
  lineObj: THREE.Line | null
  direction: THREE.MeshBasicMaterial | null
  points: {
    mesh: THREE.Mesh
    mat: THREE.MeshBasicMaterial
    base: { color: number; opacity: number }
  }[]
}

export interface PathViewHost extends StageGraph {
  editorCamera: THREE.Camera
  pathViews: Map<string, THREE.Group>
  pathPickTargets: Map<string, THREE.Object3D>
  pathMaterials: Map<string, PathMaterials>
  selectedPathId: string | null
  visiblePathIds: Set<string>
  pathEditingId?: string | null
  pathEditPointIndex?: number | null
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh
    mesh.geometry?.dispose?.()
    const m = mesh.material
    if (!m) return
    const list = Array.isArray(m) ? m : [m]
    for (const mm of list) mm.dispose?.()
  })
}

export function buildPathInstance(graph: PathViewHost, n: DraftNode): void {
  const existing = graph.pathViews.get(n.id)
  if (existing) {
    disposeObject(existing)
    graph.scene.remove(existing)
    graph.pathViews.delete(n.id)
    graph.pathPickTargets.delete(n.id)
    graph.pathMaterials.delete(n.id)
  }
  graph.nodeById.set(n.id, n)
  graph.pathNodes.set(n.id, n)
  if (!n.path || n.path.points.length < 1) return
  const center = pathControlCentroid(n)
  const g = new THREE.Group()
  g.name = n.id
  const mats: PathMaterials = { line: null, lineObj: null, direction: null, points: [] }

  const line = samplePathPoints(n).map((p) => new THREE.Vector3(p.x, p.y, p.z))
  if (line.length >= 2) {
    mats.line = new THREE.LineBasicMaterial({
      color: PATH_COLORS.line.color,
      transparent: true,
      opacity: PATH_COLORS.line.opacity,
    })
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(line), mats.line)
    l.name = `${n.id}_line`
    l.renderOrder = 8
    g.add(l)
    mats.lineObj = l

    if (!isDerivedTransformPath(n)) {
      const hit = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line), Math.min(line.length * 4, 600), 0.1, 6, false),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      )
      hit.name = `${n.id}_hit_area`
      g.add(hit)
      graph.pathPickTargets.set(n.id, hit)
    }

    const coneGeo = new THREE.ConeGeometry(0.055, 0.16, 16)
    mats.direction = new THREE.MeshBasicMaterial({
      color: PATH_COLORS.direction.color,
      transparent: true,
      opacity: PATH_COLORS.direction.opacity,
    })
    const step = Math.max(1, Math.floor(line.length / 12))
    for (let i = step; i < line.length - 1; i += step) {
      const c = new THREE.Mesh(coneGeo, mats.direction)
      c.position.copy(line[i])
      c.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        line[i + 1].clone().sub(line[i]).normalize(),
      )
      c.renderOrder = 9
      g.add(c)
    }
  }

  const last = n.path.points.length - 1
  // Transform-keyframe paths are sampled once per frame so the evaluator can
  // interpolate the motion accurately. Those samples are not keyframes,
  // though, so only render the segment endpoints as point markers. Keep the
  // full sampled line above for the actual trajectory shape.
  const showKeyframeMarkersOnly = n.metadata?.sourceType === 'transform-keyframes'
  for (let i = 0; i <= last; i++) {
    const p = n.path.points[i]
    const isEnd = i === 0 || i === last
    if (showKeyframeMarkersOnly && !isEnd) continue
    const base = i === 0 ? PATH_COLORS.pointStart : i === last ? PATH_COLORS.pointEnd : PATH_COLORS.point
    const mat = new THREE.MeshBasicMaterial({
      color: base.color,
      transparent: true,
      opacity: base.opacity,
    })
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(isEnd ? PATH_END_POINT_RADIUS : PATH_POINT_RADIUS, 16, 12),
      mat,
    )
    m.name = `${n.id}_point_${i + 1}`
    const wp = transformPathLocalPoint(p.position, n.transform, center)
    m.position.set(wp.x, wp.y, wp.z)
    m.renderOrder = 9
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(PATH_POINT_HIT_RADIUS, 8, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    )
    hit.name = `${n.id}_point_hit_${i + 1}`
    hit.userData.pathPointIndex = i
    m.add(hit)
    g.add(m)
    mats.points.push({ mesh: m, mat, base })
  }

  // Derived timeline paths are stored hidden in the draft. Keep them hidden
  // until their Clip is selected, but still build the editor representation so
  // a Timeline selection can reveal the corresponding path.
  g.visible = n.visible || graph.selectedPathId === n.id || graph.visiblePathIds.has(n.id)
  g.traverse((o) => o.layers.set(EDITOR_LAYER))
  graph.scene.add(g)
  graph.pathViews.set(n.id, g)
  graph.pathMaterials.set(n.id, mats)
  if (graph.selectedPathId === n.id || graph.pathEditingId === n.id) paintPath(graph, n.id, true)
}

export function removePathNode(graph: PathViewHost, id: string): void {
  const g = graph.pathViews.get(id)
  if (g) {
    disposeObject(g)
    graph.scene.remove(g)
    graph.pathViews.delete(id)
  }
  graph.pathPickTargets.delete(id)
  graph.pathMaterials.delete(id)
  if (graph.selectedPathId === id) graph.selectedPathId = null
  graph.pathNodes.delete(id)
  graph.nodeById.delete(id)
}

export function syncPathNodes(graph: PathViewHost): void {
  const doc = graph.doc
  if (!doc) return
  const wanted = new Map<string, DraftNode>()
  for (const n of doc.content.nodes) {
    if (n.type === 'path') wanted.set(n.id, n)
  }
  for (const id of [...graph.pathNodes.keys()]) {
    if (!wanted.has(id)) removePathNode(graph, id)
  }
  for (const [id, n] of wanted) {
    if (graph.pathNodes.get(id) === n) continue
    const g = graph.pathViews.get(id)
    if (g) {
      disposeObject(g)
      graph.scene.remove(g)
      graph.pathViews.delete(id)
      graph.pathPickTargets.delete(id)
      graph.pathMaterials.delete(id)
    }
    graph.pathNodes.delete(id)
    buildPathInstance(graph, n)
  }
}

export function syncPathSelection(
  graph: PathViewHost,
  selectedNodeId: string | null,
  visiblePathIds: Iterable<string> = [],
  hideAll = false,
): void {
  const next = selectedNodeId && graph.pathMaterials.has(selectedNodeId) ? selectedNodeId : null
  const nextVisible = new Set(visiblePathIds)
  const visibilityChanged =
    nextVisible.size !== graph.visiblePathIds.size || [...nextVisible].some((id) => !graph.visiblePathIds.has(id))
  if (!hideAll && next === graph.selectedPathId && !visibilityChanged) return
  if (graph.selectedPathId) {
    paintPath(graph, graph.selectedPathId, false)
  }
  graph.selectedPathId = next
  graph.visiblePathIds.clear()
  for (const id of nextVisible) graph.visiblePathIds.add(id)
  for (const [id, view] of graph.pathViews) {
    view.visible = hideAll ? false : graph.nodeById.get(id)?.visible ?? false
    if (!hideAll && (graph.visiblePathIds.has(id) || graph.selectedPathId === id)) view.visible = true
  }
  if (next) {
    paintPath(graph, next, true)
  }
}

function paintPath(graph: PathViewHost, id: string, selected: boolean): void {
  const mats = graph.pathMaterials.get(id)
  if (!mats) return
  const editing = graph.pathEditingId === id
  const activeIndex = editing ? graph.pathEditPointIndex : null
  const apply = (
    mat: THREE.Material & { color: THREE.Color; opacity: number },
    c: { color: number; opacity: number },
  ) => {
    mat.color.setHex(c.color)
    mat.opacity = c.opacity
  }
  if (mats.line) apply(mats.line, selected || editing ? PATH_COLORS.lineSelected : PATH_COLORS.line)
  if (mats.direction) {
    apply(mats.direction, selected || editing ? PATH_COLORS.directionSelected : PATH_COLORS.direction)
  }
  mats.points.forEach((p, i) => {
    if (editing && i === activeIndex) apply(p.mat, PATH_COLORS.pointEditActive)
    else if (editing) apply(p.mat, PATH_COLORS.pointEdit)
    else apply(p.mat, selected ? PATH_COLORS.pointSelected : p.base)
    p.mesh.scale.setScalar(editing ? (i === activeIndex ? 1.7 : 1.35) : 1)
  })
}

export function setPathEditAppearance(
  graph: PathViewHost,
  pathId: string | null,
  pointIndex: number | null,
): void {
  const prevId = graph.pathEditingId
  restorePathEditDim(graph)
  graph.pathEditingId = pathId
  graph.pathEditPointIndex = pathId == null ? null : pointIndex
  if (prevId && prevId !== pathId) paintPath(graph, prevId, graph.selectedPathId === prevId)
  if (pathId) paintPath(graph, pathId, true)
  else if (prevId) paintPath(graph, prevId, graph.selectedPathId === prevId)
  if (pathId) dimSceneForPathEdit(graph, pathId)
}

/** Keep the edited path readable while the rest of the stage recedes visually. */
function dimSceneForPathEdit(graph: PathViewHost, pathId: string): void {
  const edited = graph.pathViews.get(pathId)
  graph.scene.traverse((object) => {
    if (edited && (object === edited || edited.getObjectById(object.id))) return
    const material = (object as THREE.Mesh).material
    if (!material) return
    const materials = Array.isArray(material) ? material : [material]
    for (const mat of materials) {
      if (!('opacity' in mat)) continue
      const data = mat.userData as Record<string, unknown>
      if (data[DIMMED_OPACITY] == null) {
        data[DIMMED_OPACITY] = mat.opacity
        data[DIMMED_TRANSPARENT] = mat.transparent
        data[DIMMED_DEPTH_WRITE] = mat.depthWrite
      }
      mat.transparent = true
      mat.depthWrite = false
      mat.opacity = Math.min(mat.opacity, PATH_EDIT_DIM_OPACITY)
      mat.needsUpdate = true
    }
  })
}

function restorePathEditDim(graph: PathViewHost): void {
  graph.scene.traverse((object) => {
    const material = (object as THREE.Mesh).material
    if (!material) return
    const materials = Array.isArray(material) ? material : [material]
    for (const mat of materials) {
      const data = mat.userData as Record<string, unknown>
      if (typeof data[DIMMED_OPACITY] !== 'number') continue
      mat.opacity = data[DIMMED_OPACITY] as number
      mat.transparent = Boolean(data[DIMMED_TRANSPARENT])
      mat.depthWrite = Boolean(data[DIMMED_DEPTH_WRITE])
      mat.needsUpdate = true
      delete data[DIMMED_OPACITY]
      delete data[DIMMED_TRANSPARENT]
      delete data[DIMMED_DEPTH_WRITE]
    }
  })
}

export function pickPathPointIndicesInScreenRect(
  graph: PathViewHost,
  container: HTMLElement,
  rect: ContainerScreenRect,
  pathId: string,
): number[] {
  const points = graph.pathMaterials.get(pathId)?.points ?? []
  const result: number[] = []
  for (let i = 0; i < points.length; i++) {
    const pointRect = projectObjectToContainerRect(points[i].mesh, graph.editorCamera, container)
    if (pointRect && rectsIntersect(rect, pointRect)) result.push(i)
  }
  return result
}

export function pathPointObject(
  graph: PathViewHost,
  pathId: string,
  index: number,
): THREE.Object3D | null {
  return graph.pathMaterials.get(pathId)?.points[index]?.mesh ?? null
}

export function applyLivePathStroke(graph: PathViewHost, pathId: string): void {
  const mats = graph.pathMaterials.get(pathId)
  const node = graph.pathNodes.get(pathId)
  if (!mats?.lineObj || !node?.path || mats.points.length < 2) return
  const worlds = mats.points.map((p) => ({
    x: p.mesh.position.x,
    y: p.mesh.position.y,
    z: p.mesh.position.z,
  }))
  const pts = samplePathWorldFromControls(worlds, node.path.closed, node.path.parameterization)
  mats.lineObj.geometry.dispose()
  mats.lineObj.geometry = new THREE.BufferGeometry().setFromPoints(
    pts.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
  )
}

/** world = T(C+t) · R · S · T(-C)，与 transformPathLocalPoint 逐项等价。 */
function pathWorldMatrix(
  center: { x: number; y: number; z: number },
  transform: DraftNode['transform'],
): THREE.Matrix4 {
  const D2R = Math.PI / 180
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      transform.rotation.x * D2R,
      transform.rotation.y * D2R,
      transform.rotation.z * D2R,
      // Path evaluation applies Rx, then Ry, then Rz (Three.js ZYX).
      'ZYX',
    ),
  )
  return new THREE.Matrix4()
    .compose(
      new THREE.Vector3(
        center.x + transform.position.x,
        center.y + transform.position.y,
        center.z + transform.position.z,
      ),
      quaternion,
      new THREE.Vector3(transform.scale.x, transform.scale.y, transform.scale.z),
    )
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
}

/**
 * 整体拖拽预览：视图顶点已经烘进 node.transform，所以这里挂的是新旧变换的差分矩阵，
 * 线、方向锥、锚点一起动，不重建任何几何。松手后 refreshPathNode 重建回 identity。
 */
export function applyLivePathTransform(
  graph: PathViewHost,
  pathId: string,
  transform: DraftNode['transform'],
): void {
  const group = graph.pathViews.get(pathId)
  const node = graph.pathNodes.get(pathId)
  if (!group || !node?.path) return
  const center = pathControlCentroid(node)
  group.matrixAutoUpdate = false
  group.matrix
    .copy(pathWorldMatrix(center, transform))
    .multiply(pathWorldMatrix(center, node.transform).invert())
  group.updateMatrixWorld(true)
}

export function pickPathPointHit(
  graph: PathViewHost,
  raycaster: THREE.Raycaster,
  ndcX: number,
  ndcY: number,
  camera: THREE.PerspectiveCamera,
  pathId?: string | null,
): { id: string; index: number; dist: number } | null {
  const ids = pathId ? [pathId] : [...graph.pathMaterials.keys()]
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
  raycaster.layers.set(EDITOR_LAYER)
  let best: { id: string; index: number; dist: number } | null = null
  for (const id of ids) {
    if (isDerivedTransformPath(graph.nodeById.get(id))) continue
    if (!graph.pathViews.get(id)?.visible) continue
    const points = graph.pathMaterials.get(id)?.points ?? []
    for (let i = 0; i < points.length; i++) {
      const hits = raycaster.intersectObject(points[i].mesh, true)
      if (hits.length > 0 && (!best || hits[0].distance < best.dist)) {
        best = { id, index: i, dist: hits[0].distance }
      }
    }
  }
  raycaster.layers.set(0)
  return best
}

export function pickPathHit(
  graph: PathViewHost,
  raycaster: THREE.Raycaster,
  ndcX: number,
  ndcY: number,
  camera: THREE.PerspectiveCamera,
): { id: string; dist: number } | null {
  if (graph.pathPickTargets.size === 0) return null
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
  raycaster.layers.set(EDITOR_LAYER)
  let best: { id: string; dist: number } | null = null
  for (const [id, obj] of graph.pathPickTargets) {
    if (isDerivedTransformPath(graph.nodeById.get(id))) continue
    if (!graph.pathViews.get(id)?.visible) continue
    const hits = raycaster.intersectObject(obj, false)
    if (hits.length > 0 && (!best || hits[0].distance < best.dist)) {
      best = { id, dist: hits[0].distance }
    }
  }
  raycaster.layers.set(0)
  return best
}

export function buildDrawPreview(points: [number, number, number][]): THREE.Group | null {
  if (points.length === 0) return null
  const g = new THREE.Group()
  const vecs = points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
  if (vecs.length >= 2) {
    const curve = new THREE.CatmullRomCurve3(vecs, false, 'centripetal')
    const l = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getSpacedPoints(Math.max(32, vecs.length * 6))),
      new THREE.LineBasicMaterial({
        color: 0x8ee8ff,
        transparent: true,
        opacity: 0.72,
        depthTest: false,
      }),
    )
    l.renderOrder = 20
    g.add(l)
  }
  const startMat = new THREE.MeshBasicMaterial({
    color: 0x61d394,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  })
  const pointMat = new THREE.MeshBasicMaterial({
    color: 0x8ee8ff,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  })
  const startGeo = new THREE.SphereGeometry(PATH_END_POINT_RADIUS, 16, 12)
  const pointGeo = new THREE.SphereGeometry(PATH_POINT_RADIUS, 16, 12)
  vecs.forEach((v, i) => {
    const m = new THREE.Mesh(i === 0 ? startGeo : pointGeo, i === 0 ? startMat : pointMat)
    m.position.copy(v)
    m.renderOrder = 21
    g.add(m)
  })
  g.traverse((o) => o.layers.set(EDITOR_LAYER))
  return g
}

export function disposeDrawPreview(g: THREE.Group): void {
  disposeObject(g)
}

/** 绘制平面无限大。可见地面网格只是显示，不裁切落点；非有限坐标丢掉。 */
export function isDrawPointOnGround(p: [number, number, number]): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])
}

export { disposeObject }
