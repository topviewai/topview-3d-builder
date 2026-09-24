import assert from 'node:assert/strict'
import { test } from 'vitest'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument, EditSequence, EditSequenceClip } from '../../contract/types'
import { parseDirectorDocument } from '../../contract/validate'
import { getEditorial, validateEditorial } from '../editSequence'
import {
  activateSequence,
  allocateClipId,
  allocateSequenceId,
  clearSequenceClips,
  clipSequenceSpan,
  createSequence,
  defaultInsertRange,
  deleteEditClip,
  deleteSequence,
  duplicateEditClip,
  duplicateSequence,
  findEditClip,
  insertEditClip,
  materializeEditorial,
  moveEditClip,
  playbackIssues,
  renameSequence,
  updateEditClip,
} from '../editSequenceOps'
import { loadDraft } from './helpers'

const CAM = {
  fov: 50,
  position: { x: 0, y: 1.7, z: 5 },
  rotation: { x: 0, y: 0, z: 0 },
  lookAt: { x: 0, y: 1.2, z: 0 },
}

function emptyDoc(totalFrames = 100): DirectorDocument {
  return makeEmptyDraft('edit-ops', 30, totalFrames, CAM)
}

function clip(
  id: string,
  cameraNodeId: string,
  sourceFrameStart: number,
  sourceFrameEnd: number,
): EditSequenceClip {
  return { id, cameraNodeId, sourceFrameStart, sourceFrameEnd }
}

function sequence(id: string, clips: EditSequenceClip[], name?: string): EditSequence {
  return name ? { id, name, clips } : { id, clips }
}

function withSequences(sequences: EditSequence[], totalFrames = 100): DirectorDocument {
  const doc = emptyDoc(totalFrames)
  doc.content.editorial = {
    version: 1,
    activeSequenceId: sequences[0]?.id ?? 'missing',
    sequences,
  }
  return doc
}

function mustOk<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  assert.equal(result.ok, true, JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}

test('旧草稿首次 materialize 不回写原文稿', () => {
  const parsed = parseDirectorDocument(loadDraft('xiaoyunque-draft.json'))
  assert.equal(parsed.content.editorial, undefined)
  const editorial = materializeEditorial(parsed)
  assert.equal(editorial.sequences.length, 1)
  assert.equal(parsed.content.editorial, undefined)
})

test('首次插入才物化 editorial，并分配碰撞安全 ID', () => {
  const parsed = parseDirectorDocument(loadDraft('xiaoyunque-draft.json'))
  parsed.content.nodes.push({
    id: 'camera_ops',
    type: 'camera',
    name: '机位',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 1, z: 4 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    camera: {
      projection: 'perspective',
      fov: 40,
      fovAxis: 'vertical',
      near: 0.1,
      far: 2000,
      isPrimary: false,
      lookAt: { x: 0, y: 1, z: 0 },
    },
  })
  const result = mustOk(insertEditClip(parsed, {
    sequenceId: 'sequence_1',
    cameraNodeId: 'camera_ops',
    sourceFrameStart: 0,
    sourceFrameEnd: 1,
  }))
  assert.equal(parsed.content.editorial, undefined)
  assert.equal(result.editorial.sequences[0].clips.length, 1)
  assert.match(result.createdId ?? '', /^edit_clip_/)
  assert.equal(result.editorial.sequences[0].clips[0].id, result.createdId)
})

test('全局 clip ID 唯一，同源重复引用生成新 ID', () => {
  const doc = emptyDoc()
  const first = mustOk(insertEditClip(doc, {
    sequenceId: 'sequence_1',
    cameraNodeId: 'camera_1',
    sourceFrameStart: 10,
    sourceFrameEnd: 19,
  }))
  doc.content.editorial = first.editorial
  const second = mustOk(duplicateEditClip(doc, first.createdId!))
  const ids = second.editorial.sequences[0].clips.map((item) => item.id)
  assert.equal(new Set(ids).size, 2)
  assert.deepEqual(
    second.editorial.sequences[0].clips.map((item) => [
      item.cameraNodeId,
      item.sourceFrameStart,
      item.sourceFrameEnd,
    ]),
    [
      ['camera_1', 10, 19],
      ['camera_1', 10, 19],
    ],
  )
})

