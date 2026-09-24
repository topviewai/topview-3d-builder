import type {
  DirectorDocument,
  EditorialData,
  EditSequence,
  EditSequenceClip,
} from '../contract/types'
import {
  getClipDurationFrames,
  getEditorial,
  type EditSequenceIssue,
  validateEditorial,
} from './editSequence'

export type EditOpError =
  | 'no-document'
  | 'missing-editorial'
  | 'missing-sequence'
  | 'missing-clip'
  | 'last-sequence'
  | 'duplicate-id'
  | 'invalid-name'
  | 'invalid-index'
  | 'invalid-camera'
  | 'invalid-range'
  | 'active-sequence-missing'

export type EditOpResult =
  | { ok: true; editorial: EditorialData; createdId?: string }
  | { ok: false; error: EditOpError; issues?: EditSequenceIssue[] }

export interface FoundEditClip {
  sequence: EditSequence
  sequenceIndex: number
  clipIndex: number
}

export interface ClipSequenceSpan {
  sequenceStart: number
  duration: number
}

const PLAYBACK_BLOCKING = new Set<EditSequenceIssue['code']>([
  'empty-editorial',
  'missing-sequence',
  'empty-sequence',
  'duplicate-sequence-id',
  'duplicate-clip-id',
  'missing-camera',
  'non-integer-frame',
  'inverted-range',
  'out-of-timeline',
])

function cloneEditorial(editorial: EditorialData): EditorialData {
  return JSON.parse(JSON.stringify(editorial)) as EditorialData
}

export function emptyEditorial(): EditorialData {
  return {
    version: 1,
    activeSequenceId: 'sequence_1',
    sequences: [{ id: 'sequence_1', clips: [] }],
  }
}

export function materializeEditorial(document: DirectorDocument): EditorialData {
  return document.content.editorial
    ? cloneEditorial(document.content.editorial)
    : emptyEditorial()
}

function rand6(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, '0')
}

function uniqueId(used: Set<string>, prefix: string): string {
  for (let i = 0; i < 32; i++) {
    const id = `${prefix}_${Date.now().toString(36)}_${rand6()}`
    if (!used.has(id)) return id
  }
  throw new Error(`unable to allocate unique id with prefix ${prefix}`)
}

function collectIds(editorial: EditorialData): { sequences: Set<string>; clips: Set<string> } {
  const sequences = new Set<string>()
  const clips = new Set<string>()
  for (const sequence of editorial.sequences) {
    sequences.add(sequence.id)
    for (const clip of sequence.clips) clips.add(clip.id)
  }
  return { sequences, clips }
}

function hasDuplicateIds(editorial: EditorialData): boolean {
  const sequences = new Set<string>()
  const clips = new Set<string>()
  for (const sequence of editorial.sequences) {
    if (sequences.has(sequence.id)) return true
    sequences.add(sequence.id)
    for (const clip of sequence.clips) {
      if (clips.has(clip.id)) return true
      clips.add(clip.id)
    }
  }
  return false
}

export function allocateSequenceId(editorial: EditorialData): string {
  return uniqueId(collectIds(editorial).sequences, 'sequence')
}

export function allocateClipId(editorial: EditorialData): string {
  return uniqueId(collectIds(editorial).clips, 'edit_clip')
}

export function findEditClip(editorial: EditorialData, clipId: string): FoundEditClip | null {
  for (let sequenceIndex = 0; sequenceIndex < editorial.sequences.length; sequenceIndex++) {
    const sequence = editorial.sequences[sequenceIndex]
    const clipIndex = sequence.clips.findIndex((clip) => clip.id === clipId)
    if (clipIndex >= 0) return { sequence, sequenceIndex, clipIndex }
  }
  return null
}

export function getActiveEditSequence(document: DirectorDocument): EditSequence | null {
  const editorial = getEditorial(document)
  return editorial.sequences.find((sequence) => sequence.id === editorial.activeSequenceId) ?? null
}

export function clipSequenceSpan(
  clips: readonly EditSequenceClip[],
  index: number,
): ClipSequenceSpan | null {
  if (index < 0 || index >= clips.length) return null
  let sequenceStart = 0
  for (let i = 0; i < index; i++) {
    const duration = getClipDurationFrames(clips[i])
    if (duration > 0) sequenceStart += duration
  }
  return { sequenceStart, duration: Math.max(0, getClipDurationFrames(clips[index])) }
}

export function playbackIssues(document: DirectorDocument, sequenceId: string): EditSequenceIssue[] {
  return validateEditorial(document, { sequenceId, requireClips: true }).filter(
    (issue) => issue.code !== 'active-sequence-missing' && PLAYBACK_BLOCKING.has(issue.code),
  )
}

function fail(error: EditOpError, issues?: EditSequenceIssue[]): EditOpResult {
  return issues ? { ok: false, error, issues } : { ok: false, error }
}

