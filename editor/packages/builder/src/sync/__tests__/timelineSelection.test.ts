import { clipRefsOf, makeClipSelection, nextClipSelection } from '../../stores/types'
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type {
  CameraMotionClip,
  DirectorDocument,
  DraftNode,
  MotionClip,
  PathMotionClip,
} from '../../contract/types'
import { makeKeyframe } from '../../evaluate/curves/KeyframeTrack'
import { framesToSeconds, remapFrame } from '../../evaluate/timecode'
import { EditorStore } from '../../stores/EditorStore'
import { StudioSession } from '../../sync/StudioSession'
import { DirectorDoc } from '../../document/DirectorDoc'
import { History } from '../../document/History'
import type { DirectorEngine } from '../../engine/DirectorEngine'
import type { HostAdapter } from '../../host/types'

function cameraMain(): DraftNode {
  return {
    id: 'camera_1',
    type: 'camera',
    name: 'Main Camera',
    visible: true,
    locked: false,
    transform: {
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 10, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    camera: {
      projection: 'perspective',
      fov: 50,
      fovAxis: 'vertical',
      near: 0.1,
      far: 2000,
      isPrimary: true,
      lookAt: { x: 0, y: 1, z: 0 },
    },
  }
}

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

function cameraCam(): DraftNode {
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
      fov: 35,
      fovAxis: 'vertical',
      near: 0.1,
      far: 2000,
      isPrimary: true,
      lookAt: { x: 0, y: 1, z: 0 },
    },
  }
}

function motionClip(id: string, nodeId = 'actor'): MotionClip {
  return {
    id,
    frameStart: 0,
    frameEnd: 30,
    target: { type: 'character', nodeId },
    source: 'test',
    sourceDuration: 1,
    playback: { version: 1, speed: 1, loop: true, loopMode: 'repeat' },
    motion: {
      assetId: id,
      name: id,
      source: 'test',
      sourceRig: 'mixamorig',
      url: '',
      inPlace: true,
      loop: true,
      speed: 1,
      time: 0,
    },
  }
}

function cameraClip(id: string, nodeId = 'cam'): CameraMotionClip {
  return {
    id,
    target: { type: 'camera', nodeId },
    frameStart: 0,
    frameEnd: 30,
    trimStartMs: 0,
    trimEndMs: 0,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'once', baseDurationFrames: 30 },
    motion: {
      id,
      version: 1,
      presetId: id,
      label: id,
      timeUnit: 'ms',
      durationMs: 1000,
      curves: [],
    },
  }
}

function pathClip(id: string, nodeId: string, targetType: 'character' | 'camera'): PathMotionClip {
  return {
    id,
    status: 'active',
    locked: false,
    source: 'test',
    target: { type: targetType, nodeId },
    pathNodeId: `path_${id}`,
    pathName: id,
    pathLength: 1,
    pathStartPercent: 0,
    pathEndPercent: 100,
    direction: 'forward',
    facing: 'path-tangent',
    frameStart: 0,
    frameEnd: 30,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'once', baseDurationFrames: 30 },
  }
}

function session() {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('sel-test', 30, 120)
  doc.content.nodes.push(actor(), cameraMain(), cameraCam())
  doc.content.timeline.animation.motionClips = [motionClip('idle')]
  doc.content.timeline.animation.cameraMotionClips = [cameraClip('orbit')]
  doc.content.timeline.animation.pathMotionClips = [
    pathClip('walk', 'actor', 'character'),
    pathClip('dolly', 'cam', 'camera'),
  ]
  model.replace(doc)
  const editor = new EditorStore('sel-test')
  editor.autoKeyframe = false
  const history = new History()
  const engineState = { currentFrame: 12 }
  const focused: string[] = []
  const engine = {
    get currentFrame() { return engineState.currentFrame },
    loadMotion: async () => 2,
    seek(frame: number) { engineState.currentFrame = frame },
    invalidate() {},
    setFcurves() {},
    applyLiveCameraPose() {},
    setStagedTransform() {},
    clearStagedTransforms() {},
    hasStagedTransform() { return false },
    worldAimPoint: () => ({ x: 0, y: 1.2, z: 0 }),
    getNodeSnapshot: () => ({
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      lookAt: [0, 1.2, 0],
    }),
    setPoseEditingId() {},
    focusNode(id: string) { focused.push(id) },
    syncGizmo() {},
    syncPathSelection() {},
    syncCameraMotionGuide() {},
    applyLiveNodeTransform() {},
    removeNode() {},
    syncPathNodes: () => undefined,
  } as unknown as DirectorEngine
  const adapter = {
    resolveMediaUrl: () => 'https://example.com/walk.fbx',
  } as unknown as HostAdapter<DirectorDocument>
  return {
    doc,
    editor,
    session: new StudioSession(engine, model, editor, history, adapter),
    model,
    history,
    engineState,
    focused,
  }
}

