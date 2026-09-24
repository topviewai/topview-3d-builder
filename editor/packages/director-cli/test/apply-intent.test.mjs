import assert from 'node:assert/strict'
import test from 'node:test'
import { applyStudioIntentCommand, applyStudioIntentsCommand, listCameraPresetsCommand } from '../applyIntent.mjs'

function emptyDocument() {
  return {
    type: 'biz/scene3d-director-document',
    pippitAssetId: 'intent_test',
    extra: {},
    content: {
      version: 1,
      aspectRatio: '16:9',
      activeShotCameraNodeId: 'cam-main',
      environment: {
        background: { mode: 'color', skyColor: '#87CEEB' },
        display: {
          characterLabelsVisible: true,
          groundVisible: true,
          groundHeight: 0,
          groundOpacity: 1,
        },
      },
      asset: { motionPath: [] },
      nodes: [{
        id: 'cam-main',
        type: 'camera',
        name: '主相机',
        visible: true,
        locked: false,
        transform: {
          position: { x: 0, y: 1.8, z: 5 },
          rotation: { x: -8, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        camera: {
          projection: 'perspective',
          fov: 50,
          fovAxis: 'vertical',
          near: 0.1,
          far: 2000,
          isPrimary: true,
          lookAt: { x: 0, y: 1.2, z: 0 },
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
          motionTransitions: [],
          motionClips: [],
          pathMotionClips: [],
        },
      },
    },
  }
}

test('apply-intent places static characters at x=0,1 without motion clips', () => {
  const first = applyStudioIntentCommand({
    document: emptyDocument(),
    intent: {
      type: 'add-character',
      libraryId: 'chr-a',
      name: '女人',
      modelUrl: 'library/woman.glb',
    },
  })
  const second = applyStudioIntentCommand({
    document: first.document,
    intent: {
      type: 'add-character',
      libraryId: 'chr-b',
      name: '男人',
      modelUrl: 'library/man.glb',
    },
  })
  const chars = second.document.content.nodes.filter((n) => n.type === 'character')
  assert.equal(chars[0].transform.position.x, 0)
  assert.equal(chars[1].transform.position.x, 1)
  assert.equal(chars[0].character.animation.mode, 'pose')
  assert.equal(chars[1].character.animation.mode, 'pose')
  assert.deepEqual(second.document.content.timeline.animation.motionClips, [])
  assert.equal(chars[0].character.placeholder, false)
})

test('list-camera-presets omits current', () => {
  const listed = listCameraPresetsCommand()
  assert.equal(listed.ok, true)
  assert.ok(listed.presets.some((p) => p.id === 'front-wide'))
  assert.ok(!listed.presets.some((p) => p.id === 'current'))
})

test('apply-intents applies in order and names the failing caller index', () => {
  const result = applyStudioIntentsCommand({
    document: emptyDocument(),
    intents: [
      { index: 0, intent: { type: 'add-character', nodeId: 'hero', libraryId: 'chr-a', name: 'Hero', modelUrl: 'library/a.glb' } },
      { index: 0, intent: { type: 'patch-transform', nodeId: 'hero', position: { x: 2 } } },
    ],
  })
  const hero = result.document.content.nodes.find((n) => n.id === 'hero')
  assert.equal(hero.transform.position.x, 2)
  assert.throws(() => applyStudioIntentsCommand({
    document: result.document,
    intents: [{ index: 3, intent: { type: 'patch-transform', nodeId: 'ghost', position: { x: 1 } } }],
  }), /^Error: INTENT_REJECTED:3:NODE_NOT_FOUND:ghost/)
})
