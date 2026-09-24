import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  clampNumber,
  commitNumericDraft,
  formatAxisNumber,
  formatScrubNumber,
  isNumericDraft,
  parseNumericDraft,
  quantizeNumber,
  scrubNumericValue,
} from '../numericDraft'

test('输入过程允许空、负号、小数点', () => {
  assert.equal(isNumericDraft(''), true)
  assert.equal(isNumericDraft('-'), true)
  assert.equal(isNumericDraft('.'), true)
  assert.equal(isNumericDraft('-.'), true)
  assert.equal(isNumericDraft('0.'), true)
  assert.equal(isNumericDraft('0.9'), true)
  assert.equal(isNumericDraft('abc'), false)
  assert.equal(isNumericDraft('1.2.3'), false)
})

test('未写完的草稿不解析，失焦时保留原始精度，只有显式输入零才归零', () => {
  assert.equal(parseNumericDraft(''), null)
  assert.equal(parseNumericDraft('.'), null)
  assert.equal(parseNumericDraft('-'), null)
  assert.equal(parseNumericDraft('0.9'), 0.9)
  assert.equal(parseNumericDraft('.9'), 0.9)
  assert.equal(commitNumericDraft('', 1.234567), 1.234567)
  assert.equal(commitNumericDraft('.', 1.234567), 1.234567)
  assert.equal(commitNumericDraft('-', -6.789), -6.789)
  assert.equal(commitNumericDraft('abc', 42), 42)
  assert.equal(commitNumericDraft('2.', 42), 2)
  assert.equal(commitNumericDraft('0', 42), 0)
  assert.equal(commitNumericDraft('1.234567', 42), 1.234567)
})

test('显示值去掉多余小数位', () => {
  assert.equal(formatAxisNumber(2), '2')
  assert.equal(formatAxisNumber(0.9), '0.9')
  assert.equal(formatAxisNumber(1.2346), '1.235')
  assert.equal(formatScrubNumber(12.4, 0), '12')
  assert.equal(formatScrubNumber(10, 1, true), '10.0')
})

test('横向 scrub 按位移和 step 改值，并夹紧、按精度取整', () => {
  assert.equal(clampNumber(12, 0, 10), 10)
  assert.equal(quantizeNumber(1.2346, 3), 1.235)
  assert.equal(quantizeNumber(1.6, 0), 2)
  assert.equal(scrubNumericValue(1, 20, 0.05), 2)
  assert.equal(scrubNumericValue(1, 2, 0.05), 1.1)
  assert.equal(scrubNumericValue(0, -100, 1, { min: 0, max: 10, precision: 0 }), 0)
  assert.equal(scrubNumericValue(5, 80, 1, { min: 0, max: 10, precision: 0 }), 10)
})
