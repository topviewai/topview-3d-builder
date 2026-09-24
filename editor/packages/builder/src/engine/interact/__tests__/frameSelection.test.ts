import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { BoxGeometry, Mesh, Vector3 } from 'three'
import { computeFocusCameraPose, unionWorldBounds } from '../frameSelection'

describe('computeFocusCameraPose', () => {
  it('沿默认 (0,2,5) 方向拉开到能包住包围盒', () => {
    const center = new Vector3(0, 1, 0)
    const pose = computeFocusCameraPose({
      center,
      halfSize: { x: 1, y: 1, z: 1 },
      aspect: 16 / 9,
      fovDeg: 50,
    })
    const offset = pose.position.clone().sub(center)
    assert.ok(offset.length() > 2)
    assert.ok(Math.abs(offset.normalize().dot(new Vector3(0, 2, 5).normalize()) - 1) < 1e-6)
  })
})

describe('unionWorldBounds', () => {
  it('并集可见物体的世界包围盒', () => {
    const a = new Mesh(new BoxGeometry(2, 2, 2))
    a.position.set(-2, 1, 0)
    const b = new Mesh(new BoxGeometry(2, 2, 2))
    b.position.set(2, 1, 0)
    const box = unionWorldBounds([a, b])
    assert.ok(box)
    assert.ok(box!.min.x < -2)
    assert.ok(box!.max.x > 2)
  })
})
