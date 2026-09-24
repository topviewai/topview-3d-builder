import type {
  DirectorDocument,
  DraftNode,
  EditorialData,
  EditSequence,
  EditSequenceClip,
} from '../contract/types'

function emptyEditorial(): EditorialData {
  return {
    version: 1,
    activeSequenceId: 'sequence_1',
    sequences: [{ id: 'sequence_1', clips: [] }],
  }
}

export interface ResolvedEditSequenceFrame {
  clipId: string
  cameraNodeId: string
  sourceFrame: number
  clipIndex: number
  clipLocalFrame: number
}

export type EditSequenceIssueCode =
  | 'empty-editorial'
  | 'missing-sequence'
  | 'empty-sequence'
  | 'duplicate-sequence-id'
  | 'active-sequence-missing'
  | 'duplicate-clip-id'
  | 'missing-camera'
  | 'non-integer-frame'
  | 'inverted-range'
  | 'out-of-timeline'

export interface EditSequenceIssue {
  code: EditSequenceIssueCode
  sequenceId?: string
  clipId?: string
  message: string
}

export interface ValidateEditorialOptions {
  /** 只校验指定序列的 clip，并要求该序列存在；缺省时校验所有序列。 */
  sequenceId?: string
  /** 把校验范围内的空序列记为 issue。默认允许空序列处于编辑中。 */
  requireClips?: boolean
}

export function getEditorial(document: DirectorDocument): EditorialData {
  return document.content.editorial ?? emptyEditorial()
}

export function getEditSequence(document: DirectorDocument, sequenceId: string): EditSequence | null {
  return getEditorial(document).sequences.find((sequence) => sequence.id === sequenceId) ?? null
}

export function getClipDurationFrames(
  clip: Pick<EditSequenceClip, 'sourceFrameStart' | 'sourceFrameEnd'>,
): number {
  return clip.sourceFrameEnd - clip.sourceFrameStart + 1
}

export function getEditSequenceDurationFrames(clips: readonly EditSequenceClip[]): number {
  let total = 0
  for (const clip of clips) {
    const duration = getClipDurationFrames(clip)
    if (duration > 0) total += duration
  }
  return total
}

export function resolveEditSequenceFrame(
  clips: readonly EditSequenceClip[],
  sequenceFrame: number,
): ResolvedEditSequenceFrame | null {
  if (!Number.isInteger(sequenceFrame) || sequenceFrame < 0) return null
  let cursor = 0
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    const duration = getClipDurationFrames(clip)
    if (duration <= 0) continue
    if (sequenceFrame >= cursor && sequenceFrame < cursor + duration) {
      const clipLocalFrame = sequenceFrame - cursor
      return {
        clipId: clip.id,
        cameraNodeId: clip.cameraNodeId,
        sourceFrame: clip.sourceFrameStart + clipLocalFrame,
        clipIndex: i,
        clipLocalFrame,
      }
    }
    cursor += duration
  }
  return null
}

function collectCameraIds(nodes: readonly DraftNode[]): Set<string> {
  const ids = new Set<string>()
  for (const node of nodes) {
    if (node.type === 'camera') ids.add(node.id)
  }
  return ids
}

function validateClip(
  document: DirectorDocument,
  sequenceId: string,
  clip: EditSequenceClip,
  cameraIds: ReadonlySet<string>,
): EditSequenceIssue[] {
  const timeline = document.content.timeline
  const issues: EditSequenceIssue[] = []
  const details = { sequenceId, clipId: clip.id }
  if (!Number.isInteger(clip.sourceFrameStart) || !Number.isInteger(clip.sourceFrameEnd)) {
    issues.push({
      code: 'non-integer-frame',
      ...details,
      message: `clip ${clip.id} source frames must be integers`,
    })
  }
  if (clip.sourceFrameEnd < clip.sourceFrameStart) {
    issues.push({
      code: 'inverted-range',
      ...details,
      message: `clip ${clip.id} sourceFrameEnd < sourceFrameStart`,
    })
  }
  if (
    clip.sourceFrameStart < timeline.frameStart ||
    clip.sourceFrameEnd > timeline.frameEnd
  ) {
    issues.push({
      code: 'out-of-timeline',
      ...details,
      message: `clip ${clip.id} source range is outside timeline.frameStart..frameEnd`,
    })
  }
  if (!cameraIds.has(clip.cameraNodeId)) {
    issues.push({
      code: 'missing-camera',
      ...details,
      message: `clip ${clip.id} references missing camera ${clip.cameraNodeId}`,
    })
  }
  return issues
}

export function validateEditorial(
  document: DirectorDocument,
  options: ValidateEditorialOptions = {},
): EditSequenceIssue[] {
  const editorial = getEditorial(document)
  const issues: EditSequenceIssue[] = []
  if (editorial.sequences.length === 0) {
    return [{ code: 'empty-editorial', message: 'editorial.sequences is empty' }]
  }

  const sequenceIds = new Set<string>()
  for (const sequence of editorial.sequences) {
    if (sequenceIds.has(sequence.id)) {
      issues.push({
        code: 'duplicate-sequence-id',
        sequenceId: sequence.id,
        message: `duplicate sequence id ${sequence.id}`,
      })
    }
    sequenceIds.add(sequence.id)
  }
  if (!sequenceIds.has(editorial.activeSequenceId)) {
    issues.push({
      code: 'active-sequence-missing',
      sequenceId: editorial.activeSequenceId,
      message: `active sequence ${editorial.activeSequenceId} does not exist`,
    })
  }

  const clipIds = new Set<string>()
  for (const sequence of editorial.sequences) {
    for (const clip of sequence.clips) {
      if (clipIds.has(clip.id)) {
        issues.push({
          code: 'duplicate-clip-id',
          sequenceId: sequence.id,
          clipId: clip.id,
          message: `duplicate clip id ${clip.id}`,
        })
      }
      clipIds.add(clip.id)
    }
  }

  const sequences = options.sequenceId
    ? editorial.sequences.filter((sequence) => sequence.id === options.sequenceId)
    : editorial.sequences
  if (options.sequenceId && sequences.length === 0) {
    issues.push({
      code: 'missing-sequence',
      sequenceId: options.sequenceId,
      message: `sequence ${options.sequenceId} does not exist`,
    })
    return issues
  }

  // 相机存在性用一次性索引查：逐个 clip 扫全量节点会退化成 O(片段 × 节点)
  const cameraIds = collectCameraIds(document.content.nodes)
  for (const sequence of sequences) {
    if (options.requireClips && sequence.clips.length === 0) {
      issues.push({
        code: 'empty-sequence',
        sequenceId: sequence.id,
        message: `sequence ${sequence.id} has no clips`,
      })
    }
    for (const clip of sequence.clips) {
      issues.push(...validateClip(document, sequence.id, clip, cameraIds))
    }
  }
  return issues
}
