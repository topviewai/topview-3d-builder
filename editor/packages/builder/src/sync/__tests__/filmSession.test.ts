import assert from 'node:assert/strict'
import { test } from 'vitest'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument } from '../../contract/types'
import { DirectorDoc } from '../../document/DirectorDoc'
import { History } from '../../document/History'
import type { DirectorEngine } from '../../engine/DirectorEngine'
import { EditorStore } from '../../stores/EditorStore'
import type { HostAdapter } from '../../host/types'
import { StudioSession } from '../StudioSession'

const CAM = {
  fov: 50,
  position: { x: 0, y: 1.7, z: 5 },
  rotation: { x: 0, y: 0, z: 0 },
  lookAt: { x: 0, y: 1.2, z: 0 },
}

function fixture() {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('film-session', 30, 120, CAM)
  model.replace(doc)
  const editor = new EditorStore('film-session')
  editor.autoKeyframe = false
  const history = new History()
  const frames: number[] = []
  const cameras: string[] = []
  const engine = {
    currentFrame: 12,
    pause() {},
    play() {},
    seek(this: { currentFrame: number }, frame: number) {
      this.currentFrame = frame
    },
    setOrbitEnabled() {},
    beginProgramPreview() {},
    endProgramPreview() {},
    previewProgramFrame(sourceFrame: number, cameraId: string) {
      frames.push(sourceFrame)
      cameras.push(cameraId)
    },
    syncGizmo() {},
    syncPathSelection() {},
    syncCameraMotionGuide() {},
    setPoseEditingId() {},
    setStagedTransform() {},
    clearStagedTransforms() {},
    hasStagedTransform() { return false },
  } as unknown as DirectorEngine
  const session = new StudioSession(engine, model, editor, history, {} as HostAdapter<DirectorDocument>)
  return { session, editor, history, model, doc, frames, cameras, engine }
}

test('每个成片手势恰好一条 Undo，且不改 Scene 帧', () => {
  const { session, editor, history, engine } = fixture()
  session.setWorkspaceMode('film')
  assert.equal(editor.workspaceMode, 'film')
  assert.equal(engine.currentFrame, 12)

  session.beginFilmAddDraft()
  session.beginFilmAddDraft()
  assert.equal(history.undoStack.length, 2)
  assert.equal(session.doc?.content.editorial?.sequences[0].clips.length, 2)

  session.duplicateFilmClip(session.doc!.content.editorial!.sequences[0].clips[0].id)
  assert.equal(history.undoStack.length, 3)
  history.undo()
  assert.equal(session.doc?.content.editorial?.sequences[0].clips.length, 2)
  assert.equal(engine.currentFrame, 12)
})

test('切回 Scene 恢复帧、机位和选区', () => {
  const { session, editor, engine } = fixture()
  editor.setActiveCamera('camera_1')
  session.select({ kind: 'node', nodeId: 'camera_1' })
  session.setWorkspaceMode('film')
  session.beginFilmAddDraft()
  session.setFilmSelection({ kind: 'edit-clip', clipId: session.doc!.content.editorial!.sequences[0].clips[0].id })
  session.setWorkspaceMode('scene')
  assert.equal(editor.workspaceMode, 'scene')
  assert.equal(engine.currentFrame, 12)
  assert.equal(editor.activeCameraId, 'camera_1')
  assert.deepEqual(editor.selection, { kind: 'node', nodeId: 'camera_1' })
  assert.equal(editor.filmSelection?.kind, 'edit-clip')
})

test('新分镜的素材时间接着上一段末尾，而不是重剪同一区间', () => {
  const { session } = fixture()
  session.setWorkspaceMode('film')
  session.beginFilmAddDraft()
  const firstId = session.doc!.content.editorial!.sequences[0].clips[0].id
  session.updateFilmClip(firstId, { sourceFrameStart: 0, sourceFrameEnd: 40 })

  session.beginFilmAddDraft(null)
  assert.equal(session.doc!.content.editorial!.sequences[0].clips[1].sourceFrameStart, 41)

  session.beginFilmAddDraft(firstId)
  const inserted = session.doc!.content.editorial!.sequences[0].clips[1]
  assert.equal(inserted.sourceFrameStart, 41)
})

