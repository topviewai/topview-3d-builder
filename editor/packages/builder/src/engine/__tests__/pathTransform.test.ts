import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import type { DraftNode } from '../../contract/types'
import { pathControlCentroid, samplePathPoints, transformPathLocalPoint, writePathPointWorld } from '../../evaluate/path/samplePath'
import { applyLivePathTransform, buildPathInstance, type PathViewHost } from '../objects/PathObject'

function fixture() {
  const node: DraftNode = {
    id: 'path', type: 'path', name: 'path', visible: true, locked: false,
    transform: {
      position: { x: 3, y: 2, z: -1 },
      rotation: { x: 25, y: 40, z: -15 },
      scale: { x: 2, y: 1, z: 0.5 },
    },
    path: {
      source: 'click', curve: 'catmullRom', closed: false, groundSnap: false,
      parameterization: 'arc-length', smoothing: 0.5,
      points: [
        { id: 'a', position: { x: 0, y: 0, z: 0 } },
        { id: 'b', position: { x: 2, y: 1, z: 0 } },
        { id: 'c', position: { x: 2, y: 0, z: 3 } },
      ],
    },
  }
  const graph = {
    scene: new THREE.Scene(), nodeById: new Map(), pathNodes: new Map(),
    pathViews: new Map(), pathPickTargets: new Map(), pathMaterials: new Map(),
    selectedPathId: 'path', visiblePathIds: new Set(),
  } as unknown as PathViewHost
  buildPathInstance(graph, node)
  return { graph, node }
}

function near(actual: THREE.Vector3, expected: { x: number; y: number; z: number }) {
  assert.ok(actual.distanceTo(new THREE.Vector3(expected.x, expected.y, expected.z)) < 1e-5)
}

test('控制点编辑结束后，曲线与全部控制点一起平移', () => {
  const { graph, node } = fixture()
  writePathPointWorld(node, 1, { x: 8, y: 6, z: -2 })
  buildPathInstance(graph, node)
  const fresh = JSON.parse(JSON.stringify(node)) as DraftNode
  const before = samplePathPoints(fresh)
  const center = pathControlCentroid(node)
  const transform = { ...node.transform, position: { ...node.transform.position, x: node.transform.position.x + 3 } }
  applyLivePathTransform(graph, node.id, transform)
  const mats = graph.pathMaterials.get(node.id)!
  const line = mats.lineObj!
  const vertices = line.geometry.getAttribute('position')
  before.forEach((point, i) => near(
    line.localToWorld(new THREE.Vector3().fromBufferAttribute(vertices, i)),
    { ...point, x: point.x + 3 },
  ))
  mats.points.forEach((point, i) => near(
    point.mesh.getWorldPosition(new THREE.Vector3()),
    transformPathLocalPoint(node.path!.points[i].position, transform, center),
  ))
})

test('整体平移、复合旋转、非均匀缩放预览与提交后全路径一致', () => {
  const { graph, node } = fixture()
  const center = pathControlCentroid(node)
  const controlsBefore = JSON.stringify(node.path!.points)
  const transforms = [
    { ...node.transform, position: { x: 6, y: -1, z: 2 } },
    { ...node.transform, rotation: { x: -35, y: 80, z: 27 } },
    { ...node.transform, scale: { x: 0.5, y: 3, z: 2 } },
  ]
  for (const transform of transforms) {
    applyLivePathTransform(graph, node.id, transform)
    const mats = graph.pathMaterials.get(node.id)!
    for (const [i, point] of mats.points.entries()) {
      near(point.mesh.getWorldPosition(new THREE.Vector3()),
        transformPathLocalPoint(node.path!.points[i].position, transform, center))
    }
    const samples = samplePathPoints({ ...node, transform })
    const line = mats.lineObj!
    const vertices = line.geometry.getAttribute('position')
    for (let i = 0; i < vertices.count; i++) {
      near(line.localToWorld(new THREE.Vector3().fromBufferAttribute(vertices, i)), samples[i])
    }
    // 方向锥也必须继承同一整体变换。
    const cones = graph.pathViews.get(node.id)!.children.filter(
      (child) => (child as THREE.Mesh).material === mats.direction,
    )
    const step = Math.max(1, Math.floor(samples.length / 12))
    cones.forEach((cone, i) => near(cone.getWorldPosition(new THREE.Vector3()), samples[(i + 1) * step]))
  }
  assert.equal(JSON.stringify(node.path!.points), controlsBefore)
})
