import assert from 'node:assert/strict'
import { test } from 'vitest'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import { parseDirectorDocument } from '../../contract/validate'
import { CAMERA_PRESETS } from '../../data/cameraLibrary'
import { defaultPoseLibraryPoseId, setPoseLibraryBank } from '../../data/poseLibraryBank'
import type { DirectorDocument } from '../../contract/types'
import {
  applyStudioIntent,
  listStudioCameraPresets,
  StudioIntentError,
} from '../studioIntents'

const CAM = {
  fov: 50,
  position: { x: 0, y: 1.7, z: 5 },
  rotation: { x: 0, y: 0, z: 0 },
  lookAt: { x: 0, y: 1.2, z: 0 },
}

function emptyDoc(totalFrames = 90): DirectorDocument {
  return makeEmptyDraft('studio-intents', 30, totalFrames, CAM)
}

function requirePreset(id: string) {
  const found = CAMERA_PRESETS.find((item) => item.id === id)
  if (!found) throw new Error(`missing preset ${id}`)
  return found
}

test('加人按角色数偏移 x，默认 t-pose，且不改输入草稿', () => {
  setPoseLibraryBank([
    {
      id: 't-pose',
      name: 'T-Pose',
      nameZh: 'Tpose',
      tag: 'common',
      tags: ['common'],
      rank: 1,
      hips: [0, 0, 0],
      bones: {},
      bonesLoaded: true,
    },
  ])
  const doc = emptyDoc()
  const first = applyStudioIntent({
    document: doc,
    intent: {
      type: 'add-character',
      libraryId: 'chr-a',
      name: '女人',
      modelUrl: '3d-builder/library/woman.glb',
    },
  })
  const second = applyStudioIntent({
    document: first.document,
    intent: {
      type: 'add-character',
      libraryId: 'chr-b',
      name: '男人',
      modelUrl: '3d-builder/library/man.glb',
    },
  })
  const chars = second.document.content.nodes.filter((n) => n.type === 'character')
  assert.equal(chars.length, 2)
  assert.equal(chars[0].transform.position.x, 0)
  assert.equal(chars[1].transform.position.x, 1)
  assert.equal(chars[0].character?.animation.posePresetId, defaultPoseLibraryPoseId())
  assert.equal(chars[0].character?.placeholder, false)
  assert.equal(chars[0].metadata.modelUrl, '3d-builder/library/woman.glb')
  assert.equal(chars[0].metadata.assetId, 'chr-a')
  assert.equal(doc.content.nodes.filter((n) => n.type === 'character').length, 0)
  parseDirectorDocument(second.document)
})

test('加构图相机写入 preset 字段，禁止 current', () => {
  const wide = requirePreset('front-wide')
  const added = applyStudioIntent({
    document: emptyDoc(),
    intent: { type: 'add-camera', presetId: 'front-wide', nodeId: 'cam-wide' },
  })
  const cam = added.document.content.nodes.find((n) => n.id === 'cam-wide')
  if (!cam?.camera) throw new Error('missing camera node')
  assert.equal(cam.camera.fov, wide.fov)
  assert.deepEqual(cam.transform.position, wide.position)
  assert.deepEqual(cam.camera.lookAt, wide.lookAt)
  assert.equal(added.nodeId, 'cam-wide')
  try {
    applyStudioIntent({
      document: emptyDoc(),
      intent: { type: 'add-camera', presetId: 'current' },
    })
    throw new Error('expected current preset to fail')
  } catch (error) {
    if (!(error instanceof StudioIntentError)) throw error
    assert.equal(error.code, 'current-viewport-unavailable')
  }
  assert.ok(!listStudioCameraPresets().some((p) => p.id === 'current'))
  parseDirectorDocument(added.document)
})

test('加角色动作写入半开区间 clip，重叠后移', () => {
  const withChar = applyStudioIntent({
    document: emptyDoc(),
    intent: {
      type: 'add-character',
      libraryId: 'chr-a',
      name: '女人',
      modelUrl: 'woman.glb',
      nodeId: 'actor',
    },
  })
  const first = applyStudioIntent({
    document: withChar.document,
    intent: {
      type: 'add-motion',
      libraryId: 'walk',
      name: '走路',
      fbxKey: 'motions/walk.fbx',
      targetNodeId: 'actor',
      frameStart: 0,
      durationSeconds: 2,
    },
  })
  const walk = first.document.content.timeline.animation.motionClips[0]
  assert.equal(walk.frameStart, 0)
  assert.equal(walk.frameEnd, 60)
  assert.equal(walk.target.nodeId, 'actor')
  const second = applyStudioIntent({
    document: first.document,
    intent: {
      type: 'add-motion',
      libraryId: 'wave',
      name: '挥手',
      fbxKey: 'motions/wave.fbx',
      targetNodeId: 'actor',
      frameStart: 30,
      durationSeconds: 1,
    },
  })
  const clips = second.document.content.timeline.animation.motionClips
  const walkAfter = clips.find((c) => c.motion.assetId === 'walk')
  const wave = clips.find((c) => c.motion.assetId === 'wave')
  if (!walkAfter || !wave) throw new Error('missing motion clips')
  assert.equal(wave.frameStart, 30)
  assert.equal(wave.frameEnd, 60)
  assert.equal(walkAfter.frameStart, 60)
  assert.equal(walkAfter.frameEnd, 120)
  assert.equal(second.document.content.timeline.frameEnd, withChar.document.content.timeline.frameEnd,
    'adding and cascading motion clips must preserve the user playback end')
  assert.ok(walkAfter.frameStart >= wave.frameEnd)
  assert.ok(second.document.content.asset.motionPath.some((e) => e.path === 'motions/wave.fbx'))
  parseDirectorDocument(second.document)
})
