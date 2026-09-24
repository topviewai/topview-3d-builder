import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { buildStageCameraWirePositions, stageCameraFrameExtents } from '../stageCameraWire'

describe('stageCameraFrameExtents', () => {
  it('90° 正方形画幅在 dist=1 时半高为 1', () => {
    const frame = stageCameraFrameExtents(90, 1, 1)
    assert.ok(Math.abs(frame.halfH - 1) < 1e-9)
    assert.ok(Math.abs(frame.halfW - 1) < 1e-9)
    assert.equal(frame.dist, 1)
  })

  it('16:9 按纵横比拉宽', () => {
    const frame = stageCameraFrameExtents(90, 16 / 9, 1)
    assert.ok(Math.abs(frame.halfW / frame.halfH - 16 / 9) < 1e-9)
  })
})

describe('buildStageCameraWirePositions', () => {
  it('画幅在 local -Z，原点在 0', () => {
    const positions = buildStageCameraWirePositions(90, 1, 1)
    assert.equal(positions.length % 6, 0)
    assert.equal(positions[0], 0)
    assert.equal(positions[1], 0)
    assert.equal(positions[2], 0)
    assert.equal(positions[5], -1)
  })
})
