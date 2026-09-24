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

function fixture(autoKeyframe = true) {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('auto-key-test', 30, 120)
  doc.content.nodes.push(actor(), camNode())
  model.replace(doc)
  const editor = new EditorStore('auto-key-test')
  editor.autoKeyframe = autoKeyframe
  const history = new History()
  const engineState = { currentFrame: 12 }
  let liveSnap: {
    position: number[]
    rotation: number[]
    scale: number[]
    lookAt?: number[]
    fov?: number
  } | null = null
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
    clearStagedTransforms() {},
    getNodeSnapshot() {
      return liveSnap
    },
  } as unknown as DirectorEngine
  const session = new StudioSession(
    engine,
    model,
    editor,
    history,
    {} as HostAdapter<DirectorDocument>,
  )
  return {
    model,
    doc,
    editor,
    session,
    setLiveSnap(next: typeof liveSnap) {
      liveSnap = next
    },
  }
}

test('自动关键帧默认关闭', () => {
  assert.equal(new EditorStore('x').autoKeyframe, false)
})

test('开启时改位移立刻在当前帧打 position 键，不进 pending，静态不变', () => {
  const { session, model, doc } = fixture(true)
  session.writeNodeTransform('actor', { position: { x: 4, y: 0, z: 1 } })
  assert.equal(session.pendingKeyframe, null)
  const track = model.userKeys.actor?.position ?? []
  assert.equal(track.length, 1)
  assert.equal(track[0].frame, 12)
  assert.deepEqual(track[0].value, [4, 0, 1])
  assert.equal(model.userKeys.actor?.rotation, undefined)
  assert.equal(doc.content.nodes.find((n) => n.id === 'actor')!.transform.position.x, 0)
})

test('开启时属性没变不打键', () => {
  const { session, model } = fixture(true)
  session.writeNodeTransform('actor', { position: { x: 0, y: 0, z: 0 } })
  assert.equal(model.userKeys.actor, undefined)
  assert.equal(session.pendingKeyframe, null)
})

test('关闭时无键仍写静态，不打关键帧', () => {
  const { session, model, doc } = fixture(false)
  session.writeNodeTransform('actor', { position: { x: 3, y: 0, z: 0 } })
  assert.equal(model.userKeys.actor, undefined)
  assert.equal(doc.content.nodes.find((n) => n.id === 'actor')!.transform.position.x, 3)
})

test('live 快照已是新值时仍按文档基准打键（gizmo 松手）', () => {
  const { session, model, setLiveSnap } = fixture(true)
  setLiveSnap({
    position: [4, 0, 1],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  })
  session.commitNodeTransforms(12, [{ nodeId: 'actor', position: [4, 0, 1] }])
  const track = model.userKeys.actor?.position ?? []
  assert.equal(track.length, 1)
  assert.equal(track[0].frame, 12)
  assert.deepEqual(track[0].value, [4, 0, 1])
})

test('挪到另一帧再改，只要和该帧文档值不同就再打一键', () => {
  const { session, model, setLiveSnap } = fixture(true)
  session.writeNodeTransform('actor', { position: { x: 4, y: 0, z: 1 } })
  session.setFrame(40)
  setLiveSnap({
    position: [1, 0, 2],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  })
  session.commitNodeTransforms(40, [{ nodeId: 'actor', position: [1, 0, 2] }])
  const track = model.userKeys.actor?.position ?? []
  assert.equal(track.length, 2)
  assert.deepEqual(track.find((k) => k.frame === 12)?.value, [4, 0, 1])
  assert.deepEqual(track.find((k) => k.frame === 40)?.value, [1, 0, 2])
})

test('开启时已有键也不进 pending，直接写当前帧', () => {
  const { session, model } = fixture(true)
  model.setUserKeys({ actor: { position: [makeKeyframe(0, [0, 0, 0])] } })
  session.writeNodeTransform('actor', { position: { x: 4, y: 0, z: 1 } })
  assert.equal(session.pendingKeyframe, null)
  const track = model.userKeys.actor?.position ?? []
  assert.equal(track.length, 2)
  assert.deepEqual(track.find((k) => k.frame === 0)?.value, [0, 0, 0])
  assert.deepEqual(track.find((k) => k.frame === 12)?.value, [4, 0, 1])
})

test('运镜接管的机位即使开启自动关键帧也不写 userKeys', () => {
  const { session, model, doc } = fixture(true)
  doc.content.timeline.animation.cameraMotionClips.push({
    id: 'orbit',
    target: { type: 'camera', nodeId: 'cam' },
    frameStart: 0,
    frameEnd: 60,
    trimStartMs: 0,
    trimEndMs: 2000,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: 60 },
    motion: {
      id: 'orbit_180',
      version: 1,
      presetId: 'orbit_180',
      label: '环绕',
      timeUnit: 'ms',
      durationMs: 2000,
      curves: [],
    },
  })
  session.writeCameraWorldPos('cam', { x: 2, y: 1.6, z: 4 }, true)
  assert.equal(model.userKeys.cam, undefined)
})

