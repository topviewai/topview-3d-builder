import assert from 'node:assert/strict'
import test from 'node:test'
import { applyEditSequenceOps, summarizeEditorial } from '../editSequence.mjs'

function cameraDocument() {
  return {
    type: 'biz/scene3d-director-document',
    pippitAssetId: 'edit_seq_test',
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
        name: 'cam-main',
        visible: true,
        locked: false,
        transform: {
          position: { x: 0, y: 1.8, z: 5 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        camera: {
          projection: 'perspective',
          fov: 50,
          fovAxis: 'vertical',
          near: 0.1,
          far: 2000,
          isPrimary: true,
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

test('edit-sequence inserts a closed-range clip and reports duration', () => {
  const document = cameraDocument()
  const result = applyEditSequenceOps({
    document,
    ops: [
      { op: 'clip.insert', sequenceId: 'sequence_1', cameraNodeId: 'cam-main',
        sourceFrameStart: 0, sourceFrameEnd: 23 },
    ],
  })
  assert.equal(result.ok, true)
  assert.equal(result.createdIds.length, 1)
  assert.equal(result.editorial.sequences[0].clips.length, 1)
  assert.equal(result.editorial.sequences[0].clips[0].sourceFrameEnd, 23)
  const summary = summarizeEditorial({
    ...document,
    content: { ...document.content, editorial: result.editorial },
  })
  assert.equal(summary.sequences[0].durationFrames, 24)
})

test('clip.insert without sequenceId uses the active sequence', () => {
  const document = cameraDocument()
  const result = applyEditSequenceOps({
    document,
    ops: [
      { op: 'clip.insert', cameraNodeId: 'cam-main',
        sourceFrameStart: 0, sourceFrameEnd: 23 },
    ],
  })
  assert.equal(result.ok, true)
  assert.equal(result.editorial.activeSequenceId, 'sequence_1')
  assert.equal(result.editorial.sequences.length, 1)
  assert.equal(result.editorial.sequences[0].clips.length, 1)
})

test('edit-sequence rejects an invalid camera without writing', () => {
  const result = applyEditSequenceOps({
    document: cameraDocument(),
    ops: [
      { op: 'clip.insert', sequenceId: 'sequence_1', cameraNodeId: 'missing-cam',
        sourceFrameStart: 0, sourceFrameEnd: 23 },
    ],
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'invalid-camera')
})

test('summarizeEditorial materializes an empty sequence without writing', () => {
  const summary = summarizeEditorial(cameraDocument())
  assert.equal(summary.activeSequenceId, 'sequence_1')
  assert.equal(summary.sequences.length, 1)
  assert.deepEqual(summary.sequences[0].clips, [])
  assert.equal(summary.sequences[0].durationFrames, 0)
})