test('批量缓动一次修改选中通道，保留其他关键帧，且一次撤销完整恢复', () => {
  const { session: s, model, history } = session()
  const a = { ...makeKeyframe(10, [0, 1, 0]), interpolation: 'linear' as const }
  const b = { ...makeKeyframe(30, [0, 2, 0]), interpolation: 'ease-in' as const }
  const other = { ...makeKeyframe(50, [0, 3, 0]), interpolation: 'ease-out' as const }
  model.setUserKeys({ actor: { position: [a, other], rotation: [b] } })
  const before = JSON.stringify(model.userKeys)
  const refs = [
    { nodeId: 'actor', prop: 'position' as const, keyId: a.id },
    { nodeId: 'actor', prop: 'rotation' as const, keyId: b.id },
  ]
  s.setKeyframesInterp(refs, 'ease-in-out')
  assert.equal(model.userKeys.actor.position?.[0].interpolation, 'ease-in-out')
  assert.equal(model.userKeys.actor.rotation?.[0].interpolation, 'ease-in-out')
  assert.equal(model.userKeys.actor.position?.[1].interpolation, 'ease-out')
  assert.equal(history.undoStack.length, 1)
  s.setKeyframesInterp(refs, 'ease-in-out')
  assert.equal(history.undoStack.length, 1, 'unchanged easing does not add history')
  history.undo()
  assert.equal(JSON.stringify(model.userKeys), before)
  history.redo()
  assert.equal(model.userKeys.actor.rotation?.[0].interpolation, 'ease-in-out')
})

test('批量缓动忽略无效关键帧和运镜接管的机位', () => {
  const { session: s, model, history } = session()
  const a = { ...makeKeyframe(10, [0, 1, 0]), interpolation: 'linear' as const }
  const camera = { ...makeKeyframe(10, [0, 2, 0]), interpolation: 'linear' as const }
  model.setUserKeys({ actor: { position: [a] }, cam: { position: [camera] } })
  s.setKeyframesInterp([
    { nodeId: 'actor', prop: 'position', keyId: a.id },
    { nodeId: 'cam', prop: 'position', keyId: camera.id },
    { nodeId: 'missing', prop: 'position', keyId: 'missing' },
  ], 'ease-out')
  assert.equal(model.userKeys.actor.position?.[0].interpolation, 'ease-out')
  assert.equal(model.userKeys.cam.position?.[0].interpolation, 'linear')
  assert.equal(history.undoStack.length, 1)
})

test('删除关键帧后仍选中该节点，不把时间线选中清空', () => {
  const { editor, session: s, model } = session()
  const kf = makeKeyframe(10, [0, 1, 0])
  model.setUserKeys({ actor: { position: [kf] } })
  editor.select({ kind: 'keyframe', nodeId: 'actor', prop: 'position', keyId: kf.id })
  s.removeKeyframe('actor', 'position', kf.id)
  assert.deepEqual(editor.selection, { kind: 'node', nodeId: 'actor' })
  assert.equal((model.userKeys.actor?.position ?? []).length, 0)
})