test('版本 CRUD：新建、重命名、复制、激活、邻接删除', () => {
  const doc = emptyDoc()
  const created = mustOk(createSequence(doc, { name: '  Trailer  ' }))
  assert.equal(created.editorial.activeSequenceId, created.createdId)
  assert.equal(created.editorial.sequences[1].name, 'Trailer')

  doc.content.editorial = created.editorial
  const renamed = mustOk(renameSequence(doc, created.createdId!, '  '))
  assert.equal('name' in renamed.editorial.sequences[1], false)

  doc.content.editorial = renamed.editorial
  const duplicated = mustOk(duplicateSequence(doc, 'sequence_1'))
  assert.notEqual(duplicated.createdId, 'sequence_1')
  assert.equal(duplicated.editorial.sequences.length, 3)
  assert.equal(duplicated.editorial.activeSequenceId, duplicated.createdId)

  doc.content.editorial = duplicated.editorial
  const activated = mustOk(activateSequence(doc, created.createdId!))
  assert.equal(activated.editorial.activeSequenceId, created.createdId)

  doc.content.editorial = activated.editorial
  const deleted = mustOk(deleteSequence(doc, created.createdId!))
  assert.equal(deleted.editorial.sequences.some((item) => item.id === created.createdId), false)
  assert.equal(deleted.editorial.sequences.some((item) => item.id === deleted.editorial.activeSequenceId), true)

  doc.content.editorial = {
    version: 1,
    activeSequenceId: 'sequence_1',
    sequences: [sequence('sequence_1', [])],
  }
  const last = deleteSequence(doc, 'sequence_1')
  assert.equal(last.ok, false)
  if (!last.ok) assert.equal(last.error, 'last-sequence')
  const cleared = mustOk(clearSequenceClips(doc, 'sequence_1'))
  assert.equal(cleared.editorial.sequences[0].clips.length, 0)
})

test('复制版本会为版本和全部 clip 分配新 ID', () => {
  const doc = withSequences([
    sequence('sequence_1', [
      clip('edit_clip_a', 'camera_1', 0, 2),
      clip('edit_clip_b', 'camera_1', 3, 5),
    ], 'Main'),
  ])
  const copied = mustOk(duplicateSequence(doc, 'sequence_1'))
  const source = copied.editorial.sequences[0]
  const target = copied.editorial.sequences[1]
  assert.notEqual(target.id, source.id)
  assert.equal(target.name, 'Main')
  assert.equal(target.clips.length, 2)
  assert.notEqual(target.clips[0].id, source.clips[0].id)
  assert.notEqual(target.clips[1].id, source.clips[1].id)
  assert.deepEqual(
    target.clips.map((item) => [item.cameraNodeId, item.sourceFrameStart, item.sourceFrameEnd]),
    source.clips.map((item) => [item.cameraNodeId, item.sourceFrameStart, item.sourceFrameEnd]),
  )
})

test('单帧、边界帧和默认插入范围合法', () => {
  const doc = emptyDoc(12)
  const single = mustOk(insertEditClip(doc, {
    sequenceId: 'sequence_1',
    cameraNodeId: 'camera_1',
    sourceFrameStart: 0,
    sourceFrameEnd: 0,
  }))
  assert.equal(single.editorial.sequences[0].clips[0].sourceFrameEnd, 0)
  doc.content.editorial = single.editorial
  const edge = mustOk(insertEditClip(doc, {
    sequenceId: 'sequence_1',
    cameraNodeId: 'camera_1',
    sourceFrameStart: 12,
    sourceFrameEnd: 12,
  }))
  assert.equal(edge.editorial.sequences[0].clips[1].sourceFrameStart, 12)
  assert.deepEqual(defaultInsertRange(doc, 11, 60), {
    sourceFrameStart: 0,
    sourceFrameEnd: 12,
  })
  assert.deepEqual(defaultInsertRange(emptyDoc(100), 90, 30), {
    sourceFrameStart: 71,
    sourceFrameEnd: 100,
  })
  assert.deepEqual(defaultInsertRange(emptyDoc(100), 101, 30), {
    sourceFrameStart: 71,
    sourceFrameEnd: 100,
  })
  assert.equal(insertEditClip(doc, {
    sequenceId: 'sequence_1',
    cameraNodeId: 'camera_1',
    sourceFrameStart: 0,
    sourceFrameEnd: 13,
  }).ok, false)
})

