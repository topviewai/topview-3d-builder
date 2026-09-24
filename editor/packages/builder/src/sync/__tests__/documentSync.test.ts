import { test } from 'vitest'
import assert from 'node:assert/strict'
import { reaction } from 'mobx'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument } from '../../contract/types'
import { DirectorDoc } from '../../document/DirectorDoc'
import { History } from '../../document/History'
import { EditorStore } from '../../stores/EditorStore'
import type { DirectorEngine } from '../../engine/DirectorEngine'
import type { HostAdapter } from '../../host/types'
import { DocumentSync } from '../DocumentSync'
import { StudioSession } from '../StudioSession'

function engineStub(): DirectorEngine {
  return {
    currentFrame: 0,
    ready: false,
    reset() {},
    invalidate() {},
    load: async () => undefined,
    seek() {},
    setEvalContext() {},
    setFcurves() {},
    pause() {},
    play() {},
    removeNode() {},
    hasNode() { return false },
    addRuntimeNode: async () => undefined,
    setPoseEditingId() {},
    syncGizmo() {},
    syncPathSelection() {},
    syncPathNodes() {},
    syncCameraMotionGuide() {},
  } as unknown as DirectorEngine
}

test('重新加载宿主文档后 dirty 会通知为 false', async () => {
  const documentId = 'host-reload'
  const adapter = {
    loadDocument: async () => makeEmptyDraft(documentId, 24, 120),
    loadFCurves: async () => null,
  } as unknown as HostAdapter<DirectorDocument>
  const session = new StudioSession(
    engineStub(),
    new DirectorDoc(),
    new EditorStore(documentId),
    new History(),
    adapter,
  )
  const dirtyStates: boolean[] = []
  const dispose = reaction(
    () => session.dirty,
    (dirty) => dirtyStates.push(dirty),
    { fireImmediately: true },
  )

  await session.loadDraft(documentId)

  assert.deepEqual(dirtyStates, [false, true, false])
  dispose()
})

test('writeLocked 时 revision 变化不通知宿主', () => {
  const changes: number[] = []
  const adapter = {
    onDocumentChange: () => { changes.push(Date.now()) },
  } as unknown as HostAdapter<DirectorDocument>
  const open = (readOnly: boolean) => {
    const model = new DirectorDoc()
    model.replace(makeEmptyDraft('sync-lock', 24, 120))
    const session = new StudioSession(
      engineStub(),
      model,
      new EditorStore('sync-lock'),
      new History(),
      adapter,
      { readOnly },
    )
    return { model, sync: new DocumentSync(session) }
  }

  const locked = open(true)
  locked.model.touch()
  assert.equal(changes.length, 0)
  locked.sync.dispose()

  const unlocked = open(false)
  unlocked.model.touch()
  assert.equal(changes.length, 1)
  unlocked.sync.dispose()
})

test('hostReadOnly 只阻止草稿写入，仍允许选择和面板浏览', () => {
  const documentId = 'host-read-only'
  const model = new DirectorDoc()
  const doc = makeEmptyDraft(documentId, 24, 120, {
    fov: 35,
    position: { x: 0, y: 1.6, z: 4 },
    rotation: { x: 0, y: 0, z: 0 },
    lookAt: { x: 0, y: 1, z: 0 },
  })
  model.replace(doc)
  const session = new StudioSession(
    engineStub(),
    model,
    new EditorStore(documentId),
    new History(),
    {} as HostAdapter<DirectorDocument>,
    { readOnly: true },
  )
  assert.equal(session.hostReadOnly, true)
  assert.equal(session.writeLocked, true)
  const camera = doc.content.nodes.find((node) => node.type === 'camera')
  if (!camera) throw new Error('测试草稿缺少默认相机')
  const lockedRevision = model.revision
  const inspectorOpen = session.inspectorOpen

  session.select({ kind: 'node', nodeId: camera.id })
  session.toggleInspector()
  session.setPxPerFrame(3)

  assert.equal(session.selection?.kind, 'node')
  assert.equal(session.inspectorOpen, !inspectorOpen)
  assert.equal(session.pxPerFrame, 3)

  session.undo()
  session.setAspectRatio('9:16')
  session.setTimelineRange(10, 90)
  session.updateEnvironment({ skyColor: '#ffffff' })
  session.setNodeFlags(camera.id, { visible: false })
  session.writeNodeTransform(camera.id, { position: { x: 9, y: 9, z: 9 } })
  session.addPrimitive('blocked', 'cube', { width: 1, height: 1, depth: 1 })
  session.deleteNode(camera.id)

  assert.equal(JSON.stringify(model.snapshot), JSON.stringify(doc))
  assert.equal(model.revision, lockedRevision)
})

test('hydrating 时改节点 id 不 addRuntimeNode', async () => {
  const added: string[] = []
  const engine = {
    ...engineStub(),
    ready: true,
    addRuntimeNode: async (node: { id: string }) => { added.push(node.id) },
  } as unknown as DirectorEngine
  const model = new DirectorDoc()
  const draft = makeEmptyDraft('sync-hydrate', 24, 120, {
    fov: 35,
    position: { x: 0, y: 1.6, z: 4 },
    rotation: { x: 0, y: 0, z: 0 },
    lookAt: { x: 0, y: 1, z: 0 },
  })
  model.replace(draft)
  const session = new StudioSession(
    engine,
    model,
    new EditorStore('sync-hydrate'),
    new History(),
    {} as HostAdapter<DirectorDocument>,
  )
  const sync = new DocumentSync(session)
  session.hydrating = true
  const live = model.toContract()
  if (!live) throw new Error('expected draft')
  live.content.nodes.push({
    id: 'prop_hydrate',
    type: 'prop',
    name: 'hydrate',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  })
  model.touch()
  await Promise.resolve()
  assert.equal(added.length, 0)
  sync.dispose()
})
