import assert from 'node:assert/strict'
import { test } from 'vitest'
import { isDrawPointOnGround } from '../objects/PathObject'

test('无限绘制平面接受任意有限坐标，拒绝非有限坐标', () => {
  assert.equal(isDrawPointOnGround([0, 1.5, 0]), true)
  assert.equal(isDrawPointOnGround([200, 0, -200]), true)
  assert.equal(isDrawPointOnGround([Number.POSITIVE_INFINITY, 0, 0]), false)
  assert.equal(isDrawPointOnGround([0, Number.NaN, 0]), false)
})