test('关键帧拖到已占用的帧：无论方向都是被拖的键胜出', () => {
  for (const [fromFrame, toFrame] of [[2, 5], [7, 5]] as const) {
    const { session: s, model } = session()
    const moved = makeKeyframe(fromFrame, [9, 9, 9])
    const sitting = makeKeyframe(5, [1, 1, 1])
    model.setUserKeys({
      actor: { position: [moved, sitting].sort((a, b) => a.frame - b.frame) },
    })
    s.moveKeyframe('actor', 'position', moved.id, toFrame)
    const track = model.userKeys.actor?.position ?? []
    assert.equal(track.length, 1, `${fromFrame}→${toFrame} 应合并成一个键`)
    assert.equal(track[0].id, moved.id, `${fromFrame}→${toFrame} 应保留被拖的键`)
    assert.deepEqual(track[0].value, [9, 9, 9])
  }
})

test('批量移动只改传入的键，未列出的键帧号不变', () => {
  const { session: s, model } = session()
  const a = makeKeyframe(5, [1, 0, 0])
  const b = makeKeyframe(15, [2, 0, 0])
  const still = makeKeyframe(20, [3, 0, 0])
  const rot = makeKeyframe(8, [0, 10, 0])
  model.setUserKeys({
    actor: { position: [a, b, still], rotation: [rot] },
  })
  s.moveKeyframes([
    { nodeId: 'actor', prop: 'position', keyId: a.id, newFrame: 9 },
    { nodeId: 'actor', prop: 'position', keyId: b.id, newFrame: 19 },
    { nodeId: 'actor', prop: 'rotation', keyId: rot.id, newFrame: 12 },
  ])
  const pos = model.userKeys.actor?.position ?? []
  const r = model.userKeys.actor?.rotation ?? []
  assert.equal(pos.find((k) => k.id === a.id)?.frame, 9)
  assert.equal(pos.find((k) => k.id === b.id)?.frame, 19)
  assert.equal(pos.find((k) => k.id === still.id)?.frame, 20)
  assert.equal(r.find((k) => k.id === rot.id)?.frame, 12)
})

test('批量移动碰到时间轴起点时整体卡住，相对间距不变', () => {
  const { session: s, model } = session()
  const a = makeKeyframe(2, [1, 0, 0])
  const b = makeKeyframe(12, [2, 0, 0])
  model.setUserKeys({ actor: { position: [a, b] } })
  s.moveKeyframes([
    { nodeId: 'actor', prop: 'position', keyId: a.id, newFrame: -8 },
    { nodeId: 'actor', prop: 'position', keyId: b.id, newFrame: 2 },
  ])
  const pos = model.userKeys.actor?.position ?? []
  assert.equal(pos.find((k) => k.id === a.id)?.frame, 0)
  assert.equal(pos.find((k) => k.id === b.id)?.frame, 10)
})

test('被合并掉的关键帧不会留在选中态里', () => {
  const { editor, session: s, model } = session()
  const moved = makeKeyframe(2, [9, 9, 9])
  const sitting = makeKeyframe(5, [1, 1, 1])
  model.setUserKeys({ actor: { position: [moved, sitting] } })
  editor.select({ kind: 'keyframe', nodeId: 'actor', prop: 'position', keyId: sitting.id })
  s.moveKeyframe('actor', 'position', moved.id, 5)
  assert.deepEqual(editor.selection, { kind: 'node', nodeId: 'actor' })
})

test('选中人物动作 clip 时仍能添加 Motion', async () => {
  const { editor, session: s, doc } = session()
  editor.select({ kind: 'clip', clipType: 'motion', clipId: 'idle' })
  const err = await s.addMotionClipFromLibrary('walk.fbx', '走路')
  assert.equal(err, null)
  const added = doc.content.timeline.animation.motionClips.filter((c) => c.id !== 'idle')
  assert.equal(added.length, 1)
  assert.equal(added[0].target.nodeId, 'actor')
})

