import { clipIntersectsMarquee } from '../constants'
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { LEFT_W, TRACK_INSET, frameFromContentClientX } from '../constants'

test('frameFromContentClientX maps the track origin to frameStart', () => {
  const contentLeft = 100
  const originX = contentLeft + LEFT_W + TRACK_INSET
  assert.equal(frameFromContentClientX(originX, contentLeft, 12, 2), 12)
})

test('frameFromContentClientX converts pixels after the origin into frames', () => {
  const contentLeft = 0
  const x = LEFT_W + TRACK_INSET + 40
  assert.equal(frameFromContentClientX(x, contentLeft, 0, 2), 20)
})


test('marquee intersects the visible edge of a long clip without reaching its centre', () => {
  const clip = { left: -1000, right: 200, top: 50, bottom: 72 }
  assert.equal(clipIntersectsMarquee(clip, { left: 150, right: 180, top: 60, bottom: 80 }), true)
  assert.equal(clipIntersectsMarquee(clip, { left: 201, right: 240, top: 60, bottom: 80 }), false)
  assert.equal(clipIntersectsMarquee(clip, { left: 150, right: 180, top: 73, bottom: 90 }), false)
})
