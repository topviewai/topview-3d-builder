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
import { pathControlCentroid, transformPathLocalPoint } from '../../evaluate/path/samplePath'
import { createFrameSnapshot, evaluateFrame, prepareFrameSnapshot, sceneFromDocument } from '../../evaluate'

function pathNode(id = 'path_drawn'): DraftNode {
  return {
    id,
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
      source: 'click',
      curve: 'catmullRom',
      closed: false,
      groundSnap: true,
      parameterization: 'arc-length',
      smoothing: 0.5,
      points: [
        { id: 'p0', position: { x: 0, y: 0, z: 0 } },
        { id: 'p1', position: { x: 2, y: 0, z: 0 } },
        { id: 'p2', position: { x: 2, y: 0, z: 2 } },
      ],
    },
  }
}

function session(frame = 0) {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('path-edit-test', 30, 120)
  doc.content.nodes.push(pathNode())
  model.replace(doc)
  const editor = new EditorStore('path-edit-test')
  const history = new History()
  const gizmoStates: { nodeId: string | null; editingId: string | null; pointIndex: number | null }[] = []
  const engine = {
    get currentFrame() { return frame },
    invalidate() {},
    setFcurves() {},
    setPoseEditingId() {},
    setPathEditing() {},
    syncGizmo(nodeId: string | null) {
      gizmoStates.push({ nodeId, editingId: editor.pathEditingId, pointIndex: editor.pathEditPointIndex })
    },
    syncPathSelection() {},
    syncCameraMotionGuide() {},
    applyLiveNodeTransform() {},
    applyLivePathStroke() {},
    refreshPathNode() {},
    removeNode() {},
    syncPathNodes() {},
    seek() {},
    setStagedTransform() {},
    clearStagedTransforms() {},
    hasStagedTransform() { return false },
    getNodeSnapshot: () => null,
  } as unknown as DirectorEngine
  const adapter = {
    resolveMediaUrl: () => 'https://example.com/x.fbx',
  } as unknown as HostAdapter<DirectorDocument>
  return {
    doc,
    editor,
    session: new StudioSession(engine, model, editor, history, adapter),
    model,
    history,
    gizmoStates,
  }
}

test('轨迹编辑只接受未锁定的手绘路径', () => {
  const { session: s, editor, doc } = session()
  s.setPathEditingId('missing')
  assert.equal(s.pathEditingId, null)
  const locked = doc.content.nodes.find((n) => n.id === 'path_drawn')
  if (locked) locked.locked = true
  s.setPathEditingId('path_drawn')
  assert.equal(s.pathEditingId, null)
  if (locked) locked.locked = false
  editor.select({ kind: 'node', nodeId: 'path_drawn', nodeIds: ['path_drawn'] })
  s.setPathEditingId('path_drawn')
  assert.equal(s.pathEditingId, 'path_drawn')
  assert.equal(s.pathEditPointIndex, 0)
})

test('选中离开轨迹时退出锚点编辑', () => {
  const { session: s, editor } = session()
  editor.select({ kind: 'node', nodeId: 'path_drawn', nodeIds: ['path_drawn'] })
  s.setPathEditingId('path_drawn')
  assert.equal(s.pathEditingId, 'path_drawn')
  s.select(null)
  assert.equal(s.pathEditingId, null)
})

test('整条轨迹提交减掉质心并让全部控制点协同变换', () => {
  const { session: s, editor, doc, history } = session()
  editor.select({ kind: 'node', nodeId: 'path_drawn', nodeIds: ['path_drawn'] })
  const node = doc.content.nodes.find((n) => n.id === 'path_drawn')
  if (!node?.path) throw new Error('path node missing')
  const center = pathControlCentroid(node)
  // 操作轴代理位于「质心 + transform.position」，沿 x 推 3
  assert.equal(
    s.commitPathTransform('path_drawn', {
      position: { x: center.x + 3, y: center.y, z: center.z },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }),
    null,
  )
  assert.deepEqual(node.transform.position, { x: 3, y: 0, z: 0 })
  // 控制点本身不动，世界采样整体平移
  assert.deepEqual(node.path.points.map((p) => p.position.x), [0, 2, 2])
  const worlds = node.path.points.map((p) => transformPathLocalPoint(p.position, node.transform, center))
  assert.deepEqual(worlds.map((w) => Math.round(w.x * 1e6) / 1e6), [3, 5, 5])
  assert.equal(history.canUndo, true)
  s.undo()
  const restored = doc.content.nodes.find((n) => n.id === 'path_drawn')
  assert.deepEqual(restored?.transform.position, { x: 0, y: 0, z: 0 })
})

test('整条轨迹提交后选区与操作轴仍停在该路径', () => {
  const { session: s, editor, doc } = session()
  editor.select({ kind: 'node', nodeId: 'path_drawn', nodeIds: ['path_drawn'] })
  const node = doc.content.nodes.find((n) => n.id === 'path_drawn')
  if (!node?.path) throw new Error('path node missing')
  const center = pathControlCentroid(node)
  s.beginInteraction()
  s.commitPathTransform('path_drawn', {
    position: { x: center.x + 3, y: center.y, z: center.z },
  })
  s.endInteraction('变换轨迹')
  assert.deepEqual(s.selection, { kind: 'node', nodeId: 'path_drawn', nodeIds: ['path_drawn'] })
  assert.equal(s.pathEditingId, null)
})

