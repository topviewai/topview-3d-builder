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

function actor(id = 'actor'): DraftNode {
  return {
    id,
    type: 'character',
    name: 'Female_1',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    character: {
      placeholder: false,
      gender: 'female',
      motionId: null,
      appearance: { color: '#fff' },
      label: { showLabel: true, scale: 1, yOffset: 0 },
      animation: { mode: 'pose', posePresetId: 'tpose', controlValues: {} },
    },
  }
}

function camNode(): DraftNode {
  return {
    id: 'cam',
    type: 'camera',
    name: '机位',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 1.6, z: 4 },
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
      lookAt: { x: 0, y: 1.2, z: 0 },
    },
  }
}

function fixture() {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('motion-target-test', 30, 240)
  doc.content.nodes.push(camNode(), actor())
  model.replace(doc)
  const editor = new EditorStore('motion-target-test')
  editor.autoKeyframe = false
  editor.setActiveCamera('cam')
  const engine = {
    currentFrame: 0,
    setFcurves() {},
    syncPathNodes() {},
    syncCameraMotionGuide() {},
    applyLiveCameraPose() {},
    setStagedTransform() {},
    clearStagedTransforms() {},
    hasStagedTransform() { return false },
    applyLiveCameraFov() {},
    getNodeSnapshot() {
      return null
    },
  } as unknown as DirectorEngine
  const session = new StudioSession(
    engine,
    model,
    editor,
    new History(),
    {} as HostAdapter<DirectorDocument>,
  )
  return { doc, session, editor }
}

test('连点 required-target 运镜：第一条切到 clip 后第二条仍能跟上同一角色', () => {
  const { doc, session, editor } = fixture()
  editor.select({ kind: 'node', nodeId: 'actor' })
  assert.equal(session.applyCameraMotion('follow_tracking'), null)
  assert.equal(editor.selection?.kind, 'clip')
  assert.equal(session.applyCameraMotion('leading_tracking'), null)
  const clips = doc.content.timeline.animation.cameraMotionClips
  assert.equal(clips.length, 2)
  assert.equal(clips[0].motion.presetId, 'follow_tracking')
  assert.equal(clips[1].motion.presetId, 'leading_tracking')
  assert.equal(clips[0].motion.metadata?.targetNodeId, 'actor')
  assert.equal(clips[1].motion.metadata?.targetNodeId, 'actor')
})
