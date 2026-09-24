import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  isCentimeterMixamorig,
  mixamorigBindKey,
  mixamorigPositionScale,
} from '../rig/mixamorigBind'

function hipsRoot(x: number, y: number, z: number) {
  const hips = { name: 'mixamorigHips', position: { x, y, z, length: () => Math.hypot(x, y, z) } }
  return {
    getObjectByName: (name: string) => (name === 'mixamorigHips' ? hips : undefined),
  } as never
}

test('髋骨长度区分厘米 / 米 mixamorig', () => {
  assert.equal(isCentimeterMixamorig(hipsRoot(0, 1.27, -101)), true)
  assert.equal(isCentimeterMixamorig(hipsRoot(0, 0.01, -0.64)), false)
  assert.equal(mixamorigBindKey(hipsRoot(0, 1.27, -101)), 'cm')
  assert.equal(mixamorigBindKey(hipsRoot(0, 0.01, -0.64)), 'm')
})

test('直绑位移比：厘米对厘米 ≈ 1，米对厘米 ≈ 0.006', () => {
  assert.ok(Math.abs(mixamorigPositionScale(101, 100, 1) - 1.01) < 1e-6)
  const metric = mixamorigPositionScale(0.64, 100, 1)
  assert.ok(metric > 0.005 && metric < 0.008)
  assert.equal(mixamorigPositionScale(0.64, 0, 0.0064), 0.0064)
})
