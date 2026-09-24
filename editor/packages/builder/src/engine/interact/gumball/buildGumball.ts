import * as THREE from 'three'
import { EDITOR_LAYER } from '../../core/Layers'

/** Gumball 子手柄类型 */
export enum GumballHandleType {
  TRANSLATE = 'translate',
  SCALE = 'scale',
  PLANE = 'plane',
  ROTATE = 'rotate',
}

/** 子手柄轴向标识；uniform = 红/绿/蓝负向缩放轴的平均方向（整体缩放） */
export type GumballAxis = 'x' | 'y' | 'z' | 'xy' | 'yz' | 'xz' | 'uniform'

/** 唯一手柄键，供 hover/拖拽识别（如 'translate:x'） */
export type GumballHandleKey = `${GumballHandleType}:${GumballAxis}`

export interface GumballHandleUserData {
  gumballHandle: true
  handleType: GumballHandleType
  axis: GumballAxis
  key: GumballHandleKey
  highlightMaterials: THREE.Material[]
}

export interface GumballBuildResult {
  group: THREE.Group
  interactiveMeshes: THREE.Mesh[]
  originRing: THREE.Object3D
}

const COLOR_X = 0xe5484d
const COLOR_Y = 0x30c84d
const COLOR_Z = 0x4d7cff
const COLOR_ORIGIN = 0xffffff

/**
 * 局部尺寸（屏幕恒定缩放在上层应用）。
 * 圈层半径严格遵循「内→中→外」三级嵌套，避免正交顶视图下子手柄误触：
 *   旋转弧圈（最内）→ 平移轴+尖锥（中间）→ 缩放方块（负轴侧最外）
 *   平面格栅紧贴原点，位于旋转弧圈内侧。
 */
const AXIS_SOLID_LEN = 0.72
const AXIS_VISIBLE_R = 0.012
const AXIS_HIT_R = 0.065
const ARROW_LEN = 0.2
const ARROW_R = 0.062
const EXT_END = 1.15
const UNIFORM_SCALE_EXT_FACTOR = 1.2
const SCALE_BOX = 0.088
const SCALE_HIT = 0.16
const PLANE_OFFSET = 0.3
const PLANE_HALF = 0.14
const ARC_RADIUS = AXIS_SOLID_LEN + ARROW_LEN
const ARC_VISIBLE_TUBE = 0.013
const ARC_HIT_TUBE = 0.055
const ARC_SWEEP = Math.PI / 2
const ORIGIN_RING_R = 0.075
const ORIGIN_RING_TUBE = 0.012

const BASE_OPACITY = 0.92
const HOVER_OPACITY = 1
const COLOR_HOVER = 0xffe000
const HALF_PI = Math.PI / 2
const RENDER_ORDER = 9999

function colorForAxis(axis: GumballAxis): number {
  if (axis === 'x') return COLOR_X
  if (axis === 'y') return COLOR_Y
  if (axis === 'z') return COLOR_Z
  return COLOR_ORIGIN
}

function makeBasicMaterial(color: number, opacity = BASE_OPACITY): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  mat.userData.originalColor = color
  mat.userData.originalOpacity = opacity
  return mat
}

function makeLineMaterial(color: number, dashed: boolean): THREE.Material {
  if (dashed) {
    const mat = new THREE.LineDashedMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.88,
      depthTest: false,
      depthWrite: false,
      dashSize: 0.065,
      gapSize: 0.052,
      toneMapped: false,
    })
    mat.userData.originalColor = color
    mat.userData.originalOpacity = 0.88
    return mat
  }
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: BASE_OPACITY,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  mat.userData.originalColor = color
  mat.userData.originalOpacity = BASE_OPACITY
  return mat
}

function orientToAxis(obj: THREE.Object3D, axis: 'x' | 'y' | 'z'): void {
  if (axis === 'x') obj.rotation.z = -HALF_PI
  else if (axis === 'z') obj.rotation.x = HALF_PI
}

function tagInteractive(
  mesh: THREE.Mesh,
  handleType: GumballHandleType,
  axis: GumballAxis,
  highlightMaterials: THREE.Material[],
): void {
  mesh.userData.gumball = {
    gumballHandle: true,
    handleType,
    axis,
    key: `${handleType}:${axis}`,
    highlightMaterials,
  } satisfies GumballHandleUserData
  mesh.renderOrder = RENDER_ORDER
}

function makeHitProxy(geometry: THREE.BufferGeometry): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    visible: true,
  })
  const mesh = new THREE.Mesh(geometry, mat)
  mesh.renderOrder = RENDER_ORDER
  return mesh
}

