import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  GROUND_GRID_MAJOR_DIVISIONS,
  GROUND_GRID_MINOR_CELL,
  GROUND_GRID_MINOR_SPLITS,
  GROUND_GRID_SIZE,
  buildGroundGridPositions,
} from '../groundGrid'
import { GROUND_SIZE } from '../environment'

function constantsOn(positions: Float32Array, axis: 'x' | 'z'): number[] {
  const values: number[] = []
  for (let i = 0; i < positions.length; i += 6) {
    const a0 = axis === 'x' ? positions[i] : positions[i + 2]
    const a1 = axis === 'x' ? positions[i + 3] : positions[i + 5]
    const b0 = axis === 'x' ? positions[i + 2] : positions[i]
    const b1 = axis === 'x' ? positions[i + 5] : positions[i + 3]
    if (Math.abs(a0 - a1) > 1e-6) continue
    if (Math.abs(b0 - b1) < 1e-6) continue
    values.push(a0)
  }
  values.sort((a, b) => a - b)
  return values
}

test('主网格横纵基准线同距，且不单独加亮中心线', () => {
  const positions = buildGroundGridPositions('major')
  const xs = constantsOn(positions, 'x')
  const zs = constantsOn(positions, 'z')
  assert.deepEqual(xs, zs)
  assert.equal(xs.length, GROUND_GRID_MAJOR_DIVISIONS + 1)
  assert.equal(GROUND_GRID_SIZE, GROUND_SIZE)
  const step = GROUND_GRID_MINOR_CELL * GROUND_GRID_MINOR_SPLITS
  assert.equal(step, 5)
  assert.equal(xs[0], -GROUND_GRID_SIZE / 2)
  assert.equal(xs[xs.length - 1], GROUND_GRID_SIZE / 2)
  for (let i = 1; i < xs.length; i++) {
    assert.ok(Math.abs(xs[i] - xs[i - 1] - step) < 1e-6)
  }
  assert.ok(xs.includes(0))
})

test('相邻主线之间等距插入 4 条次级线，把单元格分成 5 格', () => {
  const minors = constantsOn(buildGroundGridPositions('minor'), 'x')
  const majors = constantsOn(buildGroundGridPositions('major'), 'x')
  const step = GROUND_GRID_MINOR_CELL
  assert.equal(step, 1)
  assert.equal(minors.length, GROUND_GRID_MAJOR_DIVISIONS * (GROUND_GRID_MINOR_SPLITS - 1))
  for (const major of majors) {
    assert.ok(!minors.some((value) => Math.abs(value - major) < 1e-6))
  }
  for (let i = 0; i < majors.length - 1; i++) {
    const inside = minors.filter((value) => value > majors[i] + 1e-6 && value < majors[i + 1] - 1e-6)
    assert.equal(inside.length, GROUND_GRID_MINOR_SPLITS - 1)
    for (let n = 0; n < inside.length; n++) {
      assert.ok(Math.abs(inside[n] - (majors[i] + (n + 1) * step)) < 1e-6)
    }
  }
})