test('时间线改帧率锁定秒数，重算起止帧，片段帧范围不动', () => {
  const { session: s, doc } = session()
  const start = doc.content.timeline.frameStart
  const end = doc.content.timeline.frameEnd
  const startSec = framesToSeconds(start, 30)
  const endSec = framesToSeconds(end, 30)
  const clipEnd = doc.content.timeline.animation.motionClips[0].frameEnd
  assert.equal(doc.content.timeline.fps, 30)
  s.setTimelineFps(24)
  assert.equal(doc.content.timeline.fps, 24)
  assert.equal(doc.content.timeline.frameStart, remapFrame(start, 30, 24))
  assert.equal(doc.content.timeline.frameEnd, remapFrame(end, 30, 24))
  assert.equal(framesToSeconds(doc.content.timeline.frameStart, 24), startSec)
  assert.equal(framesToSeconds(doc.content.timeline.frameEnd, 24), endSec)
  assert.equal(doc.content.timeline.animation.motionClips[0].frameEnd, clipEnd)
  s.setTimelineFps(0)
  assert.equal(doc.content.timeline.fps, 20)
  assert.equal(framesToSeconds(doc.content.timeline.frameEnd, 20), endSec)
  s.setTimelineFps(240)
  assert.equal(doc.content.timeline.fps, 30)
  assert.equal(doc.content.timeline.frameEnd, end)
})

test('添加长动作不延长时间线，撤销重做保留独立结束帧', async () => {
  const { session: s, doc, editor, model } = session()
  doc.content.timeline.frameEnd = 20
  editor.select({ kind: 'node', nodeId: 'actor' })
  assert.equal(await s.addMotionClipFromLibrary('3d-builder/library/motions/a3d_motion_test-0000.fbx', 'Test motion'), null)
  assert.equal(doc.content.timeline.frameEnd, 20)
  assert.ok(doc.content.timeline.animation.motionClips.some((c) => c.frameEnd > 20))
  const clipsAfter = JSON.stringify(doc.content.timeline.animation.motionClips)
  s.undo()
  assert.equal(model.snapshot!.content.timeline.frameEnd, 20)
  s.redo()
  assert.equal(model.snapshot!.content.timeline.frameEnd, 20)
  assert.equal(JSON.stringify(model.snapshot!.content.timeline.animation.motionClips), clipsAfter)
})

test('结束帧可短于已有片段，缩短保留片段并支持撤销', () => {
  const { session: s, doc, model } = session()
  const clipsBefore = JSON.stringify(doc.content.timeline.animation)
  s.setTimelineRange(0, 600)
  assert.equal(doc.content.timeline.frameStart, 0)
  assert.equal(doc.content.timeline.frameEnd, 600)
  s.setTimelineRange(10, 20)
  assert.equal(doc.content.timeline.frameStart, 0)
  assert.equal(doc.content.timeline.frameEnd, 20)
  assert.equal(JSON.stringify(doc.content.timeline.animation), clipsBefore)
  s.undo()
  assert.equal(model.snapshot?.content.timeline.frameEnd, 600)
  s.redo()
  assert.equal(model.snapshot?.content.timeline.frameEnd, 20)
  assert.equal(JSON.stringify(model.snapshot?.content.timeline.animation), clipsBefore)
})

test('结束帧不受范围外关键帧约束，播放头回到范围内且关键帧保留', () => {
  const { session: s, doc, model, engineState } = session()
  const key = makeKeyframe(100, [1, 2, 3])
  model.setUserKeys({ actor: { position: [key] } })
  s.setFrame(100)
  s.setTimelineRange(0, 10)
  assert.equal(doc.content.timeline.frameEnd, 10)
  assert.equal(engineState.currentFrame, 10)
  assert.equal(model.userKeys.actor.position?.[0].frame, 100)
  s.setTimelineRange(0, 120)
  assert.equal(doc.content.timeline.frameEnd, 120)
  assert.equal(model.userKeys.actor.position?.[0].frame, 100)
})

test('框选/加选多物体后删除一次清掉全部', () => {
  const { editor, session: s, doc, history } = session()
  const other = actor()
  other.id = 'actor_2'
  other.name = '角色2'
  doc.content.nodes.push(other)
  editor.select({ kind: 'node', nodeId: 'actor_2', nodeIds: ['actor', 'camera_1', 'actor_2'] })
  s.deleteSelection()
  assert.equal(doc.content.nodes.some((n) => n.id === 'actor'), false)
  assert.equal(doc.content.nodes.some((n) => n.id === 'actor_2'), false)
  assert.equal(doc.content.nodes.some((n) => n.id === 'camera_1'), false)
  assert.equal(doc.content.timeline.animation.motionClips.some((c) => c.target.nodeId === 'actor'), false)
  assert.equal(doc.content.timeline.animation.pathMotionClips.some((c) => c.target.nodeId === 'actor'), false)
  assert.equal(editor.selection, null)
  assert.equal(history.undoStack.length, 1)
})

