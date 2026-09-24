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
import {
  cameraMotionActiveAtFrame,
  cameraMotionOwnsKeyframes,
  cameraPositionDragMoved,
} from '../../evaluate/camera/cameraMotionExclusive'

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

function motionClip(cameraId: string): DirectorDocument['content']['timeline']['animation']['cameraMotionClips'][number] {
  return {
    id: 'm1',
    target: { type: 'camera', nodeId: cameraId },
    frameStart: 0,
    frameEnd: 30,
    trimStartMs: 0,
    trimEndMs: 1000,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: 30 },
    motion: {
      id: 'static_shot',
      version: 1,
      presetId: 'static_shot',
      label: 'static',
      timeUnit: 'ms',
      durationMs: 1000,
      curves: [],
    },
  }
}

function fixture(withMotion = false) {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('motion-excl-test', 30, 120)
  doc.content.nodes.push(camNode())
  if (withMotion) {
    doc.content.timeline.animation.cameraMotionClips.push(motionClip('cam'))
  }
  model.replace(doc)
  const editor = new EditorStore('motion-excl-test')
  editor.autoKeyframe = false
  editor.setActiveCamera('cam')
  const history = new History()
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
    history,
    {} as HostAdapter<DirectorDocument>,
  )
  return { model, doc, session, engine: engine as unknown as { currentFrame: number } }
}

test('cameraMotionOwnsKeyframes：无运镜为 false，有运镜为 true', () => {
  const bare = makeEmptyDraft('x', 30, 60)
  bare.content.nodes.push(camNode())
  assert.equal(cameraMotionOwnsKeyframes(bare, 'cam'), false)
  bare.content.timeline.animation.cameraMotionClips.push(motionClip('cam'))
  assert.equal(cameraMotionOwnsKeyframes(bare, 'cam'), true)
})

test('cameraMotionActiveAtFrame：只在片段覆盖的帧上为 true', () => {
  const bare = makeEmptyDraft('x', 30, 60)
  bare.content.nodes.push(camNode())
  assert.equal(cameraMotionActiveAtFrame(bare, 'cam', 0), false)
  bare.content.timeline.animation.cameraMotionClips.push(motionClip('cam'))
  assert.equal(cameraMotionActiveAtFrame(bare, 'cam', 0), true)
  assert.equal(cameraMotionActiveAtFrame(bare, 'cam', 30), true)
  assert.equal(cameraMotionActiveAtFrame(bare, 'cam', 31), false)
  assert.equal(cameraMotionActiveAtFrame(bare, 'other', 10), false)
})

test('cameraPositionDragMoved：微小抖动不算位移', () => {
  assert.equal(cameraPositionDragMoved([0, 1.6, 4], [0, 1.6, 4]), false)
  assert.equal(cameraPositionDragMoved([0, 1.6, 4], [0, 1.6, 4.00001]), false)
  assert.equal(cameraPositionDragMoved([0, 1.6, 4], [0.2, 1.6, 4]), true)
  assert.equal(cameraPositionDragMoved(null, [0.2, 1.6, 4]), false)
})

test('notifyCameraMotionDragBlocked 递增提示版本', () => {
  const { session } = fixture(true)
  assert.equal(session.cameraMotionDragNoticeVersion, 0)
  session.notifyCameraMotionDragBlocked()
  assert.equal(session.cameraMotionDragNoticeVersion, 1)
})

test('有运镜时 addKeyframes 被拦截', () => {
  const { session, model } = fixture(true)
  session.addKeyframes('cam', [{ prop: 'position', value: [1, 1.6, 4] }])
  assert.equal(model.userKeys.cam, undefined)
})

test('无运镜时 addKeyframes 正常', () => {
  const { session, model } = fixture(false)
  session.addKeyframes('cam', [{ prop: 'position', value: [1, 1.6, 4] }])
  assert.equal(model.userKeys.cam?.position?.length, 1)
})

