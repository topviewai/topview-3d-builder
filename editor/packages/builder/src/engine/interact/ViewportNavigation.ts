import type { EditorCameraController } from './camera/EditorCameraController'
import {
  STAGE_CAMERA_PLAIN_WHEEL_BOOST,
  STAGE_CAMERA_WHEEL_MULTIPLIER,
  STAGE_DRAG_THRESHOLD_PX,
  wheelZoomInputScale,
  type WheelInputDevice,
} from './camera/constants'
import { normalizeContainerScreenRect, type ContainerScreenRect } from './selectionBox'

export interface ViewportNavPickHandlers {
  onBoxRect: (rect: ContainerScreenRect | null) => void
  onBoxCommit: (rect: ContainerScreenRect) => void
  onClick: (event: { clientX: number; clientY: number; shiftKey: boolean }) => void
}

function isBoxSelectModKeyActive(keys: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return keys.ctrlKey || keys.metaKey
}

function isBoxSelectModKeyboardKey(key: string): boolean {
  return key === 'Control' || key === 'Meta'
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const tag = (target as HTMLElement).tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea' || (target as HTMLElement).isContentEditable
}

function isViewportUiTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('button, a, input, textarea, select, [role="button"]'),
  )
}

export function pointerCentroid(points: Iterable<{ x: number; y: number }>): { x: number; y: number } | null {
  let x = 0
  let y = 0
  let n = 0
  for (const point of points) {
    x += point.x
    y += point.y
    n += 1
  }
  return n > 0 ? { x: x / n, y: y / n } : null
}

/** 多指手势：中心点 → 平移，指间距 → 捏合缩放。 */
export interface TouchGestureState {
  centerX: number
  centerY: number
  /** 指与指之间的平均距离（两指时就是指间距）。 */
  spread: number
}

export type TouchGestureMode = 'pan' | 'pinch'

const TOUCH_GESTURE_DECIDE_PX = 6
const TOUCH_WHEEL_GUARD_MS = 400

export function touchFingerSpread(points: ReadonlyArray<{ x: number; y: number }>): number {
  if (points.length < 2) return 0
  let sum = 0
  let n = 0
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      sum += Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)
      n += 1
    }
  }
  return n > 0 ? sum / n : 0
}

export function touchGestureState(points: Iterable<{ x: number; y: number }>): TouchGestureState | null {
  const list = [...points]
  const center = pointerCentroid(list)
  if (!center) return null
  return { centerX: center.x, centerY: center.y, spread: touchFingerSpread(list) }
}

/**
 * 一次双指手势只认一种模式并锁定。
 * 平移优先：只有指距变化明显大于中心位移（≥1.5×）才锁成捏合。
 */
export function decideTouchGestureMode(
  locked: TouchGestureMode | null,
  centerDelta: number,
  spreadDelta: number,
  thresholdPx = TOUCH_GESTURE_DECIDE_PX,
): TouchGestureMode | null {
  if (locked) return locked
  const absSpread = Math.abs(spreadDelta)
  if (absSpread < thresholdPx && centerDelta < thresholdPx) return null
  if (absSpread >= thresholdPx && absSpread >= centerDelta * 1.5) return 'pinch'
  if (centerDelta >= thresholdPx) return 'pan'
  return null
}

export interface WheelLike {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
  metaKey: boolean
  timeStamp: number
  sourceCapabilities?: { firesTouchEvents?: boolean } | null
}

/** 整页共享：学到一次就不必每个视口、每次重挂再学一遍。 */
let wheelInputDevice: WheelInputDevice = 'mouse'

export type WheelGesture = 'zoom' | 'pan' | 'ignore'

const WHEEL_LINE_HEIGHT_PX = 16
const WHEEL_PAGE_HEIGHT_PX = 800

/**
 * 横向分量只有触控板给得出来——鼠标滚轮的 deltaX 恒为 0。
 * 一格 delta 的幅度、整数性在 macOS 上都靠不住（滚轮带加速曲线、给小数，触控板反而是整数），
 * 所以只认这一条硬证据。
 */
export function isTrackpadWheelEvidence(e: WheelLike): boolean {
  return e.deltaX !== 0
}