test('多选删除跳过锁定物体并保留其选中', () => {
  const { editor, session: s, doc } = session()
  const other = actor()
  other.id = 'actor_2'
  other.name = '角色2'
  other.locked = true
  doc.content.nodes.push(other)
  editor.select({ kind: 'node', nodeId: 'actor_2', nodeIds: ['actor', 'actor_2'] })
  s.deleteSelection()
  assert.equal(doc.content.nodes.some((n) => n.id === 'actor'), false)
  assert.equal(doc.content.nodes.some((n) => n.id === 'actor_2'), true)
  assert.deepEqual(editor.selection, { kind: 'node', nodeId: 'actor_2', nodeIds: ['actor_2'] })
})

test('框选多关键帧后删除一次清掉全部', () => {
  const { editor, session: s, model } = session()
  const a = makeKeyframe(4, [0, 0, 0])
  const b = makeKeyframe(12, [1, 0, 0])
  const c = makeKeyframe(20, [0, 0, 1])
  model.setUserKeys({ actor: { position: [a], rotation: [b], scale: [c] } })
  editor.select({
    kind: 'keyframe',
    nodeId: 'actor',
    prop: 'scale',
    keyId: c.id,
    keys: [
      { nodeId: 'actor', prop: 'position', keyId: a.id },
      { nodeId: 'actor', prop: 'rotation', keyId: b.id },
      { nodeId: 'actor', prop: 'scale', keyId: c.id },
    ],
  })
  s.deleteSelection()
  assert.equal((model.userKeys.actor?.position ?? []).length, 0)
  assert.equal((model.userKeys.actor?.rotation ?? []).length, 0)
  assert.equal((model.userKeys.actor?.scale ?? []).length, 0)
  assert.deepEqual(editor.selection, { kind: 'node', nodeId: 'actor' })
})

test('相机变换主轨一次写入位移旋转看点视野并全选', () => {
  const { editor, session: s, model } = session()
  s.addKeyframes('camera_1', [
    { prop: 'position', value: [1, 2, 3] },
    { prop: 'rotation', value: [0, 10, 0] },
    { prop: 'lookAt', value: [0, 1, 0] },
    { prop: 'fov', value: [50] },
  ])
  const tracks = model.userKeys.camera_1
  assert.equal(tracks?.position?.length, 1)
  assert.equal(tracks?.rotation?.length, 1)
  assert.equal(tracks?.lookAt?.length, 1)
  assert.equal(tracks?.fov?.length, 1)
  assert.equal(tracks?.position?.[0].frame, 12)
  assert.deepEqual(editor.selection, { kind: 'transformKeyframe', nodeId: 'camera_1', frame: 12 })
})

test('Look At 点选角色后写入 lookAtTarget，且选中仍留在相机', () => {
  const { editor, session: s, model } = session()
  editor.select({ kind: 'node', nodeId: 'camera_1', nodeIds: ['camera_1'] })
  s.beginLookAtPick('camera_1')
  assert.equal(s.lookAtPickingId, 'camera_1')
  s.select({ kind: 'node', nodeId: 'actor', nodeIds: ['actor'] })
  assert.equal(s.lookAtPickingId, null)
  const cam = model.snapshot?.content.nodes.find((n) => n.id === 'camera_1')
  assert.equal(cam?.camera?.lookAtTarget?.nodeId, 'actor')
  assert.equal(editor.selection?.kind === 'node' ? editor.selection.nodeId : null, 'camera_1')
})

