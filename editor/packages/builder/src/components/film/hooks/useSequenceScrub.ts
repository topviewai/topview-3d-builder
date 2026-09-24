import { useCallback, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { autoScrollSpeed, frameFromClientX } from '../utils'

interface UseSequenceScrubDeps {
  trackRef: RefObject<HTMLDivElement | null>
  pxPerFrame: number
  frameMax: number
  disabled?: boolean
  seek: (frame: number) => void
}

/**
 * 成片时间尺 / 轨道空白处拖播放头。贴边自动滚与分镜拖拽同一套速度曲线，
 * 滚到头按内容盒封顶，避免 scrollWidth 把尾巴越滚越长。
 */
export function useSequenceScrub(deps: UseSequenceScrubDeps) {
  const { trackRef, pxPerFrame, frameMax, disabled, seek } = deps

  return useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (disabled) return
    const axis = trackRef.current ?? event.currentTarget
    const scroller = axis.closest('.t3d-film-sequence-scroll')
    const inner = axis.closest('.t3d-film-sequence-inner')
    let pointerX = event.clientX
    let autoRaf = 0

    const seekAtPointer = () => {
      const frame = Math.round(frameFromClientX(pointerX, axis, 0, pxPerFrame))
      seek(Math.min(frameMax, Math.max(0, frame)))
    }

    const maxScrollLeft = (): number => {
      if (!(scroller instanceof HTMLElement)) return 0
      const content = inner instanceof HTMLElement ? inner.offsetWidth : scroller.scrollWidth
      return Math.max(0, content - scroller.clientWidth)
    }

    const stopAutoScroll = () => {
      if (!autoRaf) return
      cancelAnimationFrame(autoRaf)
      autoRaf = 0
    }

    const stepAutoScroll = () => {
      autoRaf = 0
      if (!(scroller instanceof HTMLElement)) return
      const speed = autoScrollSpeed(pointerX, scroller.getBoundingClientRect())
      if (speed === 0) return
      const before = scroller.scrollLeft
      const next = Math.min(maxScrollLeft(), Math.max(0, before + speed))
      if (next === before) return
      scroller.scrollLeft = next
      seekAtPointer()
      autoRaf = requestAnimationFrame(stepAutoScroll)
    }

    const onMove = (moveEvent: PointerEvent) => {
      pointerX = moveEvent.clientX
      seekAtPointer()
      if (
        scroller instanceof HTMLElement
        && autoScrollSpeed(pointerX, scroller.getBoundingClientRect()) !== 0
      ) {
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
    }

    seekAtPointer()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [trackRef, pxPerFrame, frameMax, disabled, seek])
}