function buildAxis(axis: 'x' | 'y' | 'z', interactive: THREE.Mesh[]): THREE.Object3D {
  const color = colorForAxis(axis)
  const root = new THREE.Group()

  const lineMat = makeBasicMaterial(color)
  const line = new THREE.Mesh(
    new THREE.CylinderGeometry(AXIS_VISIBLE_R, AXIS_VISIBLE_R, AXIS_SOLID_LEN, 8),
    lineMat,
  )
  line.position.y = AXIS_SOLID_LEN / 2
  line.renderOrder = RENDER_ORDER

  const coneMat = makeBasicMaterial(color)
  const cone = new THREE.Mesh(new THREE.ConeGeometry(ARROW_R, ARROW_LEN, 18), coneMat)
  cone.position.y = AXIS_SOLID_LEN + ARROW_LEN / 2
  cone.renderOrder = RENDER_ORDER

  const translateVisuals: THREE.Material[] = [lineMat, coneMat]
  const translateProxy = makeHitProxy(
    new THREE.CylinderGeometry(AXIS_HIT_R, AXIS_HIT_R, AXIS_SOLID_LEN + ARROW_LEN, 8),
  )
  translateProxy.position.y = (AXIS_SOLID_LEN + ARROW_LEN) / 2
  tagInteractive(translateProxy, GumballHandleType.TRANSLATE, axis, translateVisuals)
  interactive.push(translateProxy)

  const dashMat = makeLineMaterial(color, true)
  const dashGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -EXT_END, 0),
  ])
  const dashLine = new THREE.Line(dashGeo, dashMat)
  dashLine.computeLineDistances()
  dashLine.renderOrder = RENDER_ORDER

  const boxMat = makeBasicMaterial(color)
  const box = new THREE.Mesh(new THREE.BoxGeometry(SCALE_BOX, SCALE_BOX, SCALE_BOX), boxMat)
  box.position.y = -EXT_END
  box.renderOrder = RENDER_ORDER

  const scaleVisuals: THREE.Material[] = [boxMat, dashMat]
  const scaleProxy = makeHitProxy(new THREE.BoxGeometry(SCALE_HIT, SCALE_HIT, SCALE_HIT))
  scaleProxy.position.y = -EXT_END
  tagInteractive(scaleProxy, GumballHandleType.SCALE, axis, scaleVisuals)
  interactive.push(scaleProxy)

  const scaleGroup = new THREE.Group()
  scaleGroup.userData.gumballScale = true
  scaleGroup.add(dashLine, box, scaleProxy)
  root.add(line, cone, translateProxy, scaleGroup)
  orientToAxis(root, axis)
  return root
}

function buildPlane(axis: 'xy' | 'yz' | 'xz', interactive: THREE.Mesh[]): THREE.Object3D {
  const root = new THREE.Group()
  const [c1, c2] = axis === 'xy'
    ? [COLOR_X, COLOR_Y]
    : axis === 'yz'
      ? [COLOR_Y, COLOR_Z]
      : [COLOR_X, COLOR_Z]

  const lo = -PLANE_HALF
  const hi = PLANE_HALF
  const mid = 0
  const mat1 = makeLineMaterial(c1, false)
  const mat2 = makeLineMaterial(c2, false)

  const segs1 = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(lo, lo, 0), new THREE.Vector3(lo, hi, 0),
    new THREE.Vector3(mid, lo, 0), new THREE.Vector3(mid, hi, 0),
    new THREE.Vector3(hi, lo, 0), new THREE.Vector3(hi, hi, 0),
  ])
  const segs2 = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(lo, lo, 0), new THREE.Vector3(hi, lo, 0),
    new THREE.Vector3(lo, mid, 0), new THREE.Vector3(hi, mid, 0),
    new THREE.Vector3(lo, hi, 0), new THREE.Vector3(hi, hi, 0),
  ])
  const grid1 = new THREE.LineSegments(segs1, mat1)
  const grid2 = new THREE.LineSegments(segs2, mat2)
  grid1.renderOrder = RENDER_ORDER
  grid2.renderOrder = RENDER_ORDER

  const proxy = makeHitProxy(new THREE.PlaneGeometry(PLANE_HALF * 2, PLANE_HALF * 2))
  const fill = makeBasicMaterial(c1, 0.3)
  fill.side = THREE.DoubleSide
  ;(proxy.material as THREE.Material).dispose()
  proxy.material = fill
  tagInteractive(proxy, GumballHandleType.PLANE, axis, [mat1, mat2, fill])
  interactive.push(proxy)

  root.add(grid1, grid2, proxy)
  if (axis === 'xy') {
    root.position.set(PLANE_OFFSET, PLANE_OFFSET, 0)
  } else if (axis === 'yz') {
    root.rotation.y = HALF_PI
    root.position.set(0, PLANE_OFFSET, PLANE_OFFSET)
  } else {
    root.rotation.x = -HALF_PI
    root.position.set(PLANE_OFFSET, 0, PLANE_OFFSET)
  }
  return root
}