test('Edit Pose 只接受未锁定的单选角色，并聚焦该角色', () => {
  const { session: s, editor, focused } = session()
  s.setPoseEditingId('camera_1')
  assert.equal(s.poseEditingId, null)
  assert.deepEqual(focused, [])
  editor.select({ kind: 'node', nodeId: 'actor', nodeIds: ['actor'] })
  s.setPoseEditingId('actor')
  assert.equal(s.poseEditingId, 'actor')
  assert.deepEqual(focused, ['actor'])
  s.select({ kind: 'node', nodeId: 'camera_1', nodeIds: ['camera_1'] })
  assert.equal(s.poseEditingId, null)
  assert.deepEqual(focused, ['actor'])
})

test('Look At 点选时空点或点相机本身不改绑定', () => {
  const { session: s, model } = session()
  s.beginLookAtPick('camera_1')
  s.select(null)
  assert.equal(s.lookAtPickingId, 'camera_1')
  s.select({ kind: 'node', nodeId: 'camera_1', nodeIds: ['camera_1'] })
  assert.equal(s.lookAtPickingId, 'camera_1')
  assert.equal(model.snapshot?.content.nodes.find((n) => n.id === 'camera_1')?.camera?.lookAtTarget, undefined)
})

test('多选提交变换会写入全部节点', () => {
  const { session: s, doc } = session()
  const other = actor()
  other.id = 'actor_2'
  other.name = '角色2'
  doc.content.nodes.push(other)
  s.commitNodeTransforms(12, [
    { nodeId: 'actor', position: [1, 0, 0], rotation: [0, 10, 0], scale: [1, 1, 1] },
    { nodeId: 'actor_2', position: [2, 0, 2], rotation: [0, -20, 0], scale: [1, 1, 1] },
  ])
  const first = doc.content.nodes.find((n) => n.id === 'actor')
  const second = doc.content.nodes.find((n) => n.id === 'actor_2')
  assert.deepEqual(first?.transform.position, { x: 1, y: 0, z: 0 })
  assert.deepEqual(second?.transform.position, { x: 2, y: 0, z: 2 })
  assert.equal(first?.transform.rotation.y, 10)
  assert.equal(second?.transform.rotation.y, -20)
})

test('选中人物关键帧时仍能添加 Motion', async () => {
  const { editor, session: s, model, doc } = session()
  const kf = makeKeyframe(8, [0, 0, 0])
  model.setUserKeys({ actor: { position: [kf] } })
  editor.select({ kind: 'keyframe', nodeId: 'actor', prop: 'position', keyId: kf.id })
  const err = await s.addMotionClipFromLibrary('run.fbx', '跑')
  assert.equal(err, null)
  assert.equal(doc.content.timeline.animation.motionClips.at(-1)?.target.nodeId, 'actor')
})

test('删除人物动作片段后仍选中该人物，时间线不退回全节点列表', () => {
  const { editor, session: s, doc } = session()
  editor.select({ kind: 'clip', clipType: 'motion', clipId: 'idle' })
  s.deleteClip('motion', 'idle')
  assert.equal(doc.content.timeline.animation.motionClips.some((c) => c.id === 'idle'), false)
  assert.deepEqual(editor.selection, { kind: 'node', nodeId: 'actor' })
})

test('删除人物运动轨迹片段后仍选中该人物', () => {
  const { editor, session: s, doc } = session()
  editor.select({ kind: 'clip', clipType: 'path', clipId: 'walk' })
  s.deleteClip('path', 'walk')
  assert.equal(doc.content.timeline.animation.pathMotionClips.some((c) => c.id === 'walk'), false)
  assert.deepEqual(editor.selection, { kind: 'node', nodeId: 'actor' })
})

test('删除机位运镜片段后仍选中该机位', () => {
  const { editor, session: s, doc } = session()
  editor.select({ kind: 'clip', clipType: 'camera', clipId: 'orbit' })
  s.deleteClip('camera', 'orbit')
  assert.equal(doc.content.timeline.animation.cameraMotionClips.some((c) => c.id === 'orbit'), false)
  assert.deepEqual(editor.selection, { kind: 'node', nodeId: 'cam' })
})

