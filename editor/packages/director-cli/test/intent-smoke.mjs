import assert from 'node:assert/strict'
import { applyStudioIntentCommand } from '../applyIntent.mjs'

function emptyDocument() {
  return {
    type: 'biz/scene3d-director-document',
    pippitAssetId: 'intent_smoke',
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
        fps: 30,
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

let document = emptyDocument()
for (const [index, name] of ['女人', '男人', '小孩'].entries()) {
  const added = applyStudioIntentCommand({
    document,
    intent: {
      type: 'add-character',
      libraryId: `chr-${index}`,
      name,
      modelUrl: `library/${name}.glb`,
    },
  })
  document = added.document
}
const chars = document.content.nodes.filter((n) => n.type === 'character')
assert.deepEqual(chars.map((n) => n.transform.position.x), [0, 1, 2])
assert.ok(chars.every((n) => n.character.animation.posePresetId === 't-pose'))

const camera = applyStudioIntentCommand({
  document,
  intent: { type: 'add-camera', presetId: 'front-wide', subjectNodeId: chars[0].id },
})
document = camera.document
assert.ok(document.content.nodes.some((n) => n.id === camera.nodeId && n.type === 'camera'))

const motion = applyStudioIntentCommand({
  document,
  intent: {
    type: 'add-motion',
    libraryId: 'walk',
    name: '走路',
    fbxKey: 'motions/walk.fbx',
    targetNodeId: chars[0].id,
    frameStart: 0,
    durationSeconds: 2,
  },
})
document = motion.document
const clip = document.content.timeline.animation.motionClips[0]
assert.equal(clip.frameStart, 0)
assert.equal(clip.frameEnd, 60)
assert.equal(clip.target.nodeId, chars[0].id)

const patched = applyStudioIntentCommand({
  document,
  intent: { type: 'patch-transform', nodeId: chars[1].id, position: { z: -1 } },
})
const man = patched.document.content.nodes.find((n) => n.id === chars[1].id)
assert.equal(man.transform.position.x, 1)
assert.equal(man.transform.position.z, -1)
process.stdout.write('intent-smoke ok\n')
