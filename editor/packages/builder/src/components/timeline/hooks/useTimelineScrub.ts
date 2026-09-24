import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

export function useTimelineScrub(
  frameStart: number,
  pxPerFrame: number,
  setFrame: (frame: number) => void,
  locked = false,
  snap?: (frame: number) => number,
) {
  const rulerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const layout = useRef({ frameStart, pxPerFrame, setFrame, locked, snap })
  layout.current = { frameStart, pxPerFrame, setFrame, locked, snap }

  const seekAt = (clientX: number) => {
    const ruler = rulerRef.current
    if (!ruler) return
    const { frameStart: start, pxPerFrame: px, setFrame: seekTo, snap: snapTo } = layout.current
    const frame = start + (clientX - ruler.getBoundingClientRect().left) / px
    seekTo(snapTo ? snapTo(frame) : frame)
  }

  const beginScrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (layout.current.locked || dragging.current) return
    if (event.button !== 0 || !rulerRef.current) return
    if (event.currentTarget.classList.contains('t3d-timeline-playhead')) {
      const underKf = document.elementsFromPoint(event.clientX, event.clientY).some(
        (el) => el instanceof HTMLElement && el.classList.contains('t3d-timeline-kf'),
      )
      if (underKf) return
    }
    event.preventDefault()
    event.stopPropagation()

    const pointerId = event.pointerId
    dragging.current = true

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      seekAt(moveEvent.clientX)
    }
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      dragging.current = false
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    seekAt(event.clientX)
  }

  return {
    rulerRef,
    scrubHandlers: {
      onPointerDown: beginScrub,
      onPointerMove: () => undefined,
      onPointerUp: () => undefined,
      onPointerCancel: () => undefined,
    },
  }
}
