import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createFrameSnapshot } from '../../evaluate/FrameSnapshot'
import { manualCameraLookAt } from '../../evaluate/camera/cameraAim'
import { applyFrameSnapshot } from '../objects/applySnapshot'
import type { StageGraph } from '../objects/graph'

test('手动看点与 Three XYZ 视线一致，倾斜在下一帧保持且不改变瞄准', () => {
  const rotation = { x: 20, y: 35, z: 40 }
  const position = { x: 1, y: 2, z: 5 }
  const reference = new THREE.PerspectiveCamera()
  reference.position.set(position.x, position.y, position.z)
  reference.rotation.set(...[rotation.x, rotation.y, rotation.z].map(THREE.MathUtils.degToRad) as [number, number, number])
  const lookAt = manualCameraLookAt(position, rotation, 5)
  const direction = new THREE.Vector3().subVectors(new THREE.Vector3(lookAt.x, lookAt.y, lookAt.z), reference.position).normalize()
  assert.ok(direction.distanceTo(reference.getWorldDirection(new THREE.Vector3())) < 1e-9)
  const node = {
    id: 'cam', name: 'Camera', type: 'camera' as const, visible: true, locked: false,
    transform: { position, rotation, scale: { x: 1, y: 1, z: 1 } },
  }
  const camera = new THREE.PerspectiveCamera()
  const graph = {
    doc: null, scene: new THREE.Scene(), nodeById: new Map([['cam', node]]),
    characters: new Map(), props: new Map(), primitives: new Map(), groups: new Map(),
    cameras: new Map([['cam', { camera, lookAt: new THREE.Vector3(), gizmo: { group: new THREE.Group() } }]]),
  } as unknown as StageGraph
  const snapshot = createFrameSnapshot()
  snapshot.transforms.set('cam', { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, lookAt, fov: 50, useEuler: false })
  applyFrameSnapshot(graph, snapshot)
  assert.ok(camera.quaternion.angleTo(reference.quaternion) < 1e-7)
  // An evaluated target moving away must still win over the authored orientation.
  snapshot.transforms.get('cam')!.lookAt = { x: 10, y: 2, z: 5 }
  applyFrameSnapshot(graph, snapshot)
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-9)
})