function buildArc(axis: 'x' | 'y' | 'z', interactive: THREE.Mesh[]): THREE.Object3D {
  const color = colorForAxis(axis)
  const root = new THREE.Group()
  root.userData.gumballRotate = true

  const arcMat = makeBasicMaterial(color)
  const arc = new THREE.Mesh(
    new THREE.TorusGeometry(ARC_RADIUS, ARC_VISIBLE_TUBE, 8, 48, ARC_SWEEP),
    arcMat,
  )
  arc.renderOrder = RENDER_ORDER

  const proxy = makeHitProxy(new THREE.TorusGeometry(ARC_RADIUS, ARC_HIT_TUBE, 6, 48, ARC_SWEEP))
  tagInteractive(proxy, GumballHandleType.ROTATE, axis, [arcMat])
  interactive.push(proxy)

  const arcSpin = axis === 'y' ? HALF_PI : -HALF_PI
  arc.rotation.z = arcSpin
  proxy.rotation.z = arcSpin
  if (axis === 'x') {
    arc.scale.y = -1
    proxy.scale.y = -1
  }

  root.add(arc, proxy)
  if (axis === 'y') root.rotation.x = -HALF_PI
  else if (axis === 'x') root.rotation.y = HALF_PI
  if (axis !== 'y') root.rotation.y += Math.PI
  return root
}

function buildUniformScale(interactive: THREE.Mesh[]): THREE.Object3D {
  const root = new THREE.Group()
  root.userData.gumballScale = true
  const color = colorForAxis('uniform')
  const invSqrt3 = 1 / Math.sqrt(3)
  const dir = new THREE.Vector3(-invSqrt3, -invSqrt3, -invSqrt3)
  const pos = dir.clone().multiplyScalar(EXT_END * UNIFORM_SCALE_EXT_FACTOR)

  const dashMat = makeLineMaterial(color, true)
  const dashGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), pos.clone()])
  const dashLine = new THREE.Line(dashGeo, dashMat)
  dashLine.computeLineDistances()
  dashLine.renderOrder = RENDER_ORDER

  const boxMat = makeBasicMaterial(color)
  const box = new THREE.Mesh(new THREE.BoxGeometry(SCALE_BOX, SCALE_BOX, SCALE_BOX), boxMat)
  box.position.copy(pos)
  box.renderOrder = RENDER_ORDER

  const scaleProxy = makeHitProxy(new THREE.BoxGeometry(SCALE_HIT, SCALE_HIT, SCALE_HIT))
  scaleProxy.position.copy(pos)
  tagInteractive(scaleProxy, GumballHandleType.SCALE, 'uniform', [boxMat, dashMat])
  interactive.push(scaleProxy)

  root.add(dashLine, box, scaleProxy)
  return root
}

export function setGumballScaleVisible(build: GumballBuildResult, visible: boolean): void {
  build.group.traverse((object) => {
    if (object.userData.gumballScale) object.visible = visible
  })
}

export function setGumballRotateVisible(build: GumballBuildResult, visible: boolean): void {
  build.group.traverse((object) => {
    if (object.userData.gumballRotate) object.visible = visible
  })
}

export function buildGumball(): GumballBuildResult {
  const group = new THREE.Group()
  group.name = 'StageGumball'
  const interactive: THREE.Mesh[] = []

  const originRing = new THREE.Mesh(
    new THREE.TorusGeometry(ORIGIN_RING_R, ORIGIN_RING_TUBE, 10, 32),
    makeBasicMaterial(COLOR_ORIGIN, HOVER_OPACITY),
  )
  originRing.renderOrder = RENDER_ORDER + 1

  group.add(originRing)
  ;(['x', 'y', 'z'] as const).forEach((axis) => {
    group.add(buildAxis(axis, interactive))
    group.add(buildArc(axis, interactive))
  })
  ;(['xy', 'yz', 'xz'] as const).forEach((axis) => {
    group.add(buildPlane(axis, interactive))
  })
  group.add(buildUniformScale(interactive))
  group.traverse((o) => o.layers.set(EDITOR_LAYER))
  return { group, interactiveMeshes: interactive, originRing }
}

export function setHandleHovered(userData: GumballHandleUserData | null, allHandles: THREE.Mesh[]): void {
  allHandles.forEach((mesh) => {
    const data = mesh.userData.gumball as GumballHandleUserData | undefined
    if (!data) return
    const active = userData?.key === data.key
    data.highlightMaterials.forEach((mat) => {
      const m = mat as THREE.MeshBasicMaterial
      if (active) {
        m.color.set(COLOR_HOVER)
        m.opacity = HOVER_OPACITY
      } else {
        m.color.set((mat.userData.originalColor as number | undefined) ?? 0xffffff)
        m.opacity = (mat.userData.originalOpacity as number | undefined) ?? BASE_OPACITY
      }
    })
  })
}

export function pickHandle(raycaster: THREE.Raycaster, interactiveMeshes: THREE.Mesh[]): GumballHandleUserData | null {
  const hits = raycaster.intersectObjects(interactiveMeshes.filter((mesh) => {
    let object: THREE.Object3D | null = mesh
    while (object) {
      if (!object.visible) return false
      object = object.parent
    }
    return true
  }), false)
  if (hits.length === 0) return null
  return (hits[0].object.userData.gumball as GumballHandleUserData | undefined) ?? null
}