function ok(editorial: EditorialData, createdId?: string): EditOpResult {
  return createdId ? { ok: true, editorial, createdId } : { ok: true, editorial }
}

function requireEditorial(document: DirectorDocument | null): EditOpResult | EditorialData {
  if (!document) return fail('no-document')
  const editorial = materializeEditorial(document)
  if (hasDuplicateIds(editorial)) return fail('duplicate-id')
  return editorial
}

function normalizeName(name: string | null | undefined): string | undefined {
  if (name == null) return undefined
  const trimmed = name.trim()
  return trimmed || undefined
}

function isCamera(document: DirectorDocument, cameraNodeId: string): boolean {
  return document.content.nodes.some((node) => node.id === cameraNodeId && node.type === 'camera')
}

function normalizeRange(
  document: DirectorDocument,
  start: number,
  end: number,
): { sourceFrameStart: number; sourceFrameEnd: number } | null {
  const sourceFrameStart = Math.round(start)
  const sourceFrameEnd = Math.round(end)
  const { frameStart, frameEnd } = document.content.timeline
  if (
    !Number.isInteger(sourceFrameStart) ||
    !Number.isInteger(sourceFrameEnd) ||
    sourceFrameEnd < sourceFrameStart ||
    sourceFrameStart < frameStart ||
    sourceFrameEnd > frameEnd
  ) {
    return null
  }
  return { sourceFrameStart, sourceFrameEnd }
}

export function createSequence(
  document: DirectorDocument,
  input: { name?: string; activate?: boolean } = {},
): EditOpResult {
  const editorial = requireEditorial(document)
  if (!('sequences' in editorial)) return editorial
  const name = normalizeName(input.name)
  const id = allocateSequenceId(editorial)
  const sequence: EditSequence = { id, clips: [] }
  if (typeof name === 'string') sequence.name = name
  editorial.sequences.push(sequence)
  if (input.activate !== false) editorial.activeSequenceId = id
  return ok(editorial, id)
}

export function renameSequence(
  document: DirectorDocument,
  sequenceId: string,
  name: string | null,
): EditOpResult {
  const editorial = requireEditorial(document)
  if (!('sequences' in editorial)) return editorial
  const sequence = editorial.sequences.find((item) => item.id === sequenceId)
  if (!sequence) return fail('missing-sequence')
  const next = normalizeName(name)
  if (typeof next === 'string') sequence.name = next
  else delete sequence.name
  return ok(editorial)
}

export function duplicateSequence(
  document: DirectorDocument,
  sequenceId: string,
  input: { activate?: boolean } = {},
): EditOpResult {
  const editorial = requireEditorial(document)
  if (!('sequences' in editorial)) return editorial
  const index = editorial.sequences.findIndex((item) => item.id === sequenceId)
  if (index < 0) return fail('missing-sequence')
  const source = editorial.sequences[index]
  const copy = JSON.parse(JSON.stringify(source)) as EditSequence
  copy.id = allocateSequenceId(editorial)
  editorial.sequences.splice(index + 1, 0, copy)
  copy.clips = source.clips.map((clip) => ({
    ...(JSON.parse(JSON.stringify(clip)) as EditSequenceClip),
    id: allocateClipId(editorial),
  }))
  if (input.activate !== false) editorial.activeSequenceId = copy.id
  return ok(editorial, copy.id)
}

export function deleteSequence(document: DirectorDocument, sequenceId: string): EditOpResult {
  const editorial = requireEditorial(document)
  if (!('sequences' in editorial)) return editorial
  const index = editorial.sequences.findIndex((item) => item.id === sequenceId)
  if (index < 0) return fail('missing-sequence')
  if (editorial.sequences.length === 1) return fail('last-sequence')
  editorial.sequences.splice(index, 1)
  if (editorial.activeSequenceId === sequenceId) {
    const neighbor = editorial.sequences[Math.max(0, index - 1)]
    editorial.activeSequenceId = neighbor.id
  }
  return ok(editorial)
}

export function activateSequence(document: DirectorDocument, sequenceId: string): EditOpResult {
  const editorial = requireEditorial(document)
  if (!('sequences' in editorial)) return editorial
  if (!editorial.sequences.some((item) => item.id === sequenceId)) {
    return fail('missing-sequence')
  }
  editorial.activeSequenceId = sequenceId
  return ok(editorial)
}

export function clearSequenceClips(document: DirectorDocument, sequenceId: string): EditOpResult {
  const editorial = requireEditorial(document)
  if (!('sequences' in editorial)) return editorial
  const sequence = editorial.sequences.find((item) => item.id === sequenceId)
  if (!sequence) return fail('missing-sequence')
  sequence.clips = []
  return ok(editorial)
}

