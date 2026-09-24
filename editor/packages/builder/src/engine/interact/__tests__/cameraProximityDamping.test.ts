import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { BoxGeometry, GridHelper, Mesh } from 'three'
import {
  computeProximitySpeedFactor,
  computeWheelProximitySpeedFactor,
  measureNearestSurfaceClearance,
} from '../camera/cameraProximityDamping'

function boxMesh(width: number, height: number, depth: number, y = 0): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, depth))
  mesh.position.y = y
  mesh.updateMatrixWorld()
  return mesh
}

describe('computeProximitySpeedFactor', () => {
  it('far from the surface keeps full speed', () => {
    assert.equal(computeProximitySpeedFactor(4, 2.5, 0.2, 0.04), 1)
    assert.equal(computeProximitySpeedFactor(null, 2.5, 0.2, 0.04), 1)
  })

  it('inside the inner radius uses the minimum factor', () => {
    assert.equal(computeProximitySpeedFactor(0.1, 2.5, 0.2, 0.04), 0.04)
    assert.equal(computeProximitySpeedFactor(0, 2.5, 0.2, 0.04), 0.04)
  })

  it('smoothsteps between the start and end distances', () => {
    const mid = computeProximitySpeedFactor(1.35, 2.5, 0.2, 0.04)
    assert.ok(mid > 0.04 && mid < 1)
  })
})

describe('computeWheelProximitySpeedFactor', () => {
  it('zoom-out stays full speed until inside the inner radius', () => {
    assert.equal(computeWheelProximitySpeedFactor(1, false, 3.2, 0.25, 0.01), 1)
    const tight = computeWheelProximitySpeedFactor(0.1, false, 3.2, 0.25, 0.01)
    assert.ok(tight > 0.01 && tight < 1)
  })

  it('zoom-in uses a squared proximity falloff', () => {
    const linear = computeProximitySpeedFactor(1, 3.2, 0.25, 0.01)
    const wheel = computeWheelProximitySpeedFactor(1, true, 3.2, 0.25, 0.01)
    assert.ok(wheel <= linear)
    assert.ok(wheel >= 0.01)
  })
})

describe('measureNearestSurfaceClearance', () => {
  it('does not treat a large ground slab as a height limit', () => {
    const ground = boxMesh(60, 0.2, 60, 0)
    assert.equal(measureNearestSurfaceClearance({ x: 0, y: 0.4, z: 0 }, [ground]), null)
    assert.equal(measureNearestSurfaceClearance({ x: 0, y: 0.02, z: 0 }, [ground]), null)
    assert.equal(measureNearestSurfaceClearance({ x: 0, y: -0.3, z: 0 }, [ground]), null)
  })

  it('ignores the environment ground mesh and grid', () => {
    const ground = boxMesh(60, 0.2, 60, 0)
    ground.name = 't3d-ground'
    const grid = new GridHelper(20, 20)
    assert.equal(measureNearestSurfaceClearance({ x: 0, y: 0.15, z: 0 }, [ground, grid]), null)
  })

  it('still reports side clearance to a standing object', () => {
    const body = boxMesh(1, 2, 1, 1)
    const dist = measureNearestSurfaceClearance({ x: 3, y: 1, z: 0 }, [body])
    assert.ok(dist !== null && dist > 2.4 && dist < 2.6)
  })

  it('does not use the top of a standing object as a height ceiling', () => {
    const body = boxMesh(1, 2, 1, 1)
    assert.equal(measureNearestSurfaceClearance({ x: 0, y: 2.4, z: 0 }, [body]), null)
  })
})
