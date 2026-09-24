import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument, DraftNode } from '../../contract/types'
import { makeKeyframe } from '../../evaluate/curves/KeyframeTrack'
import { EditorStore } from '../../stores/EditorStore'
import { StudioSession } from '../../sync/StudioSession'
import { DirectorDoc } from '../../document/DirectorDoc'
import { History } from '../../document/History'
import type { DirectorEngine } from '../../engine/DirectorEngine'
import type { HostAdapter } from '../../host/types'

function actor(id = 'actor', name = '角色'): DraftNode {
  return {
    id,
    type: 'character',
    name,
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
  const doc = makeEmptyDraft('pending-kf-test', 30, 120)
  doc.content.nodes.push(actor(), actor('box', '立方体'), camNode())
  model.replace(doc)
  const editor = new EditorStore('pending-kf-test')
  editor.autoKeyframe = false
  const history = new History()
  const engineState = { currentFrame: 12 }
  const staged = new Map<string, { position?: { x: number; y: number; z: number } }>()
  const engine = {
    get currentFrame() { return engineState.currentFrame },
    set currentFrame(frame: number) { engineState.currentFrame = frame },
    seek(frame: number) {
      engineState.currentFrame = frame
    },
    setFcurves() {},
    syncPathNodes() {},
    syncCameraMotionGuide() {},
    applyLiveNodeTransform() {},
    applyLiveCameraPose() {},
    applyLiveCameraFov() {},
    setStagedTransform(nodeId: string, patch: { position?: { x: number; y: number; z: number } }) {
      staged.set(nodeId, { ...staged.get(nodeId), ...patch })
    },
    clearStagedTransforms(nodeId?: string) {
      if (nodeId) staged.delete(nodeId)
      else staged.clear()
    },
    hasStagedTransform(nodeId: string) {
      return staged.has(nodeId)
    },
    getNodeSnapshot() {
      return null
    },
  } as unknown as DirectorEngine
  const session = new StudioSession(
    engine,
    model,
    editor,
    history,
    {} as HostAdapter<DirectorDocument>,
  )
  return { model, doc, editor, engine, session, staged }
}

test('保存 pending：当前播放头出现键，覆盖已有同帧键', () => {
  const { session, model } = fixture()
  model.setUserKeys({ actor: { position: [makeKeyframe(0, [0, 0, 0])] } })
  session.writeNodeTransform('actor', { position: { x: 4, y: 0, z: 1 } })
  assert.deepEqual(model.userKeys.actor?.position?.[0].value, [0, 0, 0])
  assert.deepEqual(session.pendingKeyframe?.position, [4, 0, 1])
  assert.equal(session.pendingKeyframe?.frame, 12)

  session.commitPendingKeyframe()
  const track = model.userKeys.actor?.position ?? []
  assert.equal(session.pendingKeyframe, null)
  assert.equal(track.length, 2)
  assert.deepEqual(track.find((k) => k.frame === 12)?.value, [4, 0, 1])
  assert.deepEqual(track.find((k) => k.frame === 0)?.value, [0, 0, 0])
})

test('取消 pending：键值与静态 transform 不变，并清掉 staged', () => {
  const { session, model, doc, engine, staged } = fixture()
  model.setUserKeys({ actor: { position: [makeKeyframe(0, [2, 0, 0])] } })
  const ukBefore = JSON.stringify(model.userKeys)
  session.writeNodeTransform('actor', { position: { x: 9, y: 0, z: 0 } })
  assert.ok(session.pendingKeyframe)
  assert.equal(staged.has('actor'), true)
  session.cancelPendingKeyframe()
  assert.equal(session.pendingKeyframe, null)
  assert.equal(staged.has('actor'), false)
  assert.equal(JSON.stringify(model.userKeys), ukBefore)
  assert.equal(doc.content.nodes.find((n) => n.id === 'actor')!.transform.position.x, 0)
  assert.equal(engine.currentFrame, 12)
})

test('pending 时 scrub/播放会取消候选并继续', () => {
  const { session, model, engine } = fixture()
  model.setUserKeys({ actor: { position: [makeKeyframe(0, [0, 0, 0])] } })
  session.writeNodeTransform('actor', { position: { x: 4, y: 0, z: 1 } })
  assert.ok(session.pendingKeyframe)
  session.setFrame(40)
  assert.equal(engine.currentFrame, 40)
  assert.equal(session.pendingKeyframe, null)
  session.writeNodeTransform('actor', { position: { x: 5, y: 0, z: 1 } })
  assert.ok(session.pendingKeyframe)
  session.togglePlay()
  assert.equal(session.pendingKeyframe, null)
  session.writeNodeTransform('actor', { position: { x: 6, y: 0, z: 1 } })
  assert.ok(session.pendingKeyframe)
  session.stepFrame(1)
  assert.equal(engine.currentFrame, 41)
  assert.equal(session.pendingKeyframe, null)
})

test('pending 时添加关键帧等同于保存，忽略传入值', () => {
  const { session, model } = fixture()
  model.setUserKeys({ actor: { position: [makeKeyframe(0, [0, 0, 0])] } })
  session.writeNodeTransform('actor', { position: { x: 4, y: 0, z: 1 } })
  assert.ok(session.pendingKeyframe)

  session.addKeyframes('actor', [{ prop: 'position', value: [99, 0, 0] }])
  const track = model.userKeys.actor?.position ?? []
  assert.equal(session.pendingKeyframe, null)
  assert.deepEqual(track.find((k) => k.frame === 12)?.value, [4, 0, 1])
  assert.equal(track.find((k) => k.frame === 12 && k.value[0] === 99), undefined)
})

test('无用户变换键时仍立刻写静态，不进 pending', () => {
  const { session, model, doc } = fixture()
  session.writeNodeTransform('actor', { position: { x: 3, y: 0, z: 0 } })
  assert.equal(session.pendingKeyframe, null)
  assert.equal(model.userKeys.actor, undefined)
  assert.equal(doc.content.nodes.find((n) => n.id === 'actor')!.transform.position.x, 3)
})

test('有键物体 pending 时写入 staged，未键物体落盘不会清掉', () => {
  const { session, model, doc, staged } = fixture()
  model.setUserKeys({ actor: { position: [makeKeyframe(0, [0, 0, 0])] } })
  session.commitNodeTransform('actor', 12, { position: [4, 0, 1] })
  assert.deepEqual(session.pendingKeyframe?.position, [4, 0, 1])
  assert.deepEqual(staged.get('actor')?.position, { x: 4, y: 0, z: 1 })
  assert.deepEqual(model.userKeys.actor?.position?.[0].value, [0, 0, 0])

  session.commitNodeTransform('box', 12, { position: [1, 0, 2] })
  assert.equal(doc.content.nodes.find((n) => n.id === 'box')!.transform.position.x, 1)
  assert.deepEqual(session.pendingKeyframe?.position, [4, 0, 1])
  assert.deepEqual(staged.get('actor')?.position, { x: 4, y: 0, z: 1 })
  assert.deepEqual(model.userKeys.actor?.position?.[0].value, [0, 0, 0])
  assert.equal(staged.has('box'), false)
})

test('机位 pending 保存后当前帧写出 position 键', () => {
  const { session, model, doc } = fixture()
  model.setUserKeys({ cam: { position: [makeKeyframe(0, [0, 1.6, 4])] } })
  session.writeCameraWorldPos('cam', { x: 8, y: 1.6, z: 4 }, true)
  assert.equal(doc.content.nodes.find((n) => n.id === 'cam')!.transform.position.x, 0)
  assert.deepEqual(model.userKeys.cam?.position?.[0].value, [0, 1.6, 4])
  session.commitPendingKeyframe()
  assert.equal(session.pendingKeyframe, null)
  assert.deepEqual(model.userKeys.cam?.position?.find((k) => k.frame === 12)?.value, [8, 1.6, 4])
})

