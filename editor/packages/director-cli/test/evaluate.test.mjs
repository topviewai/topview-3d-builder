import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { evaluateDocumentFrames, validateDirectorDocument } from '../evaluate.mjs'

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../agent/topview_3d_cli/contracts/director-v1/fixtures',
)

test('evaluate uses primitive boxes so a floor origin below ground is not ORIGIN_BELOW_GROUND', () => {
  const document = JSON.parse(readFileSync(join(fixtureRoot, 'document.json'), 'utf8'))
  document.content.nodes.push({
    id: 'room_floor',
    type: 'primitive',
    name: 'floor',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: -0.03, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    primitive: { kind: 'BoxGeometry', parameters: { width: 8, height: 0.06, depth: 8 } },
  }, {
    id: 'wall_right',
    type: 'primitive',
    name: 'wall',
    visible: true,
    locked: false,
    transform: {
      position: { x: 2, y: 1.4, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    primitive: { kind: 'BoxGeometry', parameters: { width: 0.1, height: 2.8, depth: 6 } },
  })
  const result = evaluateDocumentFrames({ document, frames: [0] })
  const codes = result.issues
    .filter((issue) => issue.nodeId === 'room_floor' || issue.nodeId === 'wall_right')
    .map((issue) => `${issue.nodeId}:${issue.code}`)
  assert.deepEqual(codes, [])
})

test('evaluate unbound camera does not silently choose the first character as its target', () => {
  const document = JSON.parse(readFileSync(join(fixtureRoot, 'document.json'), 'utf8'))
  const result = evaluateDocumentFrames({ document, frames: [0] })
  assert.equal(result.frames.length, 1)
  assert.ok(result.frames[0].camera)
  assert.equal(typeof result.frames[0].camera.fov, 'number')
  assert.equal(result.frames[0].targetNodeId, null)
  assert.equal(result.frames[0].cameraTargetDistance, null)
  assert.equal(result.frames[0].targetInFrustum, null)
  assert.ok(result.frames[0].nodes.some((node) => node.nodeId === 'character_1'))
  assert.deepEqual(result.clipOverlaps, [])
})

test('evaluate bound camera reports metrics for its explicit target', () => {
  const document = JSON.parse(readFileSync(join(fixtureRoot, 'document.json'), 'utf8'))
  const camera = document.content.nodes.find((node) => node.id === 'camera_1')
  camera.camera.lookAtTarget = { nodeId: 'character_1', offset: { x: 0, y: 1.2, z: 0 } }
  const { frames: [frame] } = evaluateDocumentFrames({ document, frames: [0] })
  assert.equal(frame.targetNodeId, 'character_1')
  const target = frame.nodes.find((node) => node.nodeId === 'character_1')
  assert.equal(frame.cameraTargetDistance, target.cameraDistance)
  assert.equal(frame.targetInFrustum, target.inFrustum)
})

test('evaluate judges a character by its posed mesh bounds when nodeBounds are given', () => {
  const document = JSON.parse(readFileSync(join(fixtureRoot, 'document.json'), 'utf8'))
  const character = document.content.nodes.find((node) => node.id === 'character_1')
  character.transform.position.y = -0.9
  const camera = document.content.nodes.find((node) => node.id === 'camera_1')
  camera.camera.lookAtTarget = { nodeId: 'character_1', offset: { x: 0, y: 1.2, z: 0 } }
  const codes = (result) => result.issues.filter((issue) => issue.nodeId === 'character_1').map((issue) => issue.code)
  assert.ok(codes(evaluateDocumentFrames({ document, frames: [0] })).includes('ORIGIN_BELOW_GROUND'))
  const { x, z } = character.transform.position
  const seated = { min: { x: x - 0.3, y: 0, z: z - 0.3 }, max: { x: x + 0.3, y: 1.1, z: z + 0.3 } }
  const measured = evaluateDocumentFrames({ document, frames: [0], nodeBounds: { 0: { character_1: seated } } })
  assert.deepEqual(codes(measured), [])
  const node = measured.frames[0].nodes.find((row) => row.nodeId === 'character_1')
  assert.equal(node.basis, 'mesh')
  assert.equal(measured.frames[0].targetInFrustum, true)
  const sunk = { min: { ...seated.min, y: -0.3 }, max: seated.max }
  const below = evaluateDocumentFrames({ document, frames: [0], nodeBounds: { 0: { character_1: sunk } } })
  assert.deepEqual(codes(below), ['MESH_BELOW_GROUND'])
})

test('evaluate reports half-open clip overlaps on the same node', () => {
  const document = JSON.parse(readFileSync(join(fixtureRoot, 'document.json'), 'utf8'))
  document.content.timeline.animation.cameraMotionClips.push({
    id: 'clip_overlap',
    target: { type: 'node', nodeId: 'camera_1' },
    frameStart: 24,
    frameEnd: 60,
  })
  const result = evaluateDocumentFrames({ document, frames: [0] })
  assert.equal(result.clipOverlaps.length, 1)
  assert.equal(result.clipOverlaps[0].frameStart, 24)
  assert.equal(result.clipOverlaps[0].frameEnd, 48)
})

test('validate accepts the director fixture document', async () => {
  const document = JSON.parse(readFileSync(join(fixtureRoot, 'document.json'), 'utf8'))
  assert.deepEqual(await validateDirectorDocument({ document }), { ok: true })
})

test('validate rejects a node missing name/visible/locked', async () => {
  await assert.rejects(() => validateDirectorDocument({
    document: {
      type: 'biz/scene3d-director-document',
      pippitAssetId: 'x',
      content: {
        version: 1,
        aspectRatio: '16:9',
        activeShotCameraNodeId: 'cam',
        environment: {
          background: { mode: 'color', skyColor: '#000' },
          display: {
            characterLabelsVisible: true,
            groundVisible: true,
            groundHeight: 0,
            groundOpacity: 1,
          },
        },
        asset: { motionPath: [] },
        nodes: [{
          id: 'cam',
          type: 'camera',
          transform: {
            position: { x: 0, y: 1, z: 5 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        }],
        physicalConstraints: [],
        timeline: {
          version: 1,
          fps: 24,
          frameStart: 0,
          frameEnd: 120,
          usePreviewRange: false,
          animation: {
            fcurves: [],
            cameraMotionClips: [],
            motionClips: [],
            pathMotionClips: [],
          },
        },
      },
    },
  }))
})
