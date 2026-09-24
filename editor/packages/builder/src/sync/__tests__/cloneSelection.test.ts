import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DraftNode } from '../../contract/types'
import { EditorStore } from '../../stores/EditorStore'
import { StudioSession } from '../../sync/StudioSession'
import { DirectorDoc } from '../../document/DirectorDoc'
import { History } from '../../document/History'
import { FCurveSet } from '../../evaluate/curves/FCurveSet'
import { makeKeyframe } from '../../evaluate/curves/KeyframeTrack'
import type { DirectorEngine } from '../../engine/DirectorEngine'
import type { HostAdapter } from '../../host/types'
import type { DirectorDocument } from '../../contract/types'

function charNode(id: string): DraftNode {
  return {
    id,
    type: 'character',
    name: id,
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    character: {
      placeholder: false,
      gender: 'unknown',
      motionId: null,
      appearance: { color: '#7fb2e0' },
      label: { showLabel: true, scale: 1, yOffset: 0 },
      animation: { mode: 'pose', posePresetId: 'tpose', controlValues: {} },
    },
  }
}

function engineStub(): DirectorEngine {
  const engineState = { currentFrame: 0 }
  return {
    get currentFrame() { return engineState.currentFrame },
    set currentFrame(frame: number) { engineState.currentFrame = frame },
    syncPathNodes() {},
    syncGizmo() {},
    syncPathSelection() {},
    syncCameraMotionGuide() {},
    removeNode() {},
    setFcurves() {},
    setEvalContext() {},
    applyLiveNodeTransform() {},
    seek(frame: number) {
      engineState.currentFrame = frame
    },
    setStagedTransform() {},
    clearStagedTransforms() {},
    hasStagedTransform() { return false },
    getNodeSnapshot() { return null },
    setPoseEditingId() {},
    invalidate() {},
  } as unknown as DirectorEngine
}

function fixture() {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('clone-test', 30, 300)
  doc.content.nodes.push(charNode('actor'))
  model.replace(doc)
  const editor = new EditorStore('clone-test')
  editor.autoKeyframe = false
  const history = new History()
  const engine = engineStub()
  const session = new StudioSession(engine, model, editor, history, {} as HostAdapter<DirectorDocument>)
  return { model, doc, editor, history, engine, session }
}

test('duplicateSelection 一次撤销回退 nodes / clips / userKeys / fcurves，重做恢复', () => {
  const { session, doc, model, editor, history } = fixture()
  doc.content.timeline.animation.motionClips.push({
    id: 'mc1',
    source: 'library',
    sourceDuration: 2,
    frameStart: 0,
    frameEnd: 20,
    target: { type: 'character', nodeId: 'actor' },
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none' },
    motion: {
      assetId: 'walk',
      name: '走',
      source: 'library',
      sourceRig: 'mixamorig',
      url: '3d-builder/library/motions/walk.fbx',
      inPlace: true,
      loop: false,
      speed: 1,
      time: 0,
    },
  })
  model.setUserKeys({ actor: { position: [makeKeyframe(0, [0, 0, 0])] } })
  const fc = FCurveSet.empty()
  fc.upsertKey('actor', 'transform.position', 0, 0, 0)
  model.setFcurves(fc)
  editor.select({ kind: 'node', nodeId: 'actor' })
  const docBefore = JSON.stringify(doc)
  const ukBefore = JSON.stringify(model.userKeys)
  const fcBefore = JSON.stringify(model.fcurves!.encode())

  session.duplicateSelection({ kind: 'offset', delta: { position: [0.5, 0, 0] } })
  assert.equal(history.undoStack.length, 1)
  assert.equal(doc.content.nodes.length, 2)
  const clone = doc.content.nodes.find((node) => node.id !== 'actor')!
  assert.equal(clone.transform.position.x, 0.5)
  assert.ok(model.userKeys[clone.id])
  assert.equal(model.fcurves!.hasTrack(clone.id, 'transform.position'), true)
  assert.equal(doc.content.timeline.animation.motionClips.length, 2)

  session.undo()
  assert.equal(JSON.stringify(doc), docBefore)
  assert.equal(JSON.stringify(model.userKeys), ukBefore)
  assert.equal(JSON.stringify(model.fcurves!.encode()), fcBefore)

  session.redo()
  assert.equal(doc.content.nodes.length, 2)
  assert.equal(doc.content.timeline.animation.motionClips.length, 2)
  const restored = doc.content.nodes.find((node) => node.id !== 'actor')!
  assert.ok(model.userKeys[restored.id])
  assert.equal(model.fcurves!.hasTrack(restored.id, 'transform.position'), true)
})
