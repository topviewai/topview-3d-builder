import type { TrackProp } from '../../evaluate/curves/KeyframeTrack'

export const LEFT_W = 188
/** 小于这个位移不算拖拽：空白轨道单击仍 seek playhead，超过则进入框选关键帧。 */
export const DRAG_THRESHOLD_PX = 4
/** 关键帧拖移：水平位移超过该像素才在 pointerup 提交（对齐 canvas KeyDiamond）。 */
export const KEY_MOVE_COMMIT_PX = 3
/** 框选命中：钻石中心点相对选框的容差（对齐 canvas timelineMarquee ±6）。 */
export const MARQUEE_HIT_SLOP_PX = 6
/** 吸附半径：拖动目标与锚点的像素距离在此以内才吸过去。 */
export const SNAP_TOLERANCE_PX = 8
/** 轨头与 0 帧之间留出半颗菱形，避免 0s 关键帧被裁切。 */
export const TRACK_INSET = 12
export const TIMELINE_FPS_MIN = 20
export const TIMELINE_FPS_MAX = 30
export const TIMELINE_FPS_DEFAULT = 24

export function clipIntersectsMarquee(
  clip: { left: number; right: number; top: number; bottom: number },
  box: { left: number; right: number; top: number; bottom: number },
): boolean {
  return clip.right >= box.left && clip.left <= box.right && clip.bottom >= box.top && clip.top <= box.bottom
}

/** 内容区（含底部空白）clientX → 帧，原点对齐轨道 0 帧（轨头 + TRACK_INSET）。 */
export function frameFromContentClientX(
  clientX: number,
  contentLeft: number,
  frameStart: number,
  pxPerFrame: number,
): number {
  const px = pxPerFrame > 0 ? pxPerFrame : 1
  return frameStart + (clientX - contentLeft - LEFT_W - TRACK_INSET) / px
}

export const PROP_LABEL: Record<TrackProp, string> = {
  position: '位移',
  rotation: '旋转',
  scale: '缩放',
  lookAt: '看点',
  fov: 'FOV',
}

export const FC_PROP_PATH: Record<TrackProp, string> = {
  position: 'transform.position',
  rotation: 'transform.rotation',
  scale: 'transform.scale',
  lookAt: 'camera.lookAt',
  fov: 'camera.fov',
}

export const NODE_XFORM_PROPS: TrackProp[] = ['position', 'rotation', 'scale']
export const CAMERA_XFORM_PROPS: TrackProp[] = ['position', 'rotation', 'lookAt', 'fov']

export function xformPropsForNodeType(type: string): TrackProp[] {
  return type === 'camera' ? CAMERA_XFORM_PROPS : NODE_XFORM_PROPS
}
