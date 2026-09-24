import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  rippleResizeClip,
  rippleShiftClipsAfter,
  rippleShiftClipsBefore,
} from '../clipRipple'

const track = [
  { id: 'a', frameStart: 0, frameEnd: 60 },
  { id: 'b', frameStart: 100, frameEnd: 160 },
  { id: 'c', frameStart: 160, frameEnd: 220 },
]

test('rippleShiftClipsAfter preserves gaps when lengthening', () => {
  const shifts = rippleShiftClipsAfter(track, 'a', 20)
  assert.deepEqual(shifts.b, { frameStart: 120, frameEnd: 180 })
  assert.deepEqual(shifts.c, { frameStart: 180, frameEnd: 240 })
  assert.equal(shifts.a, undefined)
})

test('rippleResizeClip end edge lengthens and pushes suffix', () => {
  const layout = rippleResizeClip(track, 'a', 'end', 80, 0)
  assert.ok(layout)
  assert.deepEqual(layout!.positions.a, { frameStart: 0, frameEnd: 80 })
  assert.deepEqual(layout!.positions.b, { frameStart: 120, frameEnd: 180 })
  assert.deepEqual(layout!.positions.c, { frameStart: 180, frameEnd: 240 })
  assert.equal(layout!.positions.b.frameStart - layout!.positions.a.frameEnd, 40)
})

test('rippleResizeClip end edge shortens and pulls suffix', () => {
  const layout = rippleResizeClip(track, 'a', 'end', 40, 0)
  assert.ok(layout)
  assert.deepEqual(layout!.positions.a, { frameStart: 0, frameEnd: 40 })
  assert.deepEqual(layout!.positions.b, { frameStart: 80, frameEnd: 140 })
  assert.deepEqual(layout!.positions.c, { frameStart: 140, frameEnd: 200 })
  assert.equal(layout!.positions.b.frameStart - layout!.positions.a.frameEnd, 40)
})

test('rippleResizeClip start edge blocked when prefix cannot move past minFrame', () => {
  // Gap-preserving ripple would push a to -20; clamped → no change.
  const layout = rippleResizeClip(track, 'b', 'start', 80, 0)
  assert.ok(layout)
  assert.deepEqual(layout!.positions.b, { frameStart: 100, frameEnd: 160 })
  assert.deepEqual(layout!.positions.a, { frameStart: 0, frameEnd: 60 })
})

test('rippleShiftClipsBefore clamps to minFrame', () => {
  const { shifts, appliedDelta } = rippleShiftClipsBefore(track, 'b', -20, 0)
  assert.equal(appliedDelta, 0)
  assert.deepEqual(shifts, {})
})

test('rippleResizeClip start edge shortens and pushes prefix right', () => {
  const layout = rippleResizeClip(track, 'b', 'start', 120, 0)
  assert.ok(layout)
  assert.deepEqual(layout!.positions.b, { frameStart: 120, frameEnd: 160 })
  assert.deepEqual(layout!.positions.a, { frameStart: 20, frameEnd: 80 })
  assert.equal(layout!.positions.b.frameStart - layout!.positions.a.frameEnd, 40)
})

test('rippleResizeClip start edge can lengthen when room before minFrame', () => {
  const roomy = [
    { id: 'a', frameStart: 40, frameEnd: 80 },
    { id: 'b', frameStart: 120, frameEnd: 180 },
  ]
  const layout = rippleResizeClip(roomy, 'b', 'start', 100, 0)
  assert.ok(layout)
  assert.deepEqual(layout!.positions.b, { frameStart: 100, frameEnd: 180 })
  assert.deepEqual(layout!.positions.a, { frameStart: 20, frameEnd: 60 })
  assert.equal(layout!.positions.b.frameStart - layout!.positions.a.frameEnd, 40)
})

test('rippleResizeClip end edge does not push the track past maxFrame', () => {
  const layout = rippleResizeClip(track, 'a', 'end', 400, 0, 230)
  assert.ok(layout)
  assert.deepEqual(layout!.positions.a, { frameStart: 0, frameEnd: 70 })
  assert.deepEqual(layout!.positions.c, { frameStart: 170, frameEnd: 230 })
  assert.equal(layout!.trackFrameEnd, 230)
})

test('rippleResizeClip end edge of last clip stops at maxFrame', () => {
  const layout = rippleResizeClip(track, 'c', 'end', 400, 0, 240)
  assert.ok(layout)
  assert.deepEqual(layout!.positions.c, { frameStart: 160, frameEnd: 240 })
  assert.equal(layout!.trackFrameEnd, 240)
})