test('开启时改机位 FOV 立刻打 fov 键，已有键也不进 pending', () => {
  const { session, model, doc } = fixture(true)
  model.setUserKeys({ cam: { fov: [makeKeyframe(0, [50])] } })
  session.setCameraFov(24, 'cam')
  assert.equal(session.pendingKeyframe, null)
  const track = model.userKeys.cam?.fov ?? []
  assert.equal(track.length, 2)
  assert.deepEqual(track.find((k) => k.frame === 0)?.value, [50])
  assert.deepEqual(track.find((k) => k.frame === 12)?.value, [24])
  assert.equal(doc.content.nodes.find((n) => n.id === 'cam')!.camera!.fov, 50)
})

test('多选打关键帧：每个节点按类型写通道，一次 undo 全撤销', () => {
  const { session, model } = fixture(false)
  session.addTransformKeyframes(['actor', 'cam'])
  const actorKeys = model.userKeys.actor!
  assert.deepEqual(actorKeys.position!.map((k) => k.frame), [12])
  assert.deepEqual(actorKeys.rotation!.map((k) => k.frame), [12])
  assert.deepEqual(actorKeys.scale!.map((k) => k.frame), [12])
  const camKeys = model.userKeys.cam!
  assert.deepEqual(camKeys.position!.map((k) => k.frame), [12])
  assert.deepEqual(camKeys.lookAt!.map((k) => k.frame), [12])
  assert.deepEqual(camKeys.fov![0].value, [50])
  // 相机没有缩放轨
  assert.equal(camKeys.scale, undefined)
  session.undo()
  assert.equal(model.userKeys.actor, undefined)
  assert.equal(model.userKeys.cam, undefined)
})

test('多选打关键帧跳过锁定节点', () => {
  const { session, model, doc } = fixture(false)
  doc.content.nodes.find((n) => n.id === 'cam')!.locked = true
  session.addTransformKeyframes(['actor', 'cam'])
  assert.ok(model.userKeys.actor?.position?.length)
  assert.equal(model.userKeys.cam, undefined)
})

test('多选打关键帧沿用 live 快照的值', () => {
  const { session, model, setLiveSnap } = fixture(false)
  setLiveSnap({ position: [5, 0, 2], rotation: [0, 90, 0], scale: [2, 2, 2] })
  session.addTransformKeyframes(['actor'])
  assert.deepEqual(model.userKeys.actor!.position![0].value, [5, 0, 2])
  assert.deepEqual(model.userKeys.actor!.rotation![0].value, [0, 90, 0])
  assert.deepEqual(model.userKeys.actor!.scale![0].value, [2, 2, 2])
})

test('toggleAutoKeyframe 切换开关', () => {
  const { session, editor } = fixture(true)
  assert.equal(session.autoKeyframe, true)
  session.toggleAutoKeyframe()
  assert.equal(editor.autoKeyframe, false)
  session.toggleAutoKeyframe()
  assert.equal(editor.autoKeyframe, true)
})

test('commitNodeTransforms 在自动关键帧开启时，多选对象批量同步生成关键帧并支持一键撤销', () => {
  const { session, model, doc } = fixture(true)
  const propNode: DraftNode = {
    id: 'prop_1',
    type: 'prop',
    name: '道具',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }
  doc.content.nodes.push(propNode)

  session.commitNodeTransforms(12, [
    { nodeId: 'actor', position: [2, 0, 1] },
    { nodeId: 'prop_1', position: [5, 1, 0] },
  ])

  assert.deepEqual(model.userKeys.actor?.position?.[0]?.value, [2, 0, 1])
  assert.equal(model.userKeys.actor?.position?.[0]?.frame, 12)
  assert.deepEqual(model.userKeys.prop_1?.position?.[0]?.value, [5, 1, 0])
  assert.equal(model.userKeys.prop_1?.position?.[0]?.frame, 12)

  // 一键 undo 撤销整批多选自动打帧
  session.undo()
  assert.equal(model.userKeys.actor, undefined)
  assert.equal(model.userKeys.prop_1, undefined)
})

test('addTransformKeyframes 在包含 pendingKeyframe 时为所有选中对象同步打帧', () => {
  const { session, model, doc, editor } = fixture(false)
  const propNode: DraftNode = {
    id: 'prop_1',
    type: 'prop',
    name: '道具',
    visible: true,
    locked: false,
    transform: {
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }
  doc.content.nodes.push(propNode)

  // 给 actor 塞一个 pending 键
  editor.mergePendingKeyframe({
    nodeId: 'actor',
    frame: 12,
    position: [9, 0, 0],
  })
  assert.equal(editor.pendingKeyframes.length, 1)

  // 批量打帧：actor 和 prop_1
  session.addTransformKeyframes(['actor', 'prop_1'])
  assert.equal(editor.pendingKeyframes.length, 0)
  assert.deepEqual(model.userKeys.actor?.position?.[0]?.value, [9, 0, 0])
  assert.deepEqual(model.userKeys.prop_1?.position?.[0]?.value, [1, 2, 3])
  assert.equal(model.userKeys.prop_1?.position?.[0]?.frame, 12)
})
