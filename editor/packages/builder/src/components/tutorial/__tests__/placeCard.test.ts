import assert from 'node:assert/strict'
import { test } from 'vitest'
import { TUTORIAL_STEPS } from '../constants'
import {
  isUsableRect,
  placeCard,
  stepIndexAfter,
  visibleTutorialSteps,
} from '../utils'

const root = { left: 0, top: 0, width: 1440, height: 900 }
const card = { width: 340, height: 180 }

test('placeCard puts leftover cards to the right when there is room', () => {
  const target = { left: 20, top: 60, width: 240, height: 520 }
  const placed = placeCard(target, root, card, 'right')
  assert.equal(placed.side, 'right')
  assert.ok(placed.left >= target.left + target.width)
})

test('placeCard puts inspector cards to the left when there is room', () => {
  const target = { left: 1160, top: 60, width: 260, height: 700 }
  const placed = placeCard(target, root, card, 'left')
  assert.equal(placed.side, 'left')
  assert.ok(placed.left + card.width <= target.left)
})

test('placeCard keeps oversized viewport cards inside the target', () => {
  const target = { left: 280, top: 50, width: 860, height: 560 }
  const placed = placeCard(target, root, card, 'bottom')
  assert.ok(placed.left >= target.left)
  assert.ok(placed.left + card.width <= target.left + target.width + 1)
  assert.ok(placed.top + card.height <= target.top + target.height + 1)
})

test('placeCard clamps into the root when every side overflows', () => {
  const tinyRoot = { left: 0, top: 0, width: 400, height: 240 }
  const target = { left: 10, top: 10, width: 380, height: 220 }
  const placed = placeCard(target, tinyRoot, card, 'right')
  assert.ok(placed.left >= 0)
  assert.ok(placed.top >= 0)
  assert.ok(placed.left + card.width <= tinyRoot.width)
  assert.ok(placed.top + card.height <= tinyRoot.height)
})

test('visibleTutorialSteps drops missing or tiny anchors', () => {
  const visible = visibleTutorialSteps(TUTORIAL_STEPS, (id) => {
    if (id === 'tools') return { left: 0, top: 0, width: 2, height: 2 }
    if (id === 'leftrail') return { left: 0, top: 0, width: 200, height: 400 }
    return null
  })
  assert.deepEqual(visible.map((step) => step.id), ['leftrail'])
})

test('isUsableRect rejects empty boxes', () => {
  assert.equal(isUsableRect({ left: 0, top: 0, width: 0, height: 40 }), false)
  assert.equal(isUsableRect({ left: 0, top: 0, width: 40, height: 40 }), true)
})

test('stepIndexAfter stops at the ends', () => {
  assert.equal(stepIndexAfter(0, 5, -1), null)
  assert.equal(stepIndexAfter(4, 5, 1), null)
  assert.equal(stepIndexAfter(2, 5, 1), 3)
})
