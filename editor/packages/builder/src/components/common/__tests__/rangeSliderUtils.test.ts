import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  applyRangeThumb,
  pickCloserThumb,
  rangePercent,
  valueFromClientX,
} from '../rangeSliderUtils'

test('valueFromClientX maps pointer position to a rounded frame', () => {
  assert.equal(valueFromClientX(50, 0, 100, 0, 200), 100)
  assert.equal(valueFromClientX(25, 0, 100, 0, 200), 50)
})

test('valueFromClientX clamps to the min/max range', () => {
  assert.equal(valueFromClientX(-20, 0, 100, 10, 90), 10)
  assert.equal(valueFromClientX(140, 0, 100, 10, 90), 90)
})

test('valueFromClientX returns min when the track has no width', () => {
  assert.equal(valueFromClientX(40, 10, 0, 4, 80), 4)
})

test('pickCloserThumb prefers the nearer handle, and start on a tie', () => {
  assert.equal(pickCloserThumb(12, 10, 40), 'start')
  assert.equal(pickCloserThumb(38, 10, 40), 'end')
  assert.equal(pickCloserThumb(25, 10, 40), 'start')
})

test('applyRangeThumb keeps start from crossing end', () => {
  assert.deepEqual(applyRangeThumb('start', 80, 10, 40, 0, 100), { start: 40, end: 40 })
  assert.deepEqual(applyRangeThumb('end', 5, 10, 40, 0, 100), { start: 10, end: 10 })
})

test('applyRangeThumb clamps to the overall min/max', () => {
  assert.deepEqual(applyRangeThumb('start', -8, 10, 40, 0, 100), { start: 0, end: 40 })
  assert.deepEqual(applyRangeThumb('end', 140, 10, 40, 0, 100), { start: 10, end: 100 })
})

test('rangePercent is 0 when min equals max', () => {
  assert.equal(rangePercent(12, 20, 20), 0)
  assert.equal(rangePercent(0, 0, 100), 0)
  assert.equal(rangePercent(50, 0, 100), 50)
  assert.equal(rangePercent(100, 0, 100), 100)
})
