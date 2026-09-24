import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { projectObjectWireframe } from '../selectionBox'

test('看向预览保留包围盒的八个顶点和十二条边，并随视角更新', () => {
  const geometry = new THREE.BoxGeometry(2, 3, 1)
  const material = new THREE.MeshBasicMaterial()
  const object = new THREE.Mesh(geometry, material)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  const container = { getBoundingClientRect: () => ({ width: 600, height: 600 }) } as HTMLElement
  camera.position.set(5, 4, 8)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  const edges = projectObjectWireframe(object, camera, container)
  assert.equal(edges.length, 12)
  const vertices = new Set(edges.flatMap(e => [`${e.x1},${e.y1}`, `${e.x2},${e.y2}`]))
  assert.equal(vertices.size, 8)
  camera.position.x = -5
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  assert.ok(JSON.stringify(projectObjectWireframe(object, camera, container)) !== JSON.stringify(edges))
  geometry.dispose()
  material.dispose()
})