test('换序、更新、查找与成片跨度', () => {
  const doc = withSequences([
    sequence('sequence_1', [
      clip('c1', 'camera_1', 0, 9),
      clip('c2', 'camera_1', 10, 14),
      clip('c3', 'camera_1', 20, 20),
    ]),
  ])
  const moved = mustOk(moveEditClip(doc, 'c3', 0))
  assert.deepEqual(moved.editorial.sequences[0].clips.map((item) => item.id), ['c3', 'c1', 'c2'])
  doc.content.editorial = moved.editorial
  const updated = mustOk(updateEditClip(doc, 'c1', { sourceFrameStart: 1, sourceFrameEnd: 8 }))
  assert.deepEqual(updated.editorial.sequences[0].clips[1], {
    id: 'c1',
    cameraNodeId: 'camera_1',
    sourceFrameStart: 1,
    sourceFrameEnd: 8,
  })
  const found = findEditClip(updated.editorial, 'c2')
  assert.equal(found?.clipIndex, 2)
  assert.deepEqual(clipSequenceSpan(updated.editorial.sequences[0].clips, 1), {
    sequenceStart: 1,
    duration: 8,
  })
  doc.content.editorial = updated.editorial
  const removed = mustOk(deleteEditClip(doc, 'c3'))
  assert.deepEqual(removed.editorial.sequences[0].clips.map((item) => item.id), ['c1', 'c2'])
})

test('写路径拒绝失效相机，已有 dangling 只报告不自动删除', () => {
  const doc = withSequences([
    sequence('sequence_1', [clip('c1', 'gone_cam', 0, 4)]),
  ])
  assert.equal(updateEditClip(doc, 'c1', { cameraNodeId: 'gone_cam' }).ok, false)
  assert.equal(insertEditClip(doc, {
    sequenceId: 'sequence_1',
    cameraNodeId: 'gone_cam',
    sourceFrameStart: 0,
    sourceFrameEnd: 1,
  }).ok, false)
  assert.equal(doc.content.editorial?.sequences[0].clips[0].id, 'c1')
  assert.ok(validateEditorial(doc).some((issue) => issue.code === 'missing-camera'))
})

test('时间轴收缩后越界 clip 只报告，不自动裁剪', () => {
  const doc = withSequences([
    sequence('sequence_1', [clip('c1', 'camera_1', 0, 80)]),
  ], 40)
  const issues = validateEditorial(doc)
  assert.ok(issues.some((issue) => issue.code === 'out-of-timeline'))
  assert.equal(doc.content.editorial?.sequences[0].clips[0].sourceFrameEnd, 80)
})

test('显式 sequence 预检忽略坏 active 指针', () => {
  const doc = withSequences([
    sequence('playable', [clip('c1', 'camera_1', 0, 4)]),
    sequence('other', []),
  ])
  doc.content.editorial!.activeSequenceId = 'missing'
  const all = validateEditorial(doc)
  assert.ok(all.some((issue) => issue.code === 'active-sequence-missing'))
  assert.deepEqual(playbackIssues(doc, 'playable'), [])
  assert.ok(playbackIssues(doc, 'other').some((issue) => issue.code === 'empty-sequence'))
})

test('分配器避开已占用 ID', () => {
  const editorial = getEditorial(emptyDoc())
  editorial.sequences[0].id = 'sequence_occupied'
  editorial.sequences[0].clips.push(clip('edit_clip_occupied', 'camera_1', 0, 1))
  assert.notEqual(allocateSequenceId(editorial), 'sequence_occupied')
  assert.notEqual(allocateClipId(editorial), 'edit_clip_occupied')
})
