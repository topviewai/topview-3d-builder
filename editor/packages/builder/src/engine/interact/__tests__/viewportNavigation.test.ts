import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import {
  classifyWheelEvent,
  decideTouchGestureMode,
  nextWheelInputDevice,
  pointerCentroid,
  touchGestureState,
  wheelDeltaToPixels,
  type WheelLike,
} from '../ViewportNavigation'

function wheel(patch: Partial<WheelLike>): WheelLike {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    timeStamp: 0,
    ...patch,
  }
}

describe('classifyWheelEvent', () => {
  const mouse = { activeTouchCount: 0, device: 'mouse' as const }
  const trackpad = { activeTouchCount: 0, device: 'trackpad' as const }

  it('未认定触控板前，裸 wheel 一律缩放', () => {
    // 取自 macOS Chrome 实测：滚轮 deltaY 带加速曲线，是小数。
    assert.equal(classifyWheelEvent(wheel({ deltaY: 4.000244140625 }), mouse), 'zoom')
    assert.equal(classifyWheelEvent(wheel({ deltaY: 82.9595947265625 }), mouse), 'zoom')
    assert.equal(classifyWheelEvent(wheel({ deltaY: 120 }), mouse), 'zoom')
    assert.equal(classifyWheelEvent(wheel({ deltaY: 3, deltaMode: 1 }), mouse), 'zoom')
  })

  it('认定触控板后，裸 wheel 一律平移', () => {
    assert.equal(classifyWheelEvent(wheel({ deltaY: -1 }), trackpad), 'pan')
    assert.equal(classifyWheelEvent(wheel({ deltaY: -9 }), trackpad), 'pan')
    assert.equal(classifyWheelEvent(wheel({ deltaX: 24, deltaY: 0 }), trackpad), 'pan')
    assert.equal(classifyWheelEvent(wheel({ deltaY: 120 }), trackpad), 'pan')
  })

  it('捏合与修饰键缩放不受设备判定影响', () => {
    assert.equal(classifyWheelEvent(wheel({ deltaY: 4, ctrlKey: true }), trackpad), 'zoom')
    assert.equal(classifyWheelEvent(wheel({ deltaY: 4, metaKey: true }), trackpad), 'zoom')
    assert.equal(classifyWheelEvent(wheel({ deltaY: 4, metaKey: true }), mouse), 'zoom')
  })

  it('手指还在屏幕上时交给 touch 分支', () => {
    assert.equal(classifyWheelEvent(wheel({ deltaY: 120 }), { ...mouse, activeTouchCount: 2 }), 'ignore')
  })

  it('手指刚抬起的守卫窗口内漏过来的 wheel 也丢掉', () => {
    assert.equal(
      classifyWheelEvent(wheel({ deltaY: 120 }), { ...mouse, touchGuardUntil: 1000, now: 900 }),
      'ignore',
    )
    assert.equal(
      classifyWheelEvent(wheel({ deltaY: 120 }), { ...mouse, touchGuardUntil: 1000, now: 1000 }),
      'zoom',
    )
  })
})

describe('nextWheelInputDevice', () => {
  it('deltaX 非零即锁定触控板', () => {
    assert.equal(nextWheelInputDevice('mouse', wheel({ deltaX: 3, deltaY: -1 })), 'trackpad')
    // 只有横向的双指滑动——实测里比斜向的常见得多。
    assert.equal(nextWheelInputDevice('mouse', wheel({ deltaX: 24, deltaY: 0 })), 'trackpad')
  })

  it('纯纵向不足以判定，维持鼠标', () => {
    assert.equal(nextWheelInputDevice('mouse', wheel({ deltaY: -7 })), 'mouse')
    assert.equal(nextWheelInputDevice('mouse', wheel({ deltaY: 120 })), 'mouse')
  })

  it('锁定后不回退', () => {
    assert.equal(nextWheelInputDevice('trackpad', wheel({ deltaY: 120 })), 'trackpad')
    assert.equal(nextWheelInputDevice('trackpad', wheel({ deltaY: 4.0002 })), 'trackpad')
  })
})