test('整条轨迹的操作轴不接受锁定节点', () => {
  const { session: s, editor, doc } = session()
  editor.select({ kind: 'node', nodeId: 'path_drawn', nodeIds: ['path_drawn'] })
  const node = doc.content.nodes.find((n) => n.id === 'path_drawn')
  if (node) node.locked = true
  assert.equal(
    s.commitPathTransform('path_drawn', { position: { x: 9, y: 0, z: 0 } }),
    'path-not-editable',
  )
  assert.deepEqual(node?.transform.position, { x: 0, y: 0, z: 0 })
})

test('退出锚点编辑后焦点回到整条路径', () => {
  const { session: s, editor, gizmoStates } = session()
  s.setPathEditingId('path_drawn')
  assert.deepEqual(s.selection, { kind: 'node', nodeId: 'path_drawn', nodeIds: ['path_drawn'] })
  s.setPathEditPointIndex(2)
  // 编辑可由外部入口开启；完成时不依赖进入前或暂存的选区。
  editor.select(null)
  s.setPathEditingId(null)
  assert.equal(s.pathEditingId, null)
  assert.equal(s.pathEditPointIndex, null)
  assert.deepEqual(s.selection, { kind: 'node', nodeId: 'path_drawn', nodeIds: ['path_drawn'] })
  assert.deepEqual(gizmoStates.at(-1), { nodeId: 'path_drawn', editingId: null, pointIndex: null })
})

test('提交锚点写入世界坐标并支持撤销', () => {
  const { session: s, editor, doc, history } = session()
  editor.select({ kind: 'node', nodeId: 'path_drawn', nodeIds: ['path_drawn'] })
  s.setPathEditingId('path_drawn')
  s.setPathEditPointIndex(1)
  assert.equal(s.commitPathPoint('path_drawn', 1, { x: 5, y: 1, z: -2 }), null)
  const point = doc.content.nodes.find((n) => n.id === 'path_drawn')?.path?.points[1]
  assert.deepEqual(point?.position, { x: 5, y: 1, z: -2 })
  assert.equal(history.canUndo, true)
  s.undo()
  const restored = doc.content.nodes.find((n) => n.id === 'path_drawn')?.path?.points[1]
  assert.deepEqual(restored?.position, { x: 2, y: 0, z: 0 })
})

test('点选对象后把轨迹绑到该对象，点自身或锁定对象则继续点选', () => {
  const { session: s, editor, doc } = session()
  const character = (id: string, locked = false): DraftNode => ({
    id,
    type: 'character',
    name: id,
    visible: true,
    locked,
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
  })
  doc.content.nodes.push(character('actor'), character('locked_actor', true))
  editor.setLookAtPickingId('stale')
  s.beginPathApplyPick('path_drawn')
  assert.equal(s.lookAtPickingId, null)
  assert.equal(s.pathApplyPickingId, 'path_drawn')
  s.select({ kind: 'node', nodeId: 'path_drawn', nodeIds: ['path_drawn'] })
  assert.equal(s.pathApplyPickingId, 'path_drawn')
  assert.equal(doc.content.timeline.animation.pathMotionClips.length, 0)
  s.select({ kind: 'node', nodeId: 'locked_actor', nodeIds: ['locked_actor'] })
  assert.equal(s.pathApplyPickingId, 'path_drawn')
  s.select({ kind: 'node', nodeId: 'actor', nodeIds: ['actor'] })
  assert.equal(s.pathApplyPickingId, null)
  const clip = doc.content.timeline.animation.pathMotionClips[0]
  assert.equal(clip?.target.nodeId, 'actor')
  assert.equal(clip?.pathNodeId, 'path_drawn')
})

for (const startFrame of [0, 90, 119]) {
  test(`从第 ${startFrame} 帧应用长路径时，相机在片段末帧走到完整轨迹终点`, () => {
    const { session: s, doc } = session(startFrame)
    const camera = makeEmptyDraft('camera', 30, 120, {
      fov: 50, position: { x: 0, y: 2, z: 4 },
      rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 },
    }).content.nodes[0]
    doc.content.nodes.push(camera)
    const path = doc.content.nodes.find((node) => node.id === 'path_drawn')!
    path.path!.points = path.path!.points.map((point) => ({
      ...point, position: { x: point.position.x * 30, y: 2, z: point.position.z * 30 },
    }))
    assert.equal(s.applyPathToTarget(path.id, camera.id), null)
    const clip = doc.content.timeline.animation.pathMotionClips[0]
    assert.equal(clip.frameStart, startFrame)
    assert.equal(clip.frameEnd, 120)
    assert.equal(clip.pathStartPercent, 0)
    assert.equal(clip.pathEndPercent, 100)
    assert.equal(clip.playback.baseDurationFrames, 120 - startFrame)
    const snapshot = createFrameSnapshot()
    prepareFrameSnapshot(snapshot, doc.content.nodes.map((node) => node.id))
    evaluateFrame(sceneFromDocument(doc), 120, snapshot)
    const position = snapshot.transforms.get(camera.id)!.position
    assert.ok(Math.hypot(position.x - 60, position.y - 2, position.z - 60) < 1e-6)
    // 后续拉伸片段只改变走完所需的时间，不保留创建时的残缺覆盖率。
    assert.equal(s.resizePathMotionClip(clip.id, 'start', 0), null)
    assert.equal(s.resizePathMotionClip(clip.id, 'end', 60), null)
    evaluateFrame(sceneFromDocument(doc), 60, snapshot)
    const resizedPosition = snapshot.transforms.get(camera.id)!.position
    assert.ok(Math.hypot(resizedPosition.x - 60, resizedPosition.y - 2, resizedPosition.z - 60) < 1e-6)
  })
}
