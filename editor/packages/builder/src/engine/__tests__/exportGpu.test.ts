import assert from 'node:assert/strict'
import { test } from 'vitest'
import { flipRgbaRows } from '../io/exportPixels'

test('flipRgbaRows 把 WebGL 左下原点翻成 canvas 左上', () => {
  const width = 2
  const height = 2
  const pixels = Uint8Array.from([
    255, 0, 0, 255, 255, 0, 0, 255,
    0, 0, 255, 255, 0, 0, 255, 255,
  ])
  const flipped = flipRgbaRows(pixels, width, height)
  assert.deepEqual([...flipped.subarray(0, 4)], [0, 0, 255, 255])
  assert.deepEqual([...flipped.subarray(8, 12)], [255, 0, 0, 255])
})
