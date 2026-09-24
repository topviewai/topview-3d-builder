import assert from 'node:assert/strict'
import { test } from 'vitest'
import { snapFrame, type SnapTarget } from '../utils'

const targets: SnapTarget[] = [
  { frame: 20, keyId: 'kf_a' },
  { frame: 48, clipId: 'clip_a' },
  { frame: 96, clipId: 'clip_a' },
]

test('snapFrame pulls to the nearest target inside the tolerance', () => {
  assert.equal(snapFrame(22, targets, 3), 20)
  assert.equal(snapFrame(50, targets, 3), 48)
})

test('snapFrame leaves the frame alone when nothing is close enough', () => {
  assert.equal(snapFrame(70, targets, 3), 70)
})

test('snapFrame skips the dragged keyframe and clip itself', () => {
  assert.equal(snapFrame(21, targets, 3, { excludeKeyIds: new Set(['kf_a']) }), 21)
  assert.equal(snapFrame(47, targets, 3, { excludeClipId: 'clip_a' }), 47)
})

test('snapFrame falls back to ruler ticks when no target is in range', () => {
  assert.equal(snapFrame(71, targets, 3, { tickStep: 24, tickOrigin: 0 }), 72)
  assert.equal(snapFrame(60, targets, 3, { tickStep: 24, tickOrigin: 0 }), 60)
})

test('snapFrame prefers a target over the tick at the same distance', () => {
  const near: SnapTarget[] = [{ frame: 22, keyId: 'kf_b' }]
  assert.equal(snapFrame(23, near, 3, { tickStep: 24, tickOrigin: 0 }), 22)
})
