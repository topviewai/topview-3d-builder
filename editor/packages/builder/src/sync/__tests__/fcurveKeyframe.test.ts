import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument, DraftNode } from '../../contract/types'
import { FCurveSet } from '../../evaluate/curves/FCurveSet'
import { makeKeyframe } from '../../evaluate/curves/KeyframeTrack'
import { rederiveWalkPaths } from '../../evaluate/path/deriveWalk'
import { EditorStore } from '../../stores/EditorStore'
import { StudioSession } from '../../sync/StudioSession'
import { DirectorDoc } from '../../document/DirectorDoc'
import { History } from '../../document/History'
import type { DirectorEngine } from '../../engine/DirectorEngine'
import type { HostAdapter } from '../../host/types'

function actor(): DraftNode {
  return {
    id: 'actor',
    type: 'character',
    name: '角色',
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

function session() {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('fc-key-test', 30, 120)
  doc.content.nodes.push(actor())
  model.replace(doc)
  const editor = new EditorStore('fc-key-test')
  editor.autoKeyframe = false
  const history = new History()
  const engineState = { currentFrame: 0 }
  const engine = {
    get currentFrame() { return engineState.currentFrame },
    set currentFrame(frame: number) { engineState.currentFrame = frame },
    setFcurves: () => undefined,
    syncPathNodes: () => undefined,
    setPoseEditingId: () => undefined,
    syncGizmo: () => undefined,
    syncPathSelection: () => undefined,
    syncCameraMotionGuide: () => undefined,
    applyLiveNodeTransform() {},
    seek(frame: number) {
      engineState.currentFrame = frame
    },
    setStagedTransform: () => undefined,
    clearStagedTransforms: () => undefined,
    hasStagedTransform: () => false,
    getNodeSnapshot: () => null,
  } as unknown as DirectorEngine
  const adapter = {
    resolveMediaUrl: () => 'https://example.com/x.fbx',
  } as unknown as HostAdapter<DirectorDocument>
  return {
    doc,
    editor,
    history,
    session: new StudioSession(engine, model, editor, history, adapter),
    model,
  }
}

function seedPositionKeys(fc: FCurveSet, frames: number[]): void {
  for (const f of frames) {
    for (let i = 0; i < 3; i++) fc.upsertKey('actor', 'transform.position', i, f, f * 10 + i)
  }
}

test('removeKeysAtFrame：所有分量同帧一起删，其余帧不动', () => {
  const fc = FCurveSet.empty()
  seedPositionKeys(fc, [0, 20, 40])
  const removed = fc.removeKeysAtFrame('actor', 'transform.position', 20)
  assert.equal(removed, 3)
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(
      fc.keyframesForTrack('actor', 'transform.position', i).map((k) => k.frame),
      [0, 40],
    )
  }
  // 不存在的帧 / 不存在的节点
  assert.equal(fc.removeKeysAtFrame('actor', 'transform.position', 21), 0)
  assert.equal(fc.removeKeysAtFrame('nobody', 'transform.position', 0), 0)
})

test('removeKeysAtFrame：删空后曲线与节点壳一并清理', () => {
  const fc = FCurveSet.empty()
  seedPositionKeys(fc, [10])
  const before = fc.curveCount
  assert.equal(fc.removeKeysAtFrame('actor', 'transform.position', 10), 3)
  assert.equal(fc.hasTrack('actor', 'transform.position'), false)
  assert.equal(fc.tracksForNode('actor').length, 0)
  assert.equal(fc.curveCount, before - 3)
  // 落盘不留空壳
  assert.equal(fc.encode().fcurves.length, 0)
})

test('removeFcurveKeyframe：删除后可 undo 恢复', () => {
  const { session: s, model } = session()
  const fc = FCurveSet.empty()
  seedPositionKeys(fc, [0, 20, 40])
  model.setFcurves(fc)

  s.removeFcurveKeyframe('actor', 'transform.position', 20)
  assert.deepEqual(
    model.fcurves?.keyframesForTrack('actor', 'transform.position', 0).map((k) => k.frame),
    [0, 40],
  )

  s.undo()
  assert.deepEqual(
    model.fcurves?.keyframesForTrack('actor', 'transform.position', 0).map((k) => k.frame),
    [0, 20, 40],
  )

  s.redo()
  assert.deepEqual(
    model.fcurves?.keyframesForTrack('actor', 'transform.position', 0).map((k) => k.frame),
    [0, 40],
  )
})

test('removeFcurveKeyframe：目标帧没有键时不产生历史记录', () => {
  const { session: s, model } = session()
  const fc = FCurveSet.empty()
  seedPositionKeys(fc, [0])
  model.setFcurves(fc)
  s.removeFcurveKeyframe('actor', 'transform.position', 99)
  assert.equal(s.canUndo, false)
})

test('removeTransformKeysAtFrame：三个子轨道两层（userKeys+fcurves）同帧一起删，可 undo', () => {
  const { session: s, model } = session()
  const fc = FCurveSet.empty()
  seedPositionKeys(fc, [10, 20])
  for (let i = 0; i < 3; i++) fc.upsertKey('actor', 'transform.rotation', i, 10, i)
  model.setFcurves(fc)
  model.setUserKeys({ actor: { position: [makeKeyframe(10, [1, 2, 3])], scale: [makeKeyframe(10, [1, 1, 1])] } })

  s.removeTransformKeysAtFrame('actor', 10)
  // userKeys：position/scale 轨道在帧 10 的键没了
  assert.deepEqual(model.userKeys.actor?.position ?? [], [])
  assert.deepEqual(model.userKeys.actor?.scale ?? [], [])
  // fcurves：position 剩帧 20，rotation 清空（曲线壳也清掉）
  assert.deepEqual(
    model.fcurves?.keyframesForTrack('actor', 'transform.position', 0).map((k) => k.frame),
    [20],
  )
  assert.equal(model.fcurves?.hasTrack('actor', 'transform.rotation'), false)

  s.undo()
  assert.equal(model.userKeys.actor?.position?.length, 1)
  assert.equal(model.userKeys.actor?.scale?.length, 1)
  assert.deepEqual(
    model.fcurves?.keyframesForTrack('actor', 'transform.position', 0).map((k) => k.frame),
    [10, 20],
  )
  assert.equal(model.fcurves?.hasTrack('actor', 'transform.rotation'), true)
})

test('removeTransformKeysAtFrame：删位移键后对应的派生走位 clip/path 被清理', () => {
  const { session: s, model, doc } = session()
  const fc = FCurveSet.empty()
  seedPositionKeys(fc, [10, 20])
  // 拉开距离，保证采样折线长 > 1e-4，段能生成
  for (let i = 0; i < 3; i++) fc.upsertKey('actor', 'transform.position', 0, 20, 5)
  model.setFcurves(fc)
  rederiveWalkPaths(doc, 'actor', fc)
  const derivedBefore = doc.content.timeline.animation.pathMotionClips.filter(
    (c) => c.lockedReason === 'derived-from-keyframes',
  )
  assert.equal(derivedBefore.length, 1)

  s.removeTransformKeysAtFrame('actor', 20)
  const derivedAfter = doc.content.timeline.animation.pathMotionClips.filter(
    (c) => c.lockedReason === 'derived-from-keyframes',
  )
  assert.equal(derivedAfter.length, 0)
  assert.equal(
    doc.content.nodes.some((n) => n.id.startsWith('path_derived_')),
    false,
  )

  s.undo()
  const derivedRestored = doc.content.timeline.animation.pathMotionClips.filter(
    (c) => c.lockedReason === 'derived-from-keyframes',
  )
  assert.equal(derivedRestored.length, 1)
})

test('removeTransformKeysAtFrame：该帧没有任何键时不产生历史记录', () => {
  const { session: s } = session()
  s.removeTransformKeysAtFrame('actor', 42)
  assert.equal(s.canUndo, false)
})

test('拖拽提交不再自动打关键帧：无键节点只写静态 transform，undo 恢复', () => {
  const { session: s, model, doc } = session()
  s.commitNodeTransform('actor', 10, { position: [3, 0, 0] })
  // 不产生任何关键帧（userKeys / fcurves 都为空）
  assert.equal(model.userKeys.actor, undefined)
  assert.equal(model.fcurves, null)
  // 只写静态 transform
  assert.equal(doc.content.nodes.find((n) => n.id === 'actor')!.transform.position.x, 3)
  assert.equal(s.canUndo, true)
  s.undo()
  assert.equal(doc.content.nodes.find((n) => n.id === 'actor')!.transform.position.x, 0)
})

test('拖拽提交：当前帧已有 userKey 时进入 pending，不改文档', () => {
  const { session: s, model, doc, editor } = session()
  model.setUserKeys({ actor: { position: [makeKeyframe(10, [0, 0, 0])] } })
  s.commitNodeTransform('actor', 10, { position: [5, 0, 0] })
  const track = model.userKeys.actor?.position ?? []
  assert.equal(track.length, 1)
  assert.equal(track[0].frame, 10)
  assert.deepEqual(track[0].value, [0, 0, 0])
  assert.equal(doc.content.nodes.find((n) => n.id === 'actor')!.transform.position.x, 0)
  assert.equal(model.fcurves, null)
  assert.deepEqual(s.pendingKeyframe?.position, [5, 0, 0])
  assert.equal(editor.pendingKeyframes.length, 1)
})

test('用户关键帧驱动派生轨迹：两帧打键生成派生 clip/path，删到不足两键清理，undo 恢复', () => {
  const { session: s, model, doc } = session()
  const derived = () =>
    doc.content.timeline.animation.pathMotionClips.filter(
      (c) => c.lockedReason === 'derived-from-keyframes',
    )
  s.addKeyframe('actor', 'position', [0, 0, 0]) // currentFrame = 0
  assert.equal(derived().length, 0) // 单键不产生轨迹
  ;(s.engine as unknown as { currentFrame: number }).currentFrame = 40
  s.addKeyframe('actor', 'position', [10, 0, 0])
  assert.equal(derived().length, 1)
  assert.equal(derived()[0].frameStart, 0)
  assert.equal(derived()[0].frameEnd, 40)
  assert.equal(doc.content.nodes.some((n) => n.id.startsWith('path_derived_')), true)

  // 删掉 40 帧的键 → 不足两键，派生轨迹整体清理
  const keyId = model.userKeys.actor!.position!.find((k) => k.frame === 40)!.id
  s.removeKeyframe('actor', 'position', keyId)
  assert.equal(derived().length, 0)
  assert.equal(doc.content.nodes.some((n) => n.id.startsWith('path_derived_')), false)

  s.undo()
  assert.equal(derived().length, 1)
  assert.equal(doc.content.nodes.some((n) => n.id.startsWith('path_derived_')), true)
})

test('删除关键帧后节点落座到剩余最早键的位置（回到开始位置），可 undo', () => {
  const { session: s, model, doc } = session()
  const base = () => doc.content.nodes.find((n) => n.id === 'actor')!.transform.position
  s.addKeyframe('actor', 'position', [0, 0, 0]) // frame 0（起点 A）
  ;(s.engine as unknown as { currentFrame: number }).currentFrame = 40
  // 已有变换键：拖拽进 pending，保存后才在当前帧打终点键
  s.commitNodeTransform('actor', 40, { position: [10, 0, 0] })
  assert.equal(base().x, 0)
  assert.deepEqual(s.pendingKeyframe?.position, [10, 0, 0])
  s.commitPendingKeyframe()
  assert.deepEqual(model.userKeys.actor?.position?.find((k) => k.frame === 40)?.value, [10, 0, 0])

  // 删掉 40 帧的键 → 落座到剩余最早键（帧 0，x=0），人物回到开始位置
  const keyId = model.userKeys.actor!.position!.find((k) => k.frame === 40)!.id
  s.removeKeyframe('actor', 'position', keyId)
  assert.equal(base().x, 0)

  // 再删掉帧 0 的键 → 删光，落座到被删前最早键（仍为 x=0）
  const keyId0 = model.userKeys.actor!.position!.find((k) => k.frame === 0)!.id
  s.removeKeyframe('actor', 'position', keyId0)
  assert.equal(base().x, 0)
  assert.deepEqual(model.userKeys.actor?.position ?? [], [])

  // undo 两步：键与 base 一起按三合一快照恢复
  s.undo()
  assert.equal(model.userKeys.actor?.position?.length, 1)
  s.undo()
  assert.equal(model.userKeys.actor?.position?.length, 2)
  assert.equal(base().x, 0)
})

test('removeTransformKeysAtFrame 删组合键同样触发落座', () => {
  const { session: s, model, doc } = session()
  const base = () => doc.content.nodes.find((n) => n.id === 'actor')!.transform.position
  model.setUserKeys({
    actor: {
      position: [makeKeyframe(0, [2, 0, 0]), makeKeyframe(40, [8, 0, 0])],
    },
  })
  doc.content.nodes.find((n) => n.id === 'actor')!.transform.position = { x: 8, y: 0, z: 0 }
  s.removeTransformKeysAtFrame('actor', 40)
  assert.equal(base().x, 2)
  s.undo()
  assert.equal(base().x, 8)
})

test('setTransformKeysInterpAtFrame：组合关键帧统一设置各通道插值，且可 undo', () => {
  const { session: s, model } = session()
  model.setUserKeys({
    actor: {
      position: [makeKeyframe(10, [1, 2, 3])],
      rotation: [makeKeyframe(10, [0, 0, 0])],
      scale: [makeKeyframe(10, [1, 1, 1])],
    },
  })
  s.setTransformKeysInterpAtFrame('actor', 10, 'ease-in')
  assert.equal(model.userKeys.actor?.position?.[0]?.interpolation, 'ease-in')
  assert.equal(model.userKeys.actor?.rotation?.[0]?.interpolation, 'ease-in')
  assert.equal(model.userKeys.actor?.scale?.[0]?.interpolation, 'ease-in')

  s.undo()
  assert.equal(model.userKeys.actor?.position?.[0]?.interpolation, 'linear')
  assert.equal(model.userKeys.actor?.rotation?.[0]?.interpolation, 'linear')
  assert.equal(model.userKeys.actor?.scale?.[0]?.interpolation, 'linear')
})

test('moveKeyframes 移动组合关键帧时自动更新当前 transformKeyframe 选中态', () => {
  const { session: s, model } = session()
  const kfPos = makeKeyframe(10, [1, 2, 3])
  const kfRot = makeKeyframe(10, [0, 0, 0])
  model.setUserKeys({
    actor: {
      position: [kfPos],
      rotation: [kfRot],
    },
  })
  s.editor.select({ kind: 'transformKeyframe', nodeId: 'actor', frame: 10 })

  s.moveKeyframes([
    { nodeId: 'actor', prop: 'position', keyId: kfPos.id, newFrame: 25 },
    { nodeId: 'actor', prop: 'rotation', keyId: kfRot.id, newFrame: 25 },
  ])
  assert.deepEqual(s.editor.selection, { kind: 'transformKeyframe', nodeId: 'actor', frame: 25 })
})