/** 设备一旦认定是触控板就不再回退：同一个页面里用户不会换设备。 */
export function nextWheelInputDevice(current: WheelInputDevice, e: WheelLike): WheelInputDevice {
  if (current === 'trackpad') return 'trackpad'
  return isTrackpadWheelEvidence(e) ? 'trackpad' : 'mouse'
}

export interface WheelClassifyContext {
  /** 原生 touch 分支正在处理的手指数。 */
  activeTouchCount: number
  touchGuardUntil?: number
  now?: number
  /** 已锁定的 wheel 来源。 */
  device: WheelInputDevice
}

/**
 * macOS 不给触控板派发 touch 事件，双指手势只以 wheel 到达，所以分流得在 wheel 这条路上做：
 * 认定是触控板后裸 wheel 走平移，其余（滚轮、⌘/Ctrl+wheel 捏合）走缩放。
 * 真正有 touch 的设备上手指还没离屏、或刚抬起的守卫窗口内，交给 touch 分支，这里忽略。
 */
export function classifyWheelEvent(e: WheelLike, ctx: WheelClassifyContext): WheelGesture {
  const now = ctx.now ?? e.timeStamp
  if (ctx.activeTouchCount > 0) return 'ignore'
  if (now < (ctx.touchGuardUntil ?? 0)) return 'ignore'
  if (e.ctrlKey || e.metaKey) return 'zoom'
  return ctx.device === 'trackpad' ? 'pan' : 'zoom'
}

/** wheel 的 delta 可能按行/页计，换算成像素后再当平移用。 */
export function wheelDeltaToPixels(e: WheelLike, lineHeight: number, pageHeight: number): { x: number; y: number } {
  const unit = e.deltaMode === 1 ? lineHeight : e.deltaMode === 2 ? pageHeight : 1
  return { x: e.deltaX * unit, y: e.deltaY * unit }
}

function collectTouchPoints(list: TouchList): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  for (let i = 0; i < list.length; i++) {
    const touch = list.item(i)
    if (touch) points.push({ x: touch.clientX, y: touch.clientY })
  }
  return points
}

export interface BindViewportNavigationOptions {
  camera: EditorCameraController
  canvas: HTMLCanvasElement
  container: HTMLElement
  isHandleActive: () => boolean
  isEnabled: () => boolean
  /** 左键留给路径绘制；右键环绕、中键平移、滚轮和 WASD 仍走导航。 */
  reservesLeftPointer?: () => boolean
  getHandlers: () => ViewportNavPickHandlers | null
}