test('有运镜时 moveKeyframes / removeKeyframes 被拦截', () => {
  const { session, model, doc } = fixture(true)
  model.setUserKeys({
    cam: { position: [makeKeyframe(0, [0, 1.6, 4])] },
  })
  const keyId = model.userKeys.cam!.position![0].id
  session.moveKeyframes([{ nodeId: 'cam', prop: 'position', keyId, newFrame: 10 }])
  assert.equal(model.userKeys.cam!.position![0].frame, 0)
  session.removeKeyframes([{ nodeId: 'cam', prop: 'position', keyId }])
  assert.equal(model.userKeys.cam?.position?.length, 1)
  // 机位仍可平移（静态）
  session.writeCameraWorldPos('cam', { x: 2, y: 1.6, z: 4 }, true)
  assert.equal(doc.content.nodes.find((n) => n.id === 'cam')!.transform.position.x, 2)
  // 残留 userKeys 不被改写
  assert.deepEqual(model.userKeys.cam!.position![0].value, [0, 1.6, 4])
})

test('applyCameraMotion 保留已有关键帧（挂起而非删除）', () => {
  const { session, model } = fixture(false)
  model.setUserKeys({
    cam: { position: [makeKeyframe(0, [0, 1.6, 4]), makeKeyframe(20, [2, 1.6, 2])] },
  })
  const before = model.userKeys.cam!.position!.map((k) => ({ id: k.id, frame: k.frame, value: [...k.value] }))
  // static_shot 在 CAMERA_MOTIONS 里；失败则跳过 bake 断言但至少不该清键
  const err = session.applyCameraMotion('static_shot')
  assert.equal(model.userKeys.cam?.position?.length, 2)
  assert.deepEqual(
    model.userKeys.cam!.position!.map((k) => ({ id: k.id, frame: k.frame, value: [...k.value] })),
    before,
  )
  if (err === null) {
    assert.equal(model.snapshot!.content.timeline.animation.cameraMotionClips.length >= 1, true)
  }
})

test('空场景点击运镜会按当前视口自动建机并挂上预设，不再返回 missing-camera', () => {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('auto-cam-motion', 30, 120)
  model.replace(doc)
  const editor = new EditorStore('auto-cam-motion')
  editor.autoKeyframe = false
  const history = new History()
  const engine = {
    currentFrame: 0,
    captureEditorView() {
      return {
        position: { x: 3, y: 2, z: 5 },
        rotation: { x: -10, y: 25, z: 0 },
        lookAt: { x: 0, y: 1.2, z: 0 },
        fov: 48,
      }
    },
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
    history,
    {} as HostAdapter<DirectorDocument>,
  )
  const err = session.applyCameraMotion('dolly_in')
  assert.equal(err, null, String(err))
  const live = model.snapshot!
  const cams = live.content.nodes.filter((n) => n.type === 'camera')
  assert.equal(cams.length, 1)
  assert.deepEqual(cams[0].transform.position, { x: 3, y: 2, z: 5 })
  assert.equal(cams[0].camera?.fov, 48)
  const clips = live.content.timeline.animation.cameraMotionClips
  assert.ok(clips.length >= 1)
  assert.equal(clips[0].target.nodeId, cams[0].id)
  assert.equal(editor.activeCameraId, cams[0].id)
})

test('连点两次运镜：第二段接在第一段之后并贴紧，不叠在同一帧', () => {
  const { session, model } = fixture(false)
  model.snapshot!.content.timeline.frameEnd = 10
  assert.equal(session.applyCameraMotion('dolly_in'), null)
  assert.equal(session.applyCameraMotion('dolly_in'), null)
  const clips = model.snapshot!.content.timeline.animation.cameraMotionClips
  assert.equal(clips.length, 2)
  const [first, second] = [...clips].sort((a, b) => a.frameStart - b.frameStart)
  assert.equal(first.frameStart, 0)
  assert.equal(second.frameStart, first.frameEnd)
  assert.ok(second.frameEnd > second.frameStart)
  assert.equal(model.snapshot!.content.timeline.frameEnd, 10)
  assert.equal(session.updateCameraMotionConfig(first.id, { durationMs: 4000 }), null)
  assert.equal(model.snapshot!.content.timeline.frameEnd, 10, 'rebaking and ripple shifts preserve the playback end')
})

test('播放头已越过整条轨道时，新运镜从播放头开始', () => {
  const { session, model, doc, engine } = fixture(true)
  doc.content.timeline.animation.cameraMotionClips[0].frameEnd = 30
  engine.currentFrame = 60
  assert.equal(session.applyCameraMotion('dolly_in'), null)
  const clips = model.snapshot!.content.timeline.animation.cameraMotionClips
  const added = clips.find((c) => c.id !== 'm1')!
  assert.equal(added.frameStart, 60)
})