describe('wheelDeltaToPixels', () => {
  it('按行/按页的 delta 换算成像素', () => {
    assert.deepEqual(wheelDeltaToPixels(wheel({ deltaX: 2, deltaY: 3 }), 16, 800), { x: 2, y: 3 })
    assert.deepEqual(wheelDeltaToPixels(wheel({ deltaY: 3, deltaMode: 1 }), 16, 800), { x: 0, y: 48 })
    assert.deepEqual(wheelDeltaToPixels(wheel({ deltaY: 1, deltaMode: 2 }), 16, 800), { x: 0, y: 800 })
  })
})

describe('wheelZoomInputScale', () => {
  it('只有触控板捏合放大，滚轮与 ⌘+滚动走基准', async () => {
    const {
      wheelZoomInputScale,
      STAGE_CAMERA_WHEEL_MULTIPLIER,
      STAGE_CAMERA_PLAIN_WHEEL_BOOST,
    } = await import('../camera/constants')
    const base = { deltaX: 0, deltaY: 8, deltaMode: 0, ctrlKey: false, metaKey: false }
    assert.equal(wheelZoomInputScale({ ...base, deltaY: 120 }, 'mouse'), STAGE_CAMERA_WHEEL_MULTIPLIER)
    assert.equal(wheelZoomInputScale({ ...base, metaKey: true }, 'trackpad'), STAGE_CAMERA_WHEEL_MULTIPLIER)
    // Windows 上 Ctrl+真滚轮也走基准，别被捏合那档放大冲飞。
    assert.equal(wheelZoomInputScale({ ...base, ctrlKey: true }, 'mouse'), STAGE_CAMERA_WHEEL_MULTIPLIER)
    // 系统合成的触控板捏合。
    assert.equal(
      wheelZoomInputScale({ ...base, ctrlKey: true }, 'trackpad'),
      STAGE_CAMERA_WHEEL_MULTIPLIER * STAGE_CAMERA_PLAIN_WHEEL_BOOST,
    )
  })
})


describe('pointerCentroid', () => {
  it('双指取中点', () => {
    assert.deepEqual(pointerCentroid([{ x: 0, y: 0 }, { x: 10, y: 20 }]), { x: 5, y: 10 })
  })
})

describe('touchGestureState', () => {
  it('双指整体平移时中心跟着走，指间距不变', () => {
    const before = touchGestureState([{ x: 0, y: 0 }, { x: 100, y: 0 }])
    const after = touchGestureState([{ x: 40, y: 30 }, { x: 140, y: 30 }])
    assert.ok(before)
    assert.ok(after)
    assert.equal(after.centerX - before.centerX, 40)
    assert.equal(after.centerY - before.centerY, 30)
    assert.equal(after.spread - before.spread, 0)
  })

  it('捏合张开时指间距变大，中心不动', () => {
    const before = touchGestureState([{ x: 40, y: 0 }, { x: 60, y: 0 }])
    const after = touchGestureState([{ x: 0, y: 0 }, { x: 100, y: 0 }])
    assert.ok(before)
    assert.ok(after)
    assert.equal(after.centerX, before.centerX)
    assert.equal(before.spread, 20)
    assert.equal(after.spread, 100)
  })
})

describe('decideTouchGestureMode', () => {
  it('位移和指距都还很小时不下结论', () => {
    assert.equal(decideTouchGestureMode(null, 2, 1), null)
  })

  it('双指整体上下滑锁成平移，不会跑去缩放', () => {
    assert.equal(decideTouchGestureMode(null, 20, 0), 'pan')
    assert.equal(decideTouchGestureMode(null, 20, 8), 'pan')
  })

  it('指距变化明显压过中心位移才锁成捏合', () => {
    assert.equal(decideTouchGestureMode(null, 2, 20), 'pinch')
    assert.equal(decideTouchGestureMode(null, 2, -20), 'pinch')
  })

  it('锁定后整段手势不再切模式', () => {
    assert.equal(decideTouchGestureMode('pan', 1, 60), 'pan')
    assert.equal(decideTouchGestureMode('pinch', 60, 1), 'pinch')
  })
})
