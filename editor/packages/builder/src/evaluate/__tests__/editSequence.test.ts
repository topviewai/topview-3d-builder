import assert from 'node:assert/strict'
import { test } from 'vitest'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type {
  DirectorDocument,
  EditSequence,
  EditSequenceClip,
} from '../../contract/types'
import { parseDirectorDocument } from '../../contract/validate'
import {
  getEditorial,
  getEditSequence,
  getEditSequenceDurationFrames,
  resolveEditSequenceFrame,
  validateEditorial,
} from '../editSequence'
import { evalAt, loadDraft, sceneOf } from './helpers'

const CAM = {
  fov: 50,
  position: { x: 0, y: 1.7, z: 5 },
  rotation: { x: 0, y: 0, z: 0 },
  lookAt: { x: 0, y: 1.2, z: 0 },
}

function emptyDoc(totalFrames = 100): DirectorDocument {
  return makeEmptyDraft('edit-seq', 30, totalFrames, CAM)
}

function clip(
  id: string,
  cameraNodeId: string,
  sourceFrameStart: number,
  sourceFrameEnd: number,
): EditSequenceClip {
  return { id, cameraNodeId, sourceFrameStart, sourceFrameEnd }
}

function sequence(id: string, clips: EditSequenceClip[]): EditSequence {
  return { id, clips }
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

test('旧草稿没有 editorial 仍可解析，求值提供默认空序列且不回写', () => {
  const parsed = parseDirectorDocument(loadDraft('xiaoyunque-draft.json'))
  assert.equal(parsed.content.editorial, undefined)
  assert.deepEqual(getEditorial(parsed), {
    version: 1,
    activeSequenceId: 'sequence_1',
    sequences: [{ id: 'sequence_1', clips: [] }],
  })
  assert.equal(parsed.content.editorial, undefined)
  assert.equal(getEditSequenceDurationFrames(getEditSequence(parsed, 'sequence_1')!.clips), 0)
  assert.equal(resolveEditSequenceFrame([], 0), null)
})

test('makeEmptyDraft 显式初始化一条激活的空成片', () => {
  const doc = emptyDoc()
  assert.deepEqual(doc.content.editorial, {
    version: 1,
    activeSequenceId: 'sequence_1',
    sequences: [{ id: 'sequence_1', clips: [] }],
  })
  parseDirectorDocument(doc)
})

test('Zod 拒绝倒置源区间，passthrough 保留未知字段', () => {
  const inverted = withSequences([
    sequence('sequence_1', [clip('c1', 'camera_1', 10, 4)]),
  ])
  assert.throws(() => parseDirectorDocument(inverted))

  const extra = emptyDoc()
  extra.content.editorial = {
    version: 1,
    activeSequenceId: 'sequence_1',
    sequences: [{
      id: 'sequence_1',
      clips: [{
        id: 'c1',
        cameraNodeId: 'camera_1',
        sourceFrameStart: 0,
        sourceFrameEnd: 9,
        label: 'keep',
      } as EditSequenceClip],
      note: 'keep-sequence',
    } as EditSequence],
  }
  ;(extra.content.editorial as unknown as { note: string }).note = 'keep-editorial'
  const parsed = parseDirectorDocument(extra)
  assert.equal((parsed.content.editorial as { note?: string }).note, 'keep-editorial')
  assert.equal(
    (parsed.content.editorial!.sequences[0] as { note?: string }).note,
    'keep-sequence',
  )
  assert.equal(
    (parsed.content.editorial!.sequences[0].clips[0] as { label?: string }).label,
    'keep',
  )
})

test('Zod 要求 editorial 至少一条序列，并拒绝纯空白可选名称', () => {
  const noSequences = emptyDoc()
  noSequences.content.editorial = {
    version: 1,
    activeSequenceId: 'sequence_1',
    sequences: [],
  }
  assert.throws(() => parseDirectorDocument(noSequences))

  const blankName = emptyDoc()
  blankName.content.editorial!.sequences[0].name = '   '
  assert.throws(() => parseDirectorDocument(blankName))
})

test('时长与边界映射：单帧、切点、末帧、越界', () => {
  const clips = [
    clip('a', 'camera_1', 5, 5),
    clip('b', 'camera_1', 10, 19),
    clip('c', 'camera_1', 20, 21),
  ]
  assert.equal(getEditSequenceDurationFrames(clips), 1 + 10 + 2)

  assert.deepEqual(resolveEditSequenceFrame(clips, 0), {
    clipId: 'a',
    cameraNodeId: 'camera_1',
    sourceFrame: 5,
    clipIndex: 0,
    clipLocalFrame: 0,
  })
  assert.deepEqual(resolveEditSequenceFrame(clips, 1), {
    clipId: 'b',
    cameraNodeId: 'camera_1',
    sourceFrame: 10,
    clipIndex: 1,
    clipLocalFrame: 0,
  })
  assert.deepEqual(resolveEditSequenceFrame(clips, 10), {
    clipId: 'b',
    cameraNodeId: 'camera_1',
    sourceFrame: 19,
    clipIndex: 1,
    clipLocalFrame: 9,
  })
  assert.deepEqual(resolveEditSequenceFrame(clips, 11), {
    clipId: 'c',
    cameraNodeId: 'camera_1',
    sourceFrame: 20,
    clipIndex: 2,
    clipLocalFrame: 0,
  })
  assert.deepEqual(resolveEditSequenceFrame(clips, 12), {
    clipId: 'c',
    cameraNodeId: 'camera_1',
    sourceFrame: 21,
    clipIndex: 2,
    clipLocalFrame: 1,
  })
  assert.equal(resolveEditSequenceFrame(clips, 13), null)
  assert.equal(resolveEditSequenceFrame(clips, -1), null)
  assert.equal(resolveEditSequenceFrame(clips, 1.5), null)
})

test('同源段 / 同机位可重复，按数组顺序映射', () => {
  const clips = [
    clip('first', 'camera_1', 0, 2),
    clip('second', 'camera_1', 0, 2),
  ]
  assert.equal(getEditSequenceDurationFrames(clips), 6)
  assert.equal(resolveEditSequenceFrame(clips, 0)?.clipId, 'first')
  assert.equal(resolveEditSequenceFrame(clips, 2)?.sourceFrame, 2)
  assert.deepEqual(resolveEditSequenceFrame(clips, 3), {
    clipId: 'second',
    cameraNodeId: 'camera_1',
    sourceFrame: 0,
    clipIndex: 1,
    clipLocalFrame: 0,
  })
})

test('多条成片按 id 显式读取，activeSequenceId 只决定默认编辑版本', () => {
  const doc = withSequences([
    sequence('director-cut', [clip('clip_a', 'camera_1', 0, 9)]),
    sequence('trailer', [clip('clip_b', 'camera_1', 20, 29)]),
  ])
  doc.content.editorial!.activeSequenceId = 'trailer'
  assert.equal(getEditSequence(doc, 'director-cut')?.clips[0].sourceFrameStart, 0)
  assert.equal(getEditSequence(doc, 'trailer')?.clips[0].sourceFrameStart, 20)
  assert.equal(getEditSequence(doc, 'missing'), null)
})

test('领域校验：空序列、激活指针、缺相机、越界、重复 ID 和非法帧不改草稿', () => {
  const empty = emptyDoc()
  assert.deepEqual(validateEditorial(empty), [])
  assert.deepEqual(
    validateEditorial(empty, {
      sequenceId: 'sequence_1',
      requireClips: true,
    }).map((issue) => issue.code),
    ['empty-sequence'],
  )
  assert.deepEqual(
    validateEditorial(empty, { sequenceId: 'missing' }).map((issue) => issue.code),
    ['missing-sequence'],
  )

  const broken = withSequences([
    sequence('same', [
      clip('duplicate', 'camera_gone', 0, 9),
      clip('out', 'camera_1', 200, 210),
    ]),
    sequence('same', [
      clip('duplicate', 'camera_1', 10, 11),
      { id: 'frac', cameraNodeId: 'camera_1', sourceFrameStart: 1.5, sourceFrameEnd: 3 },
      clip('inv', 'camera_1', 8, 3),
    ]),
  ])
  broken.content.editorial!.activeSequenceId = 'missing'
  const before = JSON.stringify(broken)
  const issues = validateEditorial(broken)
  const codes = issues.map((issue) => issue.code)
  assert.ok(codes.includes('duplicate-sequence-id'))
  assert.ok(codes.includes('active-sequence-missing'))
  assert.ok(codes.includes('duplicate-clip-id'))
  assert.ok(codes.includes('missing-camera'))
  assert.ok(codes.includes('out-of-timeline'))
  assert.ok(codes.includes('non-integer-frame'))
  assert.ok(codes.includes('inverted-range'))
  assert.equal(JSON.stringify(broken), before)
  assert.equal(
    broken.content.editorial!.sequences[0].clips[0].cameraNodeId,
    'camera_gone',
  )
})

test('evaluateFrame 完全不读 editorial', () => {
  const plain = emptyDoc()
  const withEditorial = emptyDoc()
  withEditorial.content.editorial = {
    version: 1,
    activeSequenceId: 'sequence_1',
    sequences: [sequence('sequence_1', [clip('c1', 'camera_1', 0, 9)])],
  }
  assert.deepEqual(evalAt(sceneOf(plain), 0).camera, evalAt(sceneOf(withEditorial), 0).camera)
})

test('多机位硬切：切点属于后一 clip，首末帧都存在', () => {
  const clips = [
    clip('wide', 'camera_1', 0, 2),
    clip('close', 'camera_2', 10, 11),
  ]
  assert.equal(getEditSequenceDurationFrames(clips), 5)
  assert.deepEqual(resolveEditSequenceFrame(clips, 0), {
    clipId: 'wide',
    cameraNodeId: 'camera_1',
    sourceFrame: 0,
    clipIndex: 0,
    clipLocalFrame: 0,
  })
  assert.deepEqual(resolveEditSequenceFrame(clips, 3), {
    clipId: 'close',
    cameraNodeId: 'camera_2',
    sourceFrame: 10,
    clipIndex: 1,
    clipLocalFrame: 0,
  })
  assert.deepEqual(resolveEditSequenceFrame(clips, 4), {
    clipId: 'close',
    cameraNodeId: 'camera_2',
    sourceFrame: 11,
    clipIndex: 1,
    clipLocalFrame: 1,
  })
})
