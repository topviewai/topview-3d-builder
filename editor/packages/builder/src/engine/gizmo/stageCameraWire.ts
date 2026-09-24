/** Blender 机位 gizmo：原点=光学中心，画幅在 local -Z（与 Three PerspectiveCamera 一致）。 */
export const STAGE_CAMERA_WIRE_DIST = 0.45
/** 点选机身立方体边长。整段视锥当拾取体会让空白点击误选机位。 */
export const STAGE_CAMERA_PICK_SIZE = 0.14

export const STAGE_CAMERA_WIRE_IDLE = 0x8c8c8c
export const STAGE_CAMERA_WIRE_SELECTED = 0xed8c23

export interface StageCameraFrameExtents {
  halfW: number
  halfH: number
  dist: number
  triangleH: number
}

export function stageCameraFrameExtents(
  fovDeg: number,
  aspect: number,
  dist = STAGE_CAMERA_WIRE_DIST,
): StageCameraFrameExtents {
  const fov = Math.min(170, Math.max(1, fovDeg))
  const ratio = aspect > 0 ? aspect : 16 / 9
  const safeDist = dist > 0 ? dist : STAGE_CAMERA_WIRE_DIST
  const halfH = safeDist * Math.tan((fov * Math.PI) / 360)
  return {
    halfW: halfH * ratio,
    halfH,
    dist: safeDist,
    triangleH: halfH * 0.22,
  }
}

/** LineSegments 顶点：原点→四角、画幅矩形、画幅顶上 up 三角。 */
export function buildStageCameraWirePositions(
  fovDeg: number,
  aspect: number,
  dist = STAGE_CAMERA_WIRE_DIST,
): Float32Array {
  const { halfW: hw, halfH: hh, dist: zDist, triangleH } = stageCameraFrameExtents(
    fovDeg,
    aspect,
    dist,
  )
  const z = -zDist
  const origin: [number, number, number] = [0, 0, 0]
  const tl: [number, number, number] = [-hw, hh, z]
  const tr: [number, number, number] = [hw, hh, z]
  const br: [number, number, number] = [hw, -hh, z]
  const bl: [number, number, number] = [-hw, -hh, z]
  const peak: [number, number, number] = [0, hh + triangleH, z]
  const triL: [number, number, number] = [-hw * 0.35, hh, z]
  const triR: [number, number, number] = [hw * 0.35, hh, z]
  return new Float32Array([
    ...origin, ...tl, ...origin, ...tr, ...origin, ...br, ...origin, ...bl,
    ...tl, ...tr, ...tr, ...br, ...br, ...bl, ...bl, ...tl,
    ...triL, ...peak, ...peak, ...triR, ...triR, ...triL,
  ])
}