test('失效版本禁播', () => {
  const { session, doc } = fixture()
  session.setWorkspaceMode('film')
  session.beginFilmAddDraft()
  doc.content.editorial!.sequences[0].clips[0].cameraNodeId = 'missing'
  session.playFilmSequence()
  assert.equal(session.playback.getSnapshot().mode, 'idle')
})

test('拖拽预览不入历史，提交才一条 Undo，且不改 Scene 帧', () => {
  const { session, history, engine } = fixture()
  session.setWorkspaceMode('film')
  session.beginFilmAddDraft()
  const clipId = session.doc!.content.editorial!.sequences[0].clips[0].id
  const before = history.undoStack.length
  session.beginFilmDrag('sequence-trim-end', clipId)
  session.previewFilmDrag({
    kind: 'sequence-trim-end',
    clipId,
    cameraNodeId: 'camera_1',
    sourceFrameStart: 0,
    sourceFrameEnd: 8,
  })
  assert.equal(history.undoStack.length, before)
  session.commitFilmDrag()
  assert.equal(history.undoStack.length, before + 1)
  assert.equal(session.doc?.content.editorial?.sequences[0].clips[0].sourceFrameEnd, 8)
  assert.equal(engine.currentFrame, 12)
})

test('浏览机位只换看哪台，选中分镜才改角度；新分镜跟浏览机位、时间接上一段', () => {
  const { session, editor, doc, frames, cameras } = fixture()
  const primary = doc.content.nodes.find((node) => node.id === 'camera_1')
  if (!primary?.camera) throw new Error('expected primary camera')
  doc.content.nodes.push({
    id: 'camera_2',
    type: 'camera',
    name: '侧相机',
    visible: true,
    locked: false,
    transform: structuredClone(primary.transform),
    camera: {
      projection: primary.camera.projection,
      fov: primary.camera.fov,
      fovAxis: primary.camera.fovAxis,
      near: primary.camera.near,
      far: primary.camera.far,
      isPrimary: false,
      lookAt: { ...primary.camera.lookAt },
    },
  })
  session.setWorkspaceMode('film')
  session.beginFilmAddDraft()
  const clipId = session.doc!.content.editorial!.sequences[0].clips[0].id
  session.updateFilmClip(clipId, { sourceFrameStart: 0, sourceFrameEnd: 20 })

  session.setFilmSelection(null)
  const before = session.doc!.content.editorial!.sequences[0].clips[0].cameraNodeId
  frames.length = 0
  cameras.length = 0
  session.setFilmBrowseCamera('camera_2')
  assert.equal(editor.filmBrowseCameraId, 'camera_2')
  assert.equal(session.doc!.content.editorial!.sequences[0].clips[0].cameraNodeId, before)
  assert.equal(cameras.at(-1), 'camera_2')

  session.seekFilmSource(15)
  assert.equal(session.playback.getSnapshot().sourcePreviewFrame, 15)
  assert.equal(cameras.at(-1), 'camera_2')

  session.setFilmSelection({ kind: 'edit-clip', clipId })
  session.setFilmBrowseCamera('camera_2')
  assert.equal(session.doc!.content.editorial!.sequences[0].clips[0].cameraNodeId, 'camera_2')

  session.setFilmSelection(null)
  session.setFilmBrowseCamera('camera_2')
  session.beginFilmAddDraft()
  const added = session.doc!.content.editorial!.sequences[0].clips.at(-1)
  assert.equal(added?.cameraNodeId, 'camera_2')
  assert.equal(added?.sourceFrameStart, 21)
})

test('成片逐帧不影响 Scene 时钟', () => {
  const { session, engine } = fixture()
  session.setWorkspaceMode('film')
  session.beginFilmAddDraft()
  session.updateFilmClip(session.doc!.content.editorial!.sequences[0].clips[0].id, { sourceFrameEnd: 10 })
  session.seekFilmSequence(0)
  session.stepFrame(2)
  assert.equal(session.playback.getSnapshot().sequenceFrame, 2)
  assert.equal(engine.currentFrame, 12)
})
