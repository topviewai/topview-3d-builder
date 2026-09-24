import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import { EditorCameraController } from '../camera/EditorCameraController'

const DEFAULT_POSITION = [7, 4.5, 9] as const
const DEFAULT_TARGET = [0, 1, 0] as const

function horizonTilt(camera: THREE.PerspectiveCamera): number {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
  return Math.abs(right.y)
}

function makeRig(camera: THREE.PerspectiveCamera): EditorCameraController {
  return new EditorCameraController(camera, {
    invalidate() {},
    getSceneMeshes: () => [],
    getOrbitPivot: () => ({ x: 0, y: 1, z: 0 }),
    syncLookTarget() {},
  })
}

test('lookAt 默认视角后 snapFromCamera 地平线保持水平', () => {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2000)
  camera.position.set(...DEFAULT_POSITION)
  camera.lookAt(...DEFAULT_TARGET)
  const afterLookAt = horizonTilt(camera)
  assert.ok(afterLookAt < 1e-6, `lookAt tilt=${afterLookAt}`)

  makeRig(camera).snapFromCamera()
  camera.updateMatrixWorld()
  const afterSnap = horizonTilt(camera)
  assert.ok(afterSnap < 1e-5, `snapFromCamera tilt=${afterSnap}`)
})
