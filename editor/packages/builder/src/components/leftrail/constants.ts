import type { LibraryTab } from '../../stores/types'
export { CONTENT_WIDTH_DEFAULT, CONTENT_WIDTH_MAX, CONTENT_WIDTH_MIN } from '../../stores/EditorStore'

export const RAIL_WIDTH = 84
export const HOVER_DELAY_MS = 150
export const HOVER_SIZE = 340
export const ALL_CHIP = '__all__'
export const PRIMITIVE_CHIP = '__primitives__'
export const ASSET_FETCH_PAGE = 200
/** 道具库约 2k 条；search 已默认不含 scan_json，首屏仍控制封面数量 */
export const ASSET_PROP_PAGE = 48

export const TAB_ORDER: LibraryTab[] = [
  'object',
  'character',
  'prop',
  'camera',
  'cameraMotion',
  'motion',
]

export const TAB_LABEL: Record<LibraryTab, string> = {
  object: 'library.tabObject',
  character: 'library.tabCharacter',
  prop: 'library.tabProp',
  motion: 'library.tabMotion',
  camera: 'library.tabCamera',
  cameraMotion: 'library.tabCameraMotion',
}

export const CAMERA_MOTION_CATEGORY_LABEL: Record<string, string> = {
  basic: 'library.categoryBasic',
  character: 'library.categoryCharacter',
  space: 'library.categorySpace',
}

export const PRIMITIVES: {
  nameKey: string
  kind: string
  parameters: Record<string, number>
  y: number
  rotX?: number
}[] = [
  { nameKey: 'library.primitiveBox', kind: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 }, y: 0.5 },
  { nameKey: 'library.primitiveSphere', kind: 'SphereGeometry', parameters: { radius: 0.6, widthSegments: 32, heightSegments: 16 }, y: 0.6 },
  { nameKey: 'library.primitiveCylinder', kind: 'CylinderGeometry', parameters: { radiusTop: 0.4, radiusBottom: 0.4, height: 1.2, radialSegments: 32 }, y: 0.6 },
  { nameKey: 'library.primitiveCone', kind: 'ConeGeometry', parameters: { radius: 0.5, height: 1.2, radialSegments: 32 }, y: 0.6 },
  { nameKey: 'library.primitivePlane', kind: 'PlaneGeometry', parameters: { width: 3, height: 3 }, y: 0.01, rotX: -90 },
]
