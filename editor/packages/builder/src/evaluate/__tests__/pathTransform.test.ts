import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { DraftNode } from '../../contract/types'
import {
  inverseTransformPathWorldPoint,
  pathControlCentroid,
  samplePathPoints,
  samplePathWorldFromControls,
  transformPathLocalPoint,
  writePathPointWorld,
} from '../path/samplePath'

function makePath(
  points: { x: number; y: number; z: number }[],
  transform?: DraftNode['transform'],
  parameterization: string = 'arc-length',
): DraftNode {
  return {
    id: 'path-1',
    type: 'path',
    name: '轨迹1',
    visible: true,
    locked: false,
    transform: transform ?? {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    path: {
      source: 'click',
      curve: parameterization === 'arc-length' ? 'catmullRom' : 'polyline',
      closed: false,
      groundSnap: true,
      parameterization,
      smoothing: 0,
      points: points.map((p, i) => ({
        id: `p${i}`,
        position: p,
        ...(parameterization === 'time-ratio' ? { timeRatio: points.length <= 1 ? 0 : i / (points.length - 1) } : {}),
      })),
    },
  }
}

test('pathControlCentroid averages control points', () => {
  const n = makePath([
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 0, z: 2 },
    { x: 0, y: 0, z: 2 },
  ])
  assert.deepEqual(pathControlCentroid(n), { x: 1, y: 0, z: 1 })
})

test('identity transform keeps legacy P + T', () => {
  const n = makePath(
    [
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
    ],
    {
      position: { x: 10, y: 0, z: -3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  )
  const c = pathControlCentroid(n)
  const w = transformPathLocalPoint({ x: 1, y: 2, z: 3 }, n.transform, c)
  assert.deepEqual(w, { x: 11, y: 2, z: 0 })
})

test('scale about center leaves center fixed', () => {
  const n = makePath(
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
    },
  )
  const c = pathControlCentroid(n)
  assert.deepEqual(transformPathLocalPoint(c, n.transform, c), c)
  assert.deepEqual(transformPathLocalPoint({ x: 0, y: 0, z: 0 }, n.transform, c), { x: -1, y: 0, z: 0 })
  assert.deepEqual(transformPathLocalPoint({ x: 2, y: 0, z: 0 }, n.transform, c), { x: 3, y: 0, z: 0 })
})

test('Y=90° rotation about center maps relative +X to -Z', () => {
  const n = makePath(
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 90, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  )
  const c = pathControlCentroid(n)
  const w = transformPathLocalPoint({ x: 2, y: 0, z: 0 }, n.transform, c)
  assert.ok(Math.abs(w.x - 1) < 1e-9, `x=${w.x}`)
  assert.ok(Math.abs(w.y) < 1e-9, `y=${w.y}`)
  assert.ok(Math.abs(w.z - -1) < 1e-9, `z=${w.z}`)
})

test('samplePathPoints includes scale about center', () => {
  const n = makePath(
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 1, z: 1 },
    },
    'time-ratio',
  )
  const pts = samplePathPoints(n)
  assert.equal(pts.length, 2)
  assert.deepEqual(pts[0], { x: -1, y: 0, z: 0 })
  assert.deepEqual(pts[1], { x: 3, y: 0, z: 0 })
})

test('inverseTransformPathWorldPoint roundtrips identity / translate / scale / yaw', () => {
  const cases: DraftNode['transform'][] = [
    { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    { position: { x: 4, y: -1, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 1, z: 0.5 } },
    { position: { x: 1, y: 0, z: -1 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  ]
  const local = { x: 2, y: 0.5, z: -3 }
  const center = { x: 1, y: 0, z: 1 }
  for (const xf of cases) {
    const world = transformPathLocalPoint(local, xf, center)
    const back = inverseTransformPathWorldPoint(world, xf, center)
    assert.ok(Math.abs(back.x - local.x) < 1e-9, `x ${back.x}`)
    assert.ok(Math.abs(back.y - local.y) < 1e-9, `y ${back.y}`)
    assert.ok(Math.abs(back.z - local.z) < 1e-9, `z ${back.z}`)
  }
})

test('writePathPointWorld identity transform writes world minus translation', () => {
  const n = makePath(
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    {
      position: { x: 3, y: 0, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  )
  assert.equal(writePathPointWorld(n, 1, { x: 8, y: 2, z: 4 }), true)
  assert.deepEqual(n.path?.points[1].position, { x: 5, y: 2, z: 3 })
  assert.equal(writePathPointWorld(n, 9, { x: 0, y: 0, z: 0 }), false)
})

test('samplePathWorldFromControls samples through world control points', () => {
  const pts = samplePathWorldFromControls(
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    false,
    'time-ratio',
  )
  assert.deepEqual(pts, [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ])
})

test('editing a control invalidates the sampled curve and arc-length cache', () => {
  const n = makePath([{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }])
  samplePathPoints(n) // Populate the same cache used by the viewport and playback.
  writePathPointWorld(n, 1, { x: 2, y: 5, z: 0 })
  const sampled = samplePathPoints(n)
  assert.deepEqual(sampled, samplePathPoints(JSON.parse(JSON.stringify(n))))
  assert.ok(sampled.some((point) => point.y > 4.9))
})

test('editing a transformed path keeps the other controls fixed in world space', () => {
  const n = makePath(
    [{ x: 0, y: 0, z: 0 }, { x: 2, y: 1, z: 0 }, { x: 4, y: 0, z: 3 }],
    { position: { x: 3, y: 2, z: 1 }, rotation: { x: 25, y: 40, z: 15 }, scale: { x: 2, y: 1, z: 0.5 } },
  )
  const center = pathControlCentroid(n)
  const expected = n.path!.points.map((p) => transformPathLocalPoint(p.position, n.transform, center))
  expected[1] = { x: 8, y: 6, z: -2 }
  writePathPointWorld(n, 1, expected[1])
  const nextCenter = pathControlCentroid(n)
  n.path!.points.forEach((p, i) => {
    const actual = transformPathLocalPoint(p.position, n.transform, nextCenter)
    assert.ok(Math.hypot(actual.x - expected[i].x, actual.y - expected[i].y, actual.z - expected[i].z) < 1e-9)
  })
})