test('Delete 删除机位运镜片段后仍选中该机位', () => {
  const { editor, session: s, doc } = session()
  editor.select({ kind: 'clip', clipType: 'camera', clipId: 'orbit' })
  s.deleteSelection()
  assert.equal(doc.content.timeline.animation.cameraMotionClips.some((c) => c.id === 'orbit'), false)
  assert.deepEqual(editor.selection, { kind: 'node', nodeId: 'cam' })
})

test('applyPathToTarget 可以绑到基础形状', () => {
  const { session: s, doc } = session()
  doc.content.nodes.push(
    {
      id: 'sphere_1',
      type: 'primitive',
      name: '球体',
      visible: true,
      locked: false,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      primitive: { kind: 'SphereGeometry', parameters: { radius: 0.6 } },
    },
    {
      id: 'path_drawn',
      type: 'path',
      name: '轨迹1',
      visible: true,
      locked: false,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      path: {
        source: 'draw',
        curve: 'catmullRom',
        closed: false,
        groundSnap: true,
        parameterization: 'arc-length',
        smoothing: 0.5,
        points: [
          { id: 'p0', position: { x: 0, y: 0, z: 0 } },
          { id: 'p1', position: { x: 2, y: 0, z: 1 } },
        ],
      },
    },
  )
  const err = s.applyPathToTarget('path_drawn', 'sphere_1')
  assert.equal(err, null)
  const clip = doc.content.timeline.animation.pathMotionClips.find((c) => c.pathNodeId === 'path_drawn')
  assert.equal(clip?.target.nodeId, 'sphere_1')
})

