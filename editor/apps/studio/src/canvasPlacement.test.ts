import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boxesFromCanvasState, placeMediaNode, type CanvasBox } from './canvasPlacement.ts'

const image = (x: number, y = 40): CanvasBox => ({ type: 'image', x, y, w: 480, h: 270 })

test('first node starts at the origin', () => {
  assert.deepEqual(placeMediaNode('image', []), { x: 40, y: 40 })
})

test('another image continues the image row', () => {
  assert.deepEqual(placeMediaNode('image', [image(40)]), { x: 552, y: 40 })
})

test('a video starts a row below existing images', () => {
  assert.deepEqual(placeMediaNode('video', [image(40), image(552)]), { x: 40, y: 460 })
})

test('a later video continues the video row', () => {
  const video: CanvasBox = { type: 'video', x: 40, y: 460, w: 480, h: 270 }
  assert.deepEqual(placeMediaNode('video', [image(40), video]), { x: 552, y: 460 })
})

test('state nodes become boxes and children are ignored', () => {
  assert.deepEqual(
    boxesFromCanvasState({
      nodes: [
        { type: 'image', x: 40, y: 40, width: 480, height: 270 },
        { type: 'video', parentId: 'group_1', x: 0, y: 0, w: 100, h: 100 },
        { type: 'text', geometry: { x: 10, y: 20 } },
      ],
    }),
    [
      { type: 'image', x: 40, y: 40, w: 480, h: 270 },
      { type: 'text', x: 10, y: 20, w: 240, h: 240 },
    ],
  )
})
