import { useCallback, type PointerEvent as ReactPointerEvent } from 'react'
import type { DirectorDocument, EditSequenceClip } from '../../../contract/types'
import { useDirector } from '../../../bridge/DirectorContext'
import { DRAG_THRESHOLD_PX } from '../constants'
import type { SourceWorkingRange } from '../types'
import { beginFilmInteraction } from './filmInteraction'

export type SourceDragKind = 'source-move' | 'source-trim-start' | 'source-trim-end'

export type SourceDragStart = (kind: SourceDragKind, event: ReactPointerEvent<HTMLElement>) => void

interface UseSourceDragDeps {
  document: DirectorDocument
  clip: EditSequenceClip | null
  /** 没有选中分镜也没有草稿时为 null，此时源条只能拖播放头。 */
  working: SourceWorkingRange | null
  isDraft: boolean
}

/**
 * 源条上的入出点拖拽。草稿态直接改草稿（不进历史），
 * 已有片段走 begin/preview/commit 事务，一次拖拽只入一条历史。
 */
export function useSourceDrag(deps: UseSourceDragDeps): SourceDragStart {
  const { useStore } = useDirector()
  const { beginFilmDrag, previewFilmDrag, commitFilmDrag, updateFilmAddDraft } = useStore()
  const { document, clip, working, isDraft } = deps

  return useCallback((kind, event) => {
    if (!working) return
    event.stopPropagation()
    event.preventDefault()
    const startX = event.clientX
    const origin = { start: working.sourceFrameStart, end: working.sourceFrameEnd }
    const duration = origin.end - origin.start
    const { frameStart, frameEnd } = document.content.timeline
    const lane = event.currentTarget.closest('.t3d-film-source-lane')
    const pxPerFrame = lane instanceof HTMLElement
      ? lane.clientWidth / (frameEnd - frameStart + 1)
      : 4
    let started = false
    let last = { start: origin.start, end: origin.end }
    const endInteraction = beginFilmInteraction()

    const apply = (sourceFrameStart: number, sourceFrameEnd: number) => {
      const next = {
        cameraNodeId: working.cameraNodeId,
        sourceFrameStart: Math.max(frameStart, sourceFrameStart),
        sourceFrameEnd: Math.min(frameEnd, sourceFrameEnd),
      }
      if (next.sourceFrameEnd < next.sourceFrameStart) return
      // 帧量化后值没变就别再往下游推，省掉一次全量重渲 + 一次程序预览求值
      if (next.sourceFrameStart === last.start && next.sourceFrameEnd === last.end) return
      last = { start: next.sourceFrameStart, end: next.sourceFrameEnd }
      if (isDraft) {
        updateFilmAddDraft(next)
        return
      }
      if (!clip) return
      previewFilmDrag({ kind, clipId: clip.id, ...next })
    }

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX
      if (!started) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
        started = true
        if (!isDraft && clip) beginFilmDrag(kind, clip.id)
      }
      const delta = Math.round(dx / pxPerFrame)
      if (kind === 'source-move') {
        let start = origin.start + delta
        let end = start + duration
        if (start < frameStart) {
          start = frameStart
          end = start + duration
        }
        if (end > frameEnd) {
          end = frameEnd
          start = end - duration
        }
        apply(start, end)
        return
      }
      if (kind === 'source-trim-start') apply(Math.min(origin.start + delta, origin.end), origin.end)
      else apply(origin.start, Math.max(origin.end + delta, origin.start))
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (started && !isDraft) commitFilmDrag()
      endInteraction()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [beginFilmDrag, previewFilmDrag, commitFilmDrag, updateFilmAddDraft, document, clip, working, isDraft])
}