export function bindViewportNavigation(opts: BindViewportNavigationOptions): () => void {
  const { camera, canvas, container, isHandleActive, isEnabled, reservesLeftPointer, getHandlers } = opts
  canvas.tabIndex = 0
  canvas.style.outline = 'none'

  let space = false
  let ctrl = false
  let boxSelecting = false
  let pendingLook = { x: 0, y: 0 }
  let lookRaf = 0
  const pointer = {
    leftDown: false,
    rightDown: false,
    middleDown: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    rightMoved: false,
  }
  const touchPointers = new Map<number, { x: number; y: number }>()
  let touchCount = 0
  let touchPan: TouchGestureState | null = null
  let touchMode: TouchGestureMode | null = null
  let nativeTouchActive = false
  let touchGuardUntil = 0
  let lastTouchEventStamp = -1
  let lastTouchEventType = ''
  let touchOnUi = false

  const markTouchGuard = () => {
    touchGuardUntil = performance.now() + TOUCH_WHEEL_GUARD_MS
  }

  const cancelSingleFingerLook = () => {
    pointer.leftDown = false
    pointer.moved = true
    camera.looking = false
    flushPendingLook()
    boxSelecting = false
    getHandlers()?.onBoxRect(null)
  }

  const beginTouchGesture = (points: Iterable<{ x: number; y: number }>) => {
    cancelSingleFingerLook()
    touchPan = touchGestureState(points)
    touchMode = null
  }

  const stepTouchGesture = (points: Iterable<{ x: number; y: number }>) => {
    if (!touchPan) beginTouchGesture(points)
    const next = touchGestureState(points)
    const prev = touchPan
    if (!next || !prev) return
    touchPan = next
    const dx = next.centerX - prev.centerX
    const dy = next.centerY - prev.centerY
    const spread = next.spread - prev.spread
    const centerDelta = Math.hypot(dx, dy)
    touchMode = decideTouchGestureMode(touchMode, centerDelta, spread)
    if (!touchMode) return
    const pinchScale = STAGE_CAMERA_WHEEL_MULTIPLIER * STAGE_CAMERA_PLAIN_WHEEL_BOOST
    if (touchMode === 'pinch') {
      if (spread !== 0) camera.applyZoomDelta(-spread * pinchScale)
      return
    }
    // 平移：只平移，不叠缩放
    if (dx !== 0 || dy !== 0) camera.applyPanDelta(dx, dy)
  }

  const endTouchGesture = () => {
    nativeTouchActive = false
    touchPan = null
    touchMode = null
  }

  const flushPendingLook = () => {
    if (lookRaf) {
      cancelAnimationFrame(lookRaf)
      lookRaf = 0
    }
    pendingLook.x = 0
    pendingLook.y = 0
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return
    if (e.code === 'Space') {
      e.preventDefault()
      space = true
    }
    if (isBoxSelectModKeyboardKey(e.key)) ctrl = true
    if (e.key === 'Shift') camera.setShift(true)
    const key = e.key.toLowerCase()
    if (!['w', 'a', 's', 'd', 'q', 'e'].includes(key)) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (!isEnabled()) return
    e.preventDefault()
    camera.setKey(key, true)
  }

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') space = false
    if (isBoxSelectModKeyboardKey(e.key)) ctrl = false
    if (e.key === 'Shift') camera.setShift(false)
    camera.setKey(e.key.toLowerCase(), false)
  }

  const down = (e: PointerEvent) => {
    if (isViewportUiTarget(e.target)) return
    canvas.focus({ preventScroll: true })
    if (!isEnabled()) return

    if (e.pointerType === 'touch') {
      touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      touchCount = Math.max(touchCount, touchPointers.size)
      markTouchGuard()
      // 触摸不要 capture：capture 第一指后第二指常常不再派 pointerdown。
      if (touchPointers.size >= 2) {
        e.preventDefault()
        beginTouchGesture(touchPointers.values())
        return
      }
    }

    if (e.button === 2) {
      e.preventDefault()
      camera.beginOrbitGesture()
      pointer.rightDown = true
      pointer.rightMoved = false
      pointer.startX = e.clientX
      pointer.startY = e.clientY
      pointer.lastX = e.clientX
      pointer.lastY = e.clientY
      canvas.setPointerCapture(e.pointerId)
      return
    }
    if (e.button === 1) {
      e.preventDefault()
      pointer.middleDown = true
      pointer.startX = e.clientX
      pointer.startY = e.clientY
      pointer.lastX = e.clientX
      pointer.lastY = e.clientY
      canvas.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    if (isHandleActive()) return
    if (reservesLeftPointer?.()) return

    ctrl = isBoxSelectModKeyActive(e)
    boxSelecting = false
    getHandlers()?.onBoxRect(null)
    pointer.leftDown = true
    pointer.startX = e.clientX
    pointer.startY = e.clientY
    pointer.lastX = e.clientX
    pointer.lastY = e.clientY
    pointer.moved = false
    camera.looking = false
    if (e.pointerType !== 'touch') canvas.setPointerCapture(e.pointerId)
  }

  const move = (e: PointerEvent) => {
    if (!isEnabled()) return
    if (e.pointerType === 'touch' && touchPointers.has(e.pointerId)) {
      touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      markTouchGuard()
    }
    // 原生 touch 已在处理时，pointer 路径让路，避免双份位移。
    if (nativeTouchActive) return
    if (touchPointers.size >= 2 || touchPan) {
      if (touchPointers.size >= 2) stepTouchGesture(touchPointers.values())
      return
    }
    if (isHandleActive() && !pointer.leftDown && !pointer.rightDown && !pointer.middleDown) return

    if (pointer.rightDown) {
      const dx = e.clientX - pointer.startX
      const dy = e.clientY - pointer.startY
      if (!pointer.rightMoved && Math.hypot(dx, dy) >= STAGE_DRAG_THRESHOLD_PX) pointer.rightMoved = true
      const stepX = e.clientX - pointer.lastX
      const stepY = e.clientY - pointer.lastY
      pointer.lastX = e.clientX
      pointer.lastY = e.clientY
      if (pointer.rightMoved && (stepX !== 0 || stepY !== 0)) camera.applyOrbitDelta(stepX, stepY)
      return
    }

    if (pointer.middleDown) {
      const stepX = e.clientX - pointer.lastX
      const stepY = e.clientY - pointer.lastY
      pointer.lastX = e.clientX
      pointer.lastY = e.clientY
      if (stepX !== 0 || stepY !== 0) camera.applyPanDelta(stepX, stepY)
      return
    }

    if (!pointer.leftDown) return
    ctrl = isBoxSelectModKeyActive(e)
    const dx = e.clientX - pointer.startX
    const dy = e.clientY - pointer.startY
    if (!pointer.moved && Math.hypot(dx, dy) >= STAGE_DRAG_THRESHOLD_PX) {
      pointer.moved = true
      if (space) {
        // Space + drag = pan
      } else if (ctrl) {
        boxSelecting = true
      } else if (e.pointerType !== 'touch' || touchPointers.size === 1) {
        camera.looking = true
      }
    }

    if (boxSelecting) {
      getHandlers()?.onBoxRect(normalizeContainerScreenRect(container, pointer.startX, pointer.startY, e.clientX, e.clientY))
      return
    }

    if (space && pointer.moved) {
      const stepX = e.clientX - pointer.lastX
      const stepY = e.clientY - pointer.lastY
      pointer.lastX = e.clientX
      pointer.lastY = e.clientY
      camera.applyPanDelta(stepX, stepY)
      return
    }

    if (camera.looking) {
      const stepX = e.clientX - pointer.lastX
      const stepY = e.clientY - pointer.lastY
      pointer.lastX = e.clientX
      pointer.lastY = e.clientY
      pendingLook.x += stepX
      pendingLook.y += stepY
      if (!lookRaf) {
        lookRaf = requestAnimationFrame(() => {
          lookRaf = 0
          const { x, y } = pendingLook
          pendingLook.x = 0
          pendingLook.y = 0
          if (x !== 0 || y !== 0) camera.applyLookDelta(x, y)
        })
      }
    }
  }

  const up = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      touchPointers.delete(e.pointerId)
      markTouchGuard()
      if (touchPointers.size < 2) {
        endTouchGesture()
        if (touchPointers.size === 0) touchCount = 0
      }
    }
    if (e.button === 2) {
      pointer.rightDown = false
      return
    }
    if (e.button === 1) {
      pointer.middleDown = false
      return
    }
    if (!pointer.leftDown) return
    pointer.leftDown = false
    camera.looking = false
    flushPendingLook()
    const wasBox = boxSelecting
    boxSelecting = false
    getHandlers()?.onBoxRect(null)
    if (wasBox && pointer.moved) {
      getHandlers()?.onBoxCommit(normalizeContainerScreenRect(container, pointer.startX, pointer.startY, e.clientX, e.clientY))
      return
    }
    // 拖 gizmo 时导航被关掉，move 第一行就 return，pointer.moved 停在 false。
    // 只信这个标志会把「拖完松手」当成点空白，把选中清掉——按落点距离兜底。
    const upDx = e.clientX - pointer.startX
    const upDy = e.clientY - pointer.startY
    const moved = pointer.moved || Math.hypot(upDx, upDy) >= STAGE_DRAG_THRESHOLD_PX
    if (!moved && !isViewportUiTarget(e.target)) {
      getHandlers()?.onClick({ clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey })
    }
  }

  const onTouchStart = (e: TouchEvent) => {
    if (!isEnabled()) return
    // 手势起手落在视口内的悬浮 UI 上：整段手势放行，别拦它自己的滚动/拖动。
    if (isViewportUiTarget(e.target)) {
      touchOnUi = true
      return
    }
    // canvas + container 双绑时同一事件会进两次，按 timeStamp 去重。
    if (e.timeStamp === lastTouchEventStamp && e.type === lastTouchEventType) return
    lastTouchEventStamp = e.timeStamp
    lastTouchEventType = e.type
    touchCount = e.touches.length
    markTouchGuard()
    // 从第一指起就 preventDefault，打断浏览器把双指上下滑合成 wheel。
    e.preventDefault()
    if (e.touches.length >= 2) {
      nativeTouchActive = true
      beginTouchGesture(collectTouchPoints(e.touches))
    }
  }

  const onTouchMove = (e: TouchEvent) => {
    if (!isEnabled() || touchOnUi) return
    if (e.timeStamp === lastTouchEventStamp && e.type === lastTouchEventType) return
    lastTouchEventStamp = e.timeStamp
    lastTouchEventType = e.type
    touchCount = e.touches.length
    markTouchGuard()
    e.preventDefault()
    if (e.touches.length >= 2) {
      nativeTouchActive = true
      stepTouchGesture(collectTouchPoints(e.touches))
    }
  }

  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length === 0) touchOnUi = false
    if (e.timeStamp === lastTouchEventStamp && e.type === lastTouchEventType) return
    lastTouchEventStamp = e.timeStamp
    lastTouchEventType = e.type
    touchCount = e.touches.length
    markTouchGuard()
    if (e.touches.length < 2) endTouchGesture()
    if (e.touches.length === 0) touchCount = 0
  }

  const wheel = (e: WheelEvent) => {
    if (!isEnabled() || isHandleActive() || isViewportUiTarget(e.target)) return
    e.preventDefault()
    wheelInputDevice = nextWheelInputDevice(wheelInputDevice, e)
    const gesture = classifyWheelEvent(e, {
      activeTouchCount: Math.max(touchCount, touchPointers.size),
      touchGuardUntil,
      now: performance.now(),
      device: wheelInputDevice,
    })
    if (gesture === 'ignore') return
    if (gesture === 'pan') {
      const { x, y } = wheelDeltaToPixels(e, WHEEL_LINE_HEIGHT_PX, canvas.clientHeight || WHEEL_PAGE_HEIGHT_PX)
      // 画面跟着手指走，所以取反。
      if (x !== 0 || y !== 0) camera.applyPanDelta(-x, -y)
      return
    }
    camera.applyZoomDelta(e.deltaY * wheelZoomInputScale(e, wheelInputDevice))
  }

  const context = (e: Event) => e.preventDefault()
  const blur = () => {
    space = false
    ctrl = false
    camera.setShift(false)
    camera.setKey('w', false)
    camera.setKey('a', false)
    camera.setKey('s', false)
    camera.setKey('d', false)
    camera.setKey('q', false)
    camera.setKey('e', false)
  }

  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', blur)
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  const touchOpts: AddEventListenerOptions = { passive: false, capture: true }
  // canvas + container 双绑：有的浏览器第二指只落到其中一个目标上。
  canvas.addEventListener('touchstart', onTouchStart, touchOpts)
  canvas.addEventListener('touchmove', onTouchMove, touchOpts)
  canvas.addEventListener('touchend', onTouchEnd, { capture: true })
  canvas.addEventListener('touchcancel', onTouchEnd, { capture: true })
  container.addEventListener('touchstart', onTouchStart, touchOpts)
  container.addEventListener('touchmove', onTouchMove, touchOpts)
  container.addEventListener('touchend', onTouchEnd, { capture: true })
  container.addEventListener('touchcancel', onTouchEnd, { capture: true })
  canvas.addEventListener('wheel', wheel, { passive: false })
  canvas.addEventListener('contextmenu', context)
  camera.start()

  return () => {
    camera.stop()
    flushPendingLook()
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('keyup', handleKeyUp)
    window.removeEventListener('blur', blur)
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointercancel', up)
    canvas.removeEventListener('touchstart', onTouchStart, true)
    canvas.removeEventListener('touchmove', onTouchMove, true)
    canvas.removeEventListener('touchend', onTouchEnd, true)
    canvas.removeEventListener('touchcancel', onTouchEnd, true)
    container.removeEventListener('touchstart', onTouchStart, true)
    container.removeEventListener('touchmove', onTouchMove, true)
    container.removeEventListener('touchend', onTouchEnd, true)
    container.removeEventListener('touchcancel', onTouchEnd, true)
    canvas.removeEventListener('wheel', wheel)
    canvas.removeEventListener('contextmenu', context)
  }
}
