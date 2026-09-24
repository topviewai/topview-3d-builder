import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  ASPECT_RATIO_PRESETS,
  AUTO_ASPECT_RATIO,
  DEFAULT_ASPECT_RATIO,
  FALLBACK_ASPECT,
  isAutoAspectRatio,
  normalizeAspectRatio,
  parseAspectRatio,
  resolveAspectRatio,
  widthFromAspectHeight,
} from '../../contract/aspectRatio'

test('画幅预设都能解析', () => {
  const expected = [1, 4 / 3, 3 / 4, 16 / 9, 9 / 16, 21 / 9]
  for (const [i, preset] of ASPECT_RATIO_PRESETS.entries()) {
    assert.ok(Math.abs(parseAspectRatio(preset) - expected[i]) < 1e-6, preset)
  }
})

test('非法画幅回退 Auto，数值解析回退 21:9', () => {
  assert.equal(normalizeAspectRatio(''), DEFAULT_ASPECT_RATIO)
  assert.equal(normalizeAspectRatio('wide'), DEFAULT_ASPECT_RATIO)
  assert.ok(Math.abs(parseAspectRatio(undefined) - FALLBACK_ASPECT) < 1e-6)
  assert.ok(Math.abs(parseAspectRatio('auto') - FALLBACK_ASPECT) < 1e-6)
})

test('Auto 规范化并按视口求值', () => {
  assert.equal(normalizeAspectRatio('Auto'), AUTO_ASPECT_RATIO)
  assert.equal(normalizeAspectRatio('auto'), AUTO_ASPECT_RATIO)
  assert.equal(isAutoAspectRatio('auto'), true)
  assert.ok(Math.abs(resolveAspectRatio('auto', 16 / 9) - 16 / 9) < 1e-6)
  assert.ok(Math.abs(resolveAspectRatio('16:9', 1) - 16 / 9) < 1e-6)
  assert.ok(Math.abs(resolveAspectRatio('auto', 0) - FALLBACK_ASPECT) < 1e-6)
})

test('2.35:1 仍可当自定义比例解析', () => {
  assert.equal(normalizeAspectRatio('2.35:1'), '2.35:1')
  assert.ok(Math.abs(parseAspectRatio('2.35:1') - 2.35) < 1e-6)
})

test('导出宽度跟画幅走', () => {
  assert.equal(widthFromAspectHeight(810, 21 / 9), 1890)
  assert.equal(widthFromAspectHeight(810, 16 / 9), 1440)
  assert.equal(widthFromAspectHeight(810, 9 / 16), 456)
})
