import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import * as THREE from 'three'
import { computeViewCenterPivot } from '../camera/viewCenterPivot'

function cameraAt(px: number, py: number, pz: number, look: [number, number, number]): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(px, py, pz)
  camera.lookAt(look[0], look[1], look[2])
  camera.updateMatrixWorld()
  return camera
}

describe('computeViewCenterPivot', () => {
  it('屏幕中心打到物体时用命中点，不跟侧边物体走', () => {
    const camera = cameraAt(0, 2, 8, [0, 1, 0])
    const center = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial())
    center.position.set(0, 1, 0)
    center.updateMatrixWorld()
    const side = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial())
    side.position.set(6, 1, 0)
    side.updateMatrixWorld()
    const pivot = computeViewCenterPivot(camera, [center, side], { x: 6, y: 1, z: 0 })
    assert.ok(Math.abs(pivot.x) < 0.6, `应打在画面中间，实际 x=${pivot.x}`)
    assert.ok(Math.abs(pivot.z) < 0.6, `应打在画面中间，实际 z=${pivot.z}`)
  })

  it('没有物体时落到地面平面', () => {
    const camera = cameraAt(0, 4, 8, [0, 0, 0])
    const pivot = computeViewCenterPivot(camera, [], null)
    assert.ok(Math.abs(pivot.y) < 1e-6, `地面 y 应为 0，实际 ${pivot.y}`)
  })

  it('视线接近水平时支点距离被夹住，不跑到几百米外', () => {
    const camera = cameraAt(0, 2, 0, [0, 1.98, -400])
    const pivot = computeViewCenterPivot(camera, [], null)
    const dist = Math.hypot(pivot.x - 0, pivot.y - 2, pivot.z - 0)
    assert.ok(dist <= 30 + 1e-6, `支点距离应被夹到 30 以内，实际 ${dist}`)
    assert.ok(dist > 1, `支点不应贴在相机上，实际 ${dist}`)
  })
})