export function insertEditClip(
  document: DirectorDocument,
  input: {
    sequenceId: string
    cameraNodeId: string
    sourceFrameStart: number
    sourceFrameEnd: number
    index?: number
  },
): EditOpResult {
  const editorial = requireEditorial(document)
  if (!('sequences' in editorial)) return editorial
  const sequence = editorial.sequences.find((item) => item.id === input.sequenceId)
  if (!sequence) return fail('missing-sequence')
  if (!isCamera(document, input.cameraNodeId)) return fail('invalid-camera')
  const range = normalizeRange(document, input.sourceFrameStart, input.sourceFrameEnd)
  if (!range) return fail('invalid-range')
  const index = input.index ?? sequence.clips.length
  if (!Number.isInteger(index) || index < 0 || index > sequence.clips.length) {
    return fail('invalid-index')
  }
  const clip: EditSequenceClip = {
    id: allocateClipId(editorial),
    cameraNodeId: input.cameraNodeId,
    ...range,
  }
  sequence.clips.splice(index, 0, clip)
  return ok(editorial, clip.id)
}

export function updateEditClip(
  document: DirectorDocument,
  clipId: string,
  patch: Partial<Pick<EditSequenceClip, 'cameraNodeId' | 'sourceFrameStart' | 'sourceFrameEnd'>>,
): EditOpResult {
  const editorial = requireEditorial(document)
  if (!('sequences' in editorial)) return editorial
  const found = findEditClip(editorial, clipId)
  if (!found) return fail('missing-clip')
  const clip = found.sequence.clips[found.clipIndex]
  const cameraNodeId = patch.cameraNodeId ?? clip.cameraNodeId
  if (patch.cameraNodeId !== undefined && !isCamera(document, cameraNodeId)) {
    return fail('invalid-camera')
  }
  const range = normalizeRange(
    document,
    patch.sourceFrameStart ?? clip.sourceFrameStart,
    patch.sourceFrameEnd ?? clip.sourceFrameEnd,
  )
  if (!range) return fail('invalid-range')
  found.sequence.clips[found.clipIndex] = { ...clip, cameraNodeId, ...range }
  return ok(editorial)
}

export function moveEditClip(
  document: DirectorDocument,
  clipId: string,
  toIndex: number,
): EditOpResult {
  const editorial = requireEditorial(document)
  if (!('sequences' in editorial)) return editorial
  const found = findEditClip(editorial, clipId)
  if (!found) return fail('missing-clip')
  const clips = found.sequence.clips
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= clips.length) {
    return fail('invalid-index')
  }
  if (toIndex === found.clipIndex) return ok(editorial)
  const [moved] = clips.splice(found.clipIndex, 1)
  clips.splice(toIndex, 0, moved)
  return ok(editorial)
}

export function duplicateEditClip(
  document: DirectorDocument,
  clipId: string,
  input: { index?: number } = {},
): EditOpResult {
  const editorial = requireEditorial(document)
  if (!('sequences' in editorial)) return editorial
  const found = findEditClip(editorial, clipId)
  if (!found) return fail('missing-clip')
  const source = found.sequence.clips[found.clipIndex]
  const index = input.index ?? found.clipIndex + 1
  if (!Number.isInteger(index) || index < 0 || index > found.sequence.clips.length) {
    return fail('invalid-index')
  }
  const copy = {
    ...JSON.parse(JSON.stringify(source)) as EditSequenceClip,
    id: allocateClipId(editorial),
  }
  found.sequence.clips.splice(index, 0, copy)
  return ok(editorial, copy.id)
}

export function deleteEditClip(document: DirectorDocument, clipId: string): EditOpResult {
  const editorial = requireEditorial(document)
  if (!('sequences' in editorial)) return editorial
  const found = findEditClip(editorial, clipId)
  if (!found) return fail('missing-clip')
  found.sequence.clips.splice(found.clipIndex, 1)
  return ok(editorial)
}

export function defaultInsertRange(
  document: DirectorDocument,
  sourceFrame: number,
  spanFrames = 60,
): { sourceFrameStart: number; sourceFrameEnd: number } {
  const { frameStart, frameEnd } = document.content.timeline
  const span = Math.max(1, Math.round(spanFrames))
  const preferredStart = Math.round(sourceFrame)
  const preferredEnd = preferredStart + span - 1
  if (preferredStart >= frameStart && preferredEnd <= frameEnd) {
    return { sourceFrameStart: preferredStart, sourceFrameEnd: preferredEnd }
  }
  // 后面不够长：按同样时长截机位尾巴，而不是缩成最后一帧
  if (preferredEnd > frameEnd) {
    return {
      sourceFrameStart: Math.max(frameStart, frameEnd - span + 1),
      sourceFrameEnd: frameEnd,
    }
  }
  return {
    sourceFrameStart: frameStart,
    sourceFrameEnd: Math.min(frameStart + span - 1, frameEnd),
  }
}
