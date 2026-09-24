import {
  activateSequence,
  clearSequenceClips,
  createSequence,
  deleteEditClip,
  deleteSequence,
  duplicateEditClip,
  duplicateSequence,
  getEditSequenceDurationFrames,
  insertEditClip,
  materializeEditorial,
  moveEditClip,
  renameSequence,
  updateEditClip,
  validateEditorial,
} from '@topview/3d-builder/evaluate'

const OP_LIMIT = 64

function withEditorial(document, editorial) {
  return {
    ...document,
    content: { ...document.content, editorial },
  }
}

function activeSequenceId(document) {
  const editorial = document?.content?.editorial
  return (typeof editorial?.activeSequenceId === 'string' && editorial.activeSequenceId)
    ? editorial.activeSequenceId
    : 'sequence_1'
}

function applyOne(document, op) {
  switch (op.op) {
    case 'sequence.create':
      return createSequence(document, { name: op.name, activate: op.activate })
    case 'sequence.rename':
      return renameSequence(document, op.sequenceId, op.name ?? null)
    case 'sequence.duplicate':
      return duplicateSequence(document, op.sequenceId, { activate: op.activate })
    case 'sequence.delete':
      return deleteSequence(document, op.sequenceId)
    case 'sequence.activate':
      return activateSequence(document, op.sequenceId)
    case 'sequence.clear':
      return clearSequenceClips(document, op.sequenceId)
    case 'clip.insert':
      return insertEditClip(document, {
        sequenceId: op.sequenceId || activeSequenceId(document),
        cameraNodeId: op.cameraNodeId,
        sourceFrameStart: op.sourceFrameStart,
        sourceFrameEnd: op.sourceFrameEnd,
        index: op.index,
      })
    case 'clip.update':
      return updateEditClip(document, op.clipId, {
        cameraNodeId: op.cameraNodeId,
        sourceFrameStart: op.sourceFrameStart,
        sourceFrameEnd: op.sourceFrameEnd,
      })
    case 'clip.move':
      return moveEditClip(document, op.clipId, op.index)
    case 'clip.duplicate':
      return duplicateEditClip(document, op.clipId, { index: op.index })
    case 'clip.delete':
      return deleteEditClip(document, op.clipId)
    default:
      throw new Error(`UNKNOWN_DIRECTOR_EDITORIAL_OP:${op.op}`)
  }
}

export function summarizeEditorial(document) {
  const editorial = materializeEditorial(document)
  return {
    version: editorial.version,
    activeSequenceId: editorial.activeSequenceId,
    sequences: editorial.sequences.map((sequence) => ({
      id: sequence.id,
      ...(sequence.name ? { name: sequence.name } : {}),
      durationFrames: getEditSequenceDurationFrames(sequence.clips),
      clips: sequence.clips.map((clip) => ({
        id: clip.id,
        cameraNodeId: clip.cameraNodeId,
        sourceFrameStart: clip.sourceFrameStart,
        sourceFrameEnd: clip.sourceFrameEnd,
      })),
    })),
  }
}

export function applyEditSequenceOps(body) {
  const document = body?.document
  if (!document || typeof document !== 'object') {
    throw new Error('DIRECTOR_DOCUMENT_MISSING')
  }
  const ops = body.ops
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > OP_LIMIT) {
    throw new Error('INVALID_DIRECTOR_EDITORIAL_OPS')
  }
  let next = withEditorial(document, materializeEditorial(document))
  const createdIds = []
  for (const op of ops) {
    if (!op || typeof op !== 'object' || typeof op.op !== 'string') {
      throw new Error('INVALID_DIRECTOR_EDITORIAL_OP')
    }
    const result = applyOne(next, op)
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        issues: result.issues ?? [],
        createdIds,
      }
    }
    next = withEditorial(next, result.editorial)
    if (result.createdId) createdIds.push(result.createdId)
  }
  return {
    ok: true,
    editorial: next.content.editorial,
    createdIds,
    issues: validateEditorial(next),
  }
}
