import * as THREE from 'three'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { EDITOR_LAYER, GRID_LAYER } from '../core/Layers'

/** 次级小格边长（米）。 */
export const GROUND_GRID_MINOR_CELL = 1
/** 每个主单元格等分成的小格数。大格边长 = MINOR_CELL × SPLITS。 */
export const GROUND_GRID_MINOR_SPLITS = 5
/** 主网格边长（米），与可见地面外沿对齐。 */
export const GROUND_GRID_SIZE = 60
/** 主网格每边的格数。大格边长 = SIZE / DIVISIONS = 5 米。 */
export const GROUND_GRID_MAJOR_DIVISIONS = GROUND_GRID_SIZE / (GROUND_GRID_MINOR_CELL * GROUND_GRID_MINOR_SPLITS)

/** 主线 RGB 69,69,69，次级线 RGB 36,36,36。 */
const MAJOR_COLOR = 0x454545
const MINOR_COLOR = 0x242424
const MAJOR_WIDTH = 2
const MINOR_WIDTH = 1
/** 略高于地面，避免和地面片共面被盖住。 */
const GRID_Y = 0.002

const resolution = new THREE.Vector2()

export function buildGroundGridPositions(kind: 'major' | 'minor'): Float32Array {
  const half = GROUND_GRID_SIZE / 2
  const splits = GROUND_GRID_MINOR_SPLITS
  const count = kind === 'major'
    ? GROUND_GRID_MAJOR_DIVISIONS
    : GROUND_GRID_MAJOR_DIVISIONS * splits
  const step = GROUND_GRID_SIZE / count
  const coords: number[] = []
  for (let i = 0; i <= count; i++) {
    if (kind === 'minor' && i % splits === 0) continue
    const k = -half + i * step
    coords.push(-half, GRID_Y, k, half, GRID_Y, k)
    coords.push(k, GRID_Y, -half, k, GRID_Y, half)
  }
  return new Float32Array(coords)
}

function syncLineResolution(renderer: THREE.WebGLRenderer, material: LineMaterial): void {
  const target = renderer.getRenderTarget()
  if (target) {
    material.resolution.set(target.width, target.height)
    return
  }
  renderer.getSize(resolution)
  material.resolution.copy(resolution)
}

function createGridLines(kind: 'major' | 'minor'): LineSegments2 {
  const geometry = new LineSegmentsGeometry()
  geometry.setPositions(buildGroundGridPositions(kind))
  const material = new LineMaterial({
    color: kind === 'major' ? MAJOR_COLOR : MINOR_COLOR,
    linewidth: kind === 'major' ? MAJOR_WIDTH : MINOR_WIDTH,
    toneMapped: false,
    depthWrite: true,
    transparent: false,
  })
  const lines = new LineSegments2(geometry, material)
  lines.name = kind === 'major' ? 't3d-grid-major' : 't3d-grid-minor'
  lines.userData.t3dKind = 'groundGrid'
  lines.renderOrder = kind === 'major' ? 2 : 1
  lines.layers.set(EDITOR_LAYER)
  lines.layers.enable(GRID_LAYER)
  lines.raycast = () => undefined
  lines.onBeforeRender = (renderer) => {
    syncLineResolution(renderer, material)
  }
  return lines
}

export function createGroundGrid(): THREE.Group {
  const grid = new THREE.Group()
  grid.userData.t3dKind = 'groundGrid'
  grid.layers.set(EDITOR_LAYER)
  grid.layers.enable(GRID_LAYER)
  grid.add(createGridLines('minor'))
  grid.add(createGridLines('major'))
  return grid
}
