import { useCallback, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { EditSequenceClip } from '../../../contract/types'
import { useDirector } from '../../../bridge/DirectorContext'
import { DRAG_THRESHOLD_PX } from '../constants'
import { autoScrollSpeed, frameFromClientX, insertIndexAt } from '../utils'
import { beginFilmInteraction } from './filmInteraction'

export type ClipDragKind = 'move' | 'trim-start' | 'trim-end'

export type ClipDragStart = (
  kind: ClipDragKind,
  clip: EditSequenceClip,
  event: ReactPointerEvent<HTMLElement>,
) => void

interface UseClipDragDeps {
  clips: EditSequenceClip[]
  pxPerFrame: number
  track: RefObject<HTMLDivElement | null>
  disabled: boolean
  /** 点分镜时按落点跳成片播放头，和机位胶片条点选预览同一套。 */
  seek?: (frame: number) => void
  frameMax?: number
}

/**
 * 成片轨道上的片段拖拽：移动 = 重排，两端 = 裁剪。
 * 按下先跳播放头预览；超过阈值才开事务，普通点击只做选中 + 寻帧。
 */
export function useClipDrag(deps: UseClipDragDeps): ClipDragStart {
  const { useStore } = useDirector()
  const { beginFilmDrag, previewFilmDrag, commitFilmDrag } = useStore()
  const { clips, pxPerFrame, track, disabled, seek, frameMax } = deps

  return useCallback((kind, clip, event) => {
    if (disabled) return
    const axis = track.current
    if (axis && seek) {
      const frame = Math.round(frameFromClientX(event.clientX, axis, 0, pxPerFrame))
      seek(Math.min(frameMax ?? Number.POSITIVE_INFINITY, Math.max(0, frame)))
    }
    const dragKind = kind === 'move'
      ? 'sequence-reorder'
      : kind === 'trim-start' ? 'sequence-trim-start' : 'sequence-trim-end'
    const slotEl = (event.target as HTMLElement).closest('.t3d-film-clip-slot') as HTMLElement | null
    const scroller = track.current?.closest('.t3d-film-sequence-scroll') as HTMLElement | null
    const inner = track.current?.parentElement ?? null
    const startX = event.clientX
    const startScrollLeft = scroller?.scrollLeft ?? 0
    const origin = { start: clip.sourceFrameStart, end: clip.sourceFrameEnd }
    const fromIndex = clips.findIndex((item) => item.id === clip.id)
    let started = false
    let lastIndex = fromIndex
    let lastFrame = kind === 'trim-start' ? origin.start : origin.end
    let pointerX = startX
    let autoRaf = 0
    const endInteraction = beginFilmInteraction()

    const begin = () => {
      started = true
      beginFilmDrag(dragKind, clip.id)
      if (kind === 'move') {
        previewFilmDrag({
          kind: 'sequence-reorder',
          clipId: clip.id,
          cameraNodeId: clip.cameraNodeId,
          sourceFrameStart: origin.start,
          sourceFrameEnd: origin.end,
          toIndex: fromIndex,
        })
      }
    }

    // 内容坐标系下的位移：自动滚动时指针不动但内容在动，这段差值必须算进来
    const contentDx = () => (pointerX - startX) + ((scroller?.scrollLeft ?? 0) - startScrollLeft)

    const apply = () => {
      const dx = contentDx()
      if (kind === 'move') {
        if (slotEl) slotEl.style.transform = `translateX(${dx}px)`
        const el = track.current
        const next = el
          ? insertIndexAt(clips, clip.id, frameFromClientX(pointerX, el, 0, pxPerFrame))
          : lastIndex
        if (next === lastIndex) return
        lastIndex = next
        previewFilmDrag({
          kind: 'sequence-reorder',
          clipId: clip.id,
          cameraNodeId: clip.cameraNodeId,
          sourceFrameStart: origin.start,
          sourceFrameEnd: origin.end,
          toIndex: next,
        })
        return
      }
      const delta = Math.round(dx / pxPerFrame)
      if (kind === 'trim-start') {
        const sourceFrameStart = Math.min(origin.start + delta, origin.end)
        if (sourceFrameStart === lastFrame) return
        lastFrame = sourceFrameStart
        previewFilmDrag({
          kind: 'sequence-trim-start',
          clipId: clip.id,
          cameraNodeId: clip.cameraNodeId,
          sourceFrameStart,
          sourceFrameEnd: origin.end,
        })
        return
      }
      const sourceFrameEnd = Math.max(origin.end + delta, origin.start)
      if (sourceFrameEnd === lastFrame) return
      lastFrame = sourceFrameEnd
      previewFilmDrag({
        kind: 'sequence-trim-end',
        clipId: clip.id,
        cameraNodeId: clip.cameraNodeId,
        sourceFrameStart: origin.start,
        sourceFrameEnd,
      })
    }

    const stopAutoScroll = () => {
      if (!autoRaf) return
      cancelAnimationFrame(autoRaf)
      autoRaf = 0
    }

    /**
     * 上限按内容盒算，不能用 scrollWidth：被拖片段是靠 transform 跟手的，
     * 而 transform 会算进滚动区域，拿 scrollWidth 会「越滚越宽」停不下来。
     */
    const maxScrollLeft = (): number => {
      if (!scroller) return 0
      const content = inner?.offsetWidth ?? scroller.scrollWidth
      return Math.max(0, content - scroller.clientWidth)
    }

    const stepAutoScroll = () => {
      autoRaf = 0
      if (!scroller) return
      const speed = autoScrollSpeed(pointerX, scroller.getBoundingClientRect())
      if (speed === 0) return
      const before = scroller.scrollLeft
      const next = Math.min(maxScrollLeft(), Math.max(0, before + speed))
      // 滚到头就别再空转 rAF
      if (next === before) return
      scroller.scrollLeft = next
      apply()
      autoRaf = requestAnimationFrame(stepAutoScroll)
    }

    const onMove = (moveEvent: PointerEvent) => {
      pointerX = moveEvent.clientX
      if (!started) {
        if (Math.abs(pointerX - startX) < DRAG_THRESHOLD_PX) return
        begin()
      }
      apply()
      if (scroller && autoScrollSpeed(pointerX, scroller.getBoundingClientRect()) !== 0) {
        if (!autoRaf) autoRaf = requestAnimationFrame(stepAutoScroll)
      } else {
        stopAutoScroll()
      }
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      stopAutoScroll()
      if (slotEl) slotEl.style.transform = ''
      if (started) commitFilmDrag()
      endInteraction()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [beginFilmDrag, previewFilmDrag, commitFilmDrag, clips, pxPerFrame, track, disabled, seek, frameMax])
}
