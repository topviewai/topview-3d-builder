import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument, DraftNode } from '../../contract/types'
import { EditorStore } from '../../stores/EditorStore'
import { StudioSession } from '../../sync/StudioSession'
import { DirectorDoc } from '../../document/DirectorDoc'
import { History } from '../../document/History'
import { FCurveSet } from '../../evaluate/curves/FCurveSet'
import { makeKeyframe } from '../../evaluate/curves/KeyframeTrack'
import type { DirectorEngine } from '../../engine/DirectorEngine'
import type { HostAdapter } from '../../host/types'

const charNode = (id: string): DraftNode => ({
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
})

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
  const doc = makeEmptyDraft('undo-test', 30, 300)
  doc.content.nodes.push(charNode('actor'))
  model.replace(doc)
  const editor = new EditorStore('undo-test')
  editor.autoKeyframe = false
  const history = new History()
  const engine = engineStub()
  const session = new StudioSession(engine, model, editor, history, {} as HostAdapter<DirectorDocument>)
  return { model, doc, editor, history, engine, session }
}

test('deleteNode → undo 恢复节点的 userKeys / fcurves 轨道，redo 再删掉', () => {
  const { session, doc, model, history } = fixture()
  model.setUserKeys({ actor: { position: [makeKeyframe(0, [1, 2, 3])] } })
  const fc = FCurveSet.empty()
  fc.upsertKey('actor', 'transform.position', 0, 0, 1)
  model.setFcurves(fc)
  const docBefore = JSON.stringify(doc)
  const ukBefore = JSON.stringify(model.userKeys)
  const fcBefore = JSON.stringify(model.fcurves!.encode())

  session.deleteNode('actor')
  assert.equal(doc.content.nodes.some((n) => n.id === 'actor'), false)
  assert.equal(model.userKeys.actor, undefined)
  assert.equal(model.fcurves!.hasTrack('actor', 'transform.position'), false)
  assert.equal(history.undoStack.length, 1)

  session.undo()
  assert.equal(JSON.stringify(doc), docBefore)
  assert.equal(JSON.stringify(model.userKeys), ukBefore)
  assert.equal(JSON.stringify(model.fcurves!.encode()), fcBefore)

  session.redo()
  assert.equal(doc.content.nodes.some((n) => n.id === 'actor'), false)
  assert.equal(model.userKeys.actor, undefined)
  assert.equal(model.fcurves!.hasTrack('actor', 'transform.position'), false)
})

test('多选删除一次入栈，undo 全部恢复', () => {
  const { session, doc, model, editor, history } = fixture()
  doc.content.nodes.push(charNode('actor_2'))
  model.setUserKeys({
    actor: { position: [makeKeyframe(0, [1, 2, 3])] },
    actor_2: { position: [makeKeyframe(0, [4, 5, 6])] },
  })
  editor.select({ kind: 'node', nodeId: 'actor_2', nodeIds: ['actor', 'actor_2'] })
  const docBefore = JSON.stringify(doc)
  const ukBefore = JSON.stringify(model.userKeys)

  session.deleteSelection()
  assert.equal(doc.content.nodes.some((n) => n.id === 'actor'), false)
  assert.equal(doc.content.nodes.some((n) => n.id === 'actor_2'), false)
  assert.equal(model.userKeys.actor, undefined)
  assert.equal(model.userKeys.actor_2, undefined)
  assert.equal(history.undoStack.length, 1)

  session.undo()
  assert.equal(JSON.stringify(doc), docBefore)
  assert.equal(JSON.stringify(model.userKeys), ukBefore)
  assert.equal(doc.content.nodes.some((n) => n.id === 'actor'), true)
  assert.equal(doc.content.nodes.some((n) => n.id === 'actor_2'), true)
})

