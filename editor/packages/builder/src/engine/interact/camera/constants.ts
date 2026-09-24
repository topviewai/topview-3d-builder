export const STAGE_DRAG_THRESHOLD_PX = 4
export const STAGE_CAMERA_MOVE_SPEED = 8
export const STAGE_CAMERA_LOOK_SENSITIVITY = 0.002
export const STAGE_CAMERA_ORBIT_SENSITIVITY = 0.005
export const STAGE_CAMERA_ZOOM_SENSITIVITY = 0.05
export const STAGE_CAMERA_PAN_SENSITIVITY = 0.028
/**
 * ⌘/Ctrl + 双指的缩放倍率——用户认定的手感基准。
 * 无修饰键的触控板双指 delta 更碎，再乘 PLAIN_WHEEL_BOOST；鼠标滚轮一格仍走基准，避免被放大冲飞。
 */
export const STAGE_CAMERA_WHEEL_MULTIPLIER = 0.36
export const STAGE_CAMERA_PLAIN_WHEEL_BOOST = 3
export const STAGE_CAMERA_DAMP_LAMBDA = 24
export const STAGE_CAMERA_SETTLE_EPS_POS = 0.00005
export const STAGE_CAMERA_SETTLE_EPS_ANG = 0.002
export const STAGE_CAMERA_PROXIMITY_DAMP_START = 2.5
export const STAGE_CAMERA_PROXIMITY_DAMP_END = 0.2
export const STAGE_CAMERA_PROXIMITY_MIN_FACTOR = 0.04
export const STAGE_CAMERA_WHEEL_PROXIMITY_DAMP_START = 3.2
export const STAGE_CAMERA_WHEEL_PROXIMITY_DAMP_END = 0.25
export const STAGE_CAMERA_WHEEL_PROXIMITY_MIN_FACTOR = 0.01
export const CAMERA_RESET_DURATION_MS = 400
export const DEFAULT_RESET_CAMERA_FOV = 60

export interface WheelDeltaLike {
  ctrlKey: boolean
  metaKey: boolean
  deltaX: number
  deltaY: number
  deltaMode: number
}

/** wheel 的来源。默认按鼠标滚轮处理，见到触控板证据后锁定成 trackpad。 */
export type WheelInputDevice = 'mouse' | 'trackpad'

/** 滚轮一格与 ⌘+滚动用基准倍率；触控板捏合（系统合成的 ctrl+wheel）步长很碎，放大后才跟得上手。 */
export function wheelZoomInputScale(e: WheelDeltaLike, device: WheelInputDevice = 'mouse'): number {
  if (device === 'trackpad' && e.ctrlKey && !e.metaKey) {
    return STAGE_CAMERA_WHEEL_MULTIPLIER * STAGE_CAMERA_PLAIN_WHEEL_BOOST
  }
  return STAGE_CAMERA_WHEEL_MULTIPLIER
}
