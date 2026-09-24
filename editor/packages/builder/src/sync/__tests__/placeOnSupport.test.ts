import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument, DraftNode } from '../../contract/types'
import { EditorStore } from '../../stores/EditorStore'
import { StudioSession } from '../../sync/StudioSession'
import { DirectorDoc } from '../../document/DirectorDoc'
import { History } from '../../document/History'
import type { DirectorEngine } from '../../engine/DirectorEngine'
import type { HostAdapter } from '../../host/types'
import { highSupportHits, pickTopSurfaceRest, seatOnSupport } from '../transformEdit'

function propNode(id: string, x: number, y: number, z: number): DraftNode {
  return {
    id,
    type: 'prop',
    name: id,
    visible: true,
    locked: false,
    transform: {
      position: { x, y, z },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }
}

function sessionWithProps() {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('place-on', 30, 120)
  doc.content.nodes.push(propNode('cup', 4, 3, 1), propNode('table', 0, 0, 0))
  model.replace(doc)
  const editor = new EditorStore('place-on')
  editor.autoKeyframe = false
  const history = new History()
  const engine = {
    currentFrame: 0,
    getNodeSnapshot: (id: string) => {
      const n = doc.content.nodes.find((node) => node.id === id)
      const p = n?.transform.position
      return p ? { position: [p.x, p.y, p.z], rotation: [0, 0, 0], scale: [1, 1, 1] } : null
    },
    worldContactY: (id: string) => (id === 'cup' ? 2.5 : 0),
    worldContactPoint: (id: string) =>
      id === 'cup' ? { x: 4, y: 2.5, z: 1 } : { x: 0, y: 0, z: 0 },
    meshSupportHits: (id: string) =>
      id === 'table'
        ? [
            { x: -0.4, y: 1, z: -0.4 },
            { x: 0.4, y: 1, z: -0.4 },
            { x: -0.4, y: 1, z: 0.4 },
            { x: 0.4, y: 1, z: 0.4 },
            { x: 0, y: 1, z: 0 },
          ]
        : [],
    worldAabb: (id: string) =>
      id === 'cup'
        ? {
            minX: 3.5,
            minY: 2.5,
            minZ: 0.5,
            maxX: 4.5,
            maxY: 3.5,
            maxZ: 1.5,
            centerX: 4,
            centerY: 3,
            centerZ: 1,
          }
        : {
            minX: -1,
            minY: 0,
            minZ: -1,
            maxX: 1,
            maxY: 1,
            maxZ: 1,
            centerX: 0,
            centerY: 0.5,
            centerZ: 0,
          },
    applyLiveNodeTransform() {},
    setStagedTransform() {},
    clearStagedTransforms() {},
    hasStagedTransform() { return false },
    syncPathNodes() {},
    setPoseEditingId() {},
    syncGizmo() {},
    syncPathSelection() {},
    syncCameraMotionGuide() {},
    invalidate() {},
  } as unknown as DirectorEngine
  return {
    doc,
    session: new StudioSession(engine, model, editor, history, {} as HostAdapter<DirectorDocument>),
  }
}

test('放到另一节点上方：接触点对齐到网格落点', () => {
  const next = seatOnSupport({
    moverPos: { x: 10, y: 4, z: -3 },
    moverContact: { x: 10.5, y: 3, z: -3 },
    supportRest: { x: 0, y: 1.2, z: 2 },
  })
  assert.deepEqual(next, { x: -0.5, y: 2.2, z: 2 })
})

test('已经在承托面上且中心对齐时位移为 0', () => {
  const next = seatOnSupport({
    moverPos: { x: 1, y: 2, z: 3 },
    moverContact: { x: 1, y: 1.5, z: 3 },
    supportRest: { x: 1, y: 1.5, z: 3 },
  })
  assert.deepEqual(next, { x: 1, y: 2, z: 3 })
})

test('pickTopSurfaceRest 取最高一层命中的质心，忽略更低的层板', () => {
  const rest = pickTopSurfaceRest(
    [
      { x: 0, y: 0.4, z: 0 },
      { x: -0.5, y: 1.0, z: -0.2 },
      { x: 0.5, y: 1.01, z: 0.2 },
      { x: 0, y: 0.4, z: 1 },
    ],
    { x: 9, y: 9, z: 9 },
    1.2,
  )
  assert.ok(Math.abs(rest.x) < 1e-9)
  assert.ok(Math.abs(rest.z) < 1e-9)
  assert.ok(Math.abs(rest.y - 1.005) < 1e-9)
})

test('pickTopSurfaceRest 无命中时回退包围盒顶心', () => {
  assert.deepEqual(pickTopSurfaceRest([], { x: 1, y: 2, z: 3 }, 1), { x: 1, y: 2, z: 3 })
})

test('highSupportHits 丢掉人物脚面这类过低命中', () => {
  const usable = highSupportHits(
    [
      { x: 0, y: 0.04, z: 0 },
      { x: 0.1, y: 0.06, z: 0.1 },
      { x: 0, y: 1.7, z: 0 },
    ],
    0.72,
  )
  assert.deepEqual(usable, [{ x: 0, y: 1.7, z: 0 }])
})

test('人物承托只打到脚面时回退到包围盒顶', () => {
  const rest = pickTopSurfaceRest(
    highSupportHits(
      [
        { x: 0.2, y: 0.05, z: 0.1 },
        { x: -0.1, y: 0.03, z: 0 },
      ],
      0.72,
    ),
    { x: 0, y: 1.8, z: 0 },
    1.8,
  )
  assert.deepEqual(rest, { x: 0, y: 1.8, z: 0 })
})

test('placeNodeOnSupport 把杯子放到桌子顶面中心', () => {
  const { doc, session } = sessionWithProps()
  const err = session.placeNodeOnSupport('cup', 'table')
  assert.equal(err, null)
  assert.deepEqual(doc.content.nodes.find((n) => n.id === 'cup')?.transform.position, {
    x: 0,
    y: 1.5,
    z: 0,
  })
})

test('placeNodeOnSupport 拒绝放到自己上方', () => {
  const { session } = sessionWithProps()
  assert.equal(session.placeNodeOnSupport('cup', 'cup'), 'same-node')
})