test('gizmo 拖拽流：begin → 连续写入 → 最终提交 → end 只产生一条历史，undo/redo 精确还原三件套', () => {
  const { session, doc, model, history } = fixture()
  const docBefore = JSON.stringify(doc)

  session.beginInteraction()
  // 拖拽期间连续 upsert（被 history 抑制，不入栈）
  session.upsertKeyframeAtFrame('actor', 'position', [1, 0, 0])
  session.upsertKeyframeAtFrame('actor', 'position', [2, 0, 0])
  session.upsertKeyframeAtFrame('actor', 'position', [3, 0, 0])
  assert.equal(history.canUndo, false)
  // 松手最终提交：仍在 interaction 内，自身不入栈
  session.commitNodeTransform('actor', 0, { position: [3, 0, 0] })
  session.endInteraction('提交变换')

  assert.equal(history.undoStack.length, 1)
  const docAfter = JSON.stringify(doc)
  const ukAfter = JSON.stringify(model.userKeys)
  // 拖拽不再写 fcurves；已有 userKey 时 commit 进 pending，键值来自 interaction 内的 upsert
  assert.equal(model.fcurves, null)
  assert.deepEqual(model.userKeys.actor?.position?.map((k) => k.value), [[3, 0, 0]])
  assert.deepEqual(session.pendingKeyframe?.position, [3, 0, 0])

  session.undo()
  assert.equal(JSON.stringify(doc), docBefore)
  assert.equal(JSON.stringify(model.userKeys), '{}')
  assert.equal(model.fcurves, null)

  session.redo()
  assert.equal(JSON.stringify(doc), docAfter)
  assert.equal(JSON.stringify(model.userKeys), ukAfter)
  assert.equal(model.fcurves, null)
})

test('两次独立拖拽 = 两条历史（拖拽命令不带 mergeKey，互不合并）', () => {
  const { session, history } = fixture()
  session.beginInteraction()
  session.upsertKeyframeAtFrame('actor', 'position', [1, 0, 0])
  session.commitNodeTransform('actor', 0, { position: [1, 0, 0] })
  session.endInteraction('提交变换')
  session.beginInteraction()
  session.upsertKeyframeAtFrame('actor', 'position', [5, 0, 0])
  session.commitNodeTransform('actor', 0, { position: [5, 0, 0] })
  session.endInteraction('提交变换')
  assert.equal(history.undoStack.length, 2)
})

test('关键帧连续拖动按 mergeKey 合并为一条，undo 回到最初帧；不同关键帧不合并', () => {
  const { session, model, history } = fixture()
  session.addKeyframe('actor', 'position', [0, 0, 0])
  const keyId = model.userKeys.actor.position![0].id
  assert.equal(history.undoStack.length, 1)

  session.moveKeyframe('actor', 'position', keyId, 10)
  session.moveKeyframe('actor', 'position', keyId, 20)
  session.moveKeyframe('actor', 'position', keyId, 30)
  assert.equal(history.undoStack.length, 2)
  assert.equal(model.userKeys.actor.position![0].frame, 30)

  session.undo()
  assert.equal(model.userKeys.actor.position![0].frame, 0)
  session.redo()
  assert.equal(model.userKeys.actor.position![0].frame, 30)

  // 另一个关键帧：mergeKey 不同，新开一条历史
  session.addKeyframe('actor', 'rotation', [0, 90, 0])
  const rotKeyId = model.userKeys.actor.rotation![0].id
  const depth = history.undoStack.length
  session.moveKeyframe('actor', 'rotation', rotKeyId, 15)
  assert.equal(history.undoStack.length, depth + 1)
})

test('面板连续改变换（writeNodeTransform）按 transform:<nodeId> 合并，undo 一次回到最初；不同节点不合并', () => {
  const { session, doc, model, history } = fixture()
  const fcBefore = model.fcurves
  session.writeNodeTransform('actor', { position: { x: 1, y: 0, z: 0 } })
  session.writeNodeTransform('actor', { position: { x: 2, y: 0, z: 0 } })
  session.writeNodeTransform('actor', { position: { x: 3, y: 0, z: 0 } })
  assert.equal(history.undoStack.length, 1)

  session.undo()
  assert.equal(doc.content.nodes.find((n) => n.id === 'actor')!.transform.position.x, 0)
  assert.equal(model.fcurves, fcBefore)
  session.redo()
  assert.equal(doc.content.nodes.find((n) => n.id === 'actor')!.transform.position.x, 3)

  doc.content.nodes.push(charNode('actor2'))
  session.writeNodeTransform('actor2', { position: { x: 9, y: 0, z: 0 } })
  assert.equal(history.undoStack.length, 2)
})