test('选中角色、道具或基础形状都不改变时间轴展开状态', () => {
  const { editor, session: s, doc } = session()
  doc.content.nodes.push(
    {
      id: 'box_1',
      type: 'primitive',
      name: '正方体',
      visible: true,
      locked: false,
      transform: {
        position: { x: 0, y: 0.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      primitive: { kind: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 } },
    },
    {
      id: 'prop_1',
      type: 'prop',
      name: '道具',
      visible: true,
      locked: false,
      transform: {
        position: { x: 1, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    },
  )
  editor.timelineOpen = false
  s.select({ kind: 'node', nodeId: 'actor', nodeIds: ['actor'] })
  assert.equal(editor.timelineOpen, false)
  s.select({ kind: 'node', nodeId: 'prop_1', nodeIds: ['prop_1'] })
  assert.equal(editor.timelineOpen, false)
  s.select({ kind: 'node', nodeId: 'box_1', nodeIds: ['box_1'] })
  assert.equal(editor.timelineOpen, false)
  editor.timelineOpen = true
  s.select({ kind: 'node', nodeId: 'prop_1', nodeIds: ['prop_1'] })
  assert.equal(editor.timelineOpen, true)
  s.select({ kind: 'node', nodeId: 'box_1', nodeIds: ['box_1'] })
  assert.equal(editor.timelineOpen, true)
})


test('clip selection preserves group on press and supports additive toggle', () => {
  const a = { clipType: 'camera' as const, clipId: 'orbit' }
  const b = { clipType: 'path' as const, clipId: 'dolly' }
  const group = makeClipSelection([a, b])
  assert.equal(nextClipSelection(group, a, false), group)
  assert.deepEqual(clipRefsOf(nextClipSelection(group, a, true)), [b])
  assert.deepEqual(clipRefsOf(nextClipSelection(makeClipSelection([a]), b, true)), [a, b])
  assert.equal(nextClipSelection(makeClipSelection([a]), a, true), null)
})

test('mixed camera/path deletion removes all selected clips in one undo, keeping others', () => {
  const { session: s, editor, model, history } = session()
  editor.select(makeClipSelection([{ clipType: 'camera', clipId: 'orbit' }, { clipType: 'path', clipId: 'dolly' }]))
  s.deleteSelection()
  assert.equal(model.snapshot!.content.timeline.animation.cameraMotionClips.length, 0)
  assert.deepEqual(model.snapshot!.content.timeline.animation.pathMotionClips.map(c => c.id), ['walk'])
  assert.equal(model.snapshot!.content.timeline.animation.motionClips.length, 1)
  assert.equal(history.undoStack.length, 1)
  history.undo()
  assert.equal(model.snapshot!.content.timeline.animation.cameraMotionClips.length, 1)
  assert.equal(model.snapshot!.content.timeline.animation.pathMotionClips.length, 2)
  history.redo()
  assert.equal(model.snapshot!.content.timeline.animation.cameraMotionClips.length, 0)
})

test('mixed marquee deletes selected clips and keys as one operation', () => {
  const { session: s, editor, model, history } = session()
  const key = makeKeyframe(12, [1, 2, 3])
  const other = makeKeyframe(40, [4, 5, 6])
  model.setUserKeys({ actor: { rotation: [key, other] } })
  editor.select({ kind: 'timelineBox', clips: [{ clipType: 'camera', clipId: 'orbit' }, { clipType: 'path', clipId: 'dolly' }],
    keys: [{ nodeId: 'actor', prop: 'rotation', keyId: key.id }] })
  s.deleteSelection()
  assert.deepEqual(model.userKeys.actor.rotation?.map(k => k.id), [other.id])
  assert.equal(model.snapshot!.content.timeline.animation.cameraMotionClips.length, 0)
  assert.equal(history.undoStack.length, 1)
  history.undo()
  assert.equal(model.userKeys.actor.rotation?.length, 2)
  assert.equal(model.snapshot!.content.timeline.animation.pathMotionClips.length, 2)
})

test('mixed clip group translates rigidly, cancels cleanly and commits one undo', () => {
  const { session: s, editor, model, history, doc } = session()
  doc.content.timeline.animation.pathMotionClips.find(c => c.id === 'dolly')!.frameStart = 10
  doc.content.timeline.animation.pathMotionClips.find(c => c.id === 'dolly')!.frameEnd = 40
  model.touch()
  editor.select(makeClipSelection([{ clipType: 'camera', clipId: 'orbit' }, { clipType: 'path', clipId: 'dolly' }]))
  s.beginClipMove()
  s.moveClip('camera', 'orbit', 25)
  assert.deepEqual(editor.clipMovePreview?.positions.dolly, { frameStart: 35, frameEnd: 65 })
  assert.equal(model.snapshot!.content.timeline.animation.cameraMotionClips[0].frameStart, 0)
  s.cancelClipMove()
  assert.equal(editor.clipMovePreview, null)
  assert.equal(history.undoStack.length, 0)
  s.beginClipMove()
  s.moveClip('camera', 'orbit', 25)
  s.endClipMove()
  assert.equal(model.snapshot!.content.timeline.animation.cameraMotionClips[0].frameStart, 25)
  assert.equal(model.snapshot!.content.timeline.animation.pathMotionClips.find(c => c.id === 'dolly')!.frameStart, 35)
  assert.equal(model.snapshot!.content.timeline.animation.pathMotionClips.find(c => c.id === 'walk')!.frameStart, 0)
  assert.equal(history.undoStack.length, 1)
  history.undo()
  assert.equal(model.snapshot!.content.timeline.animation.cameraMotionClips[0].frameStart, 0)
})

test('group drag clamps the entire group at timeline start and unselected neighbours', () => {
  const { session: s, editor, model, doc } = session()
  doc.content.timeline.animation.cameraMotionClips.push({ ...cameraClip('neighbour'), frameStart: 50, frameEnd: 70 })
  model.touch()
  editor.select(makeClipSelection([{ clipType: 'camera', clipId: 'orbit' }, { clipType: 'path', clipId: 'dolly' }]))
  s.beginClipMove()
  s.moveClip('path', 'dolly', 100)
  assert.equal(editor.clipMovePreview?.positions.orbit.frameStart, 20)
  assert.equal(editor.clipMovePreview?.positions.dolly.frameStart, 20)
  s.moveClip('path', 'dolly', -100)
  assert.equal(editor.clipMovePreview?.positions.orbit.frameStart, 0)
  s.endClipMove()
  assert.equal(model.snapshot!.content.timeline.animation.cameraMotionClips.find(c => c.id === 'neighbour')!.frameStart, 50)
})
