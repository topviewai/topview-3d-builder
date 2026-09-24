import { useRef, type PointerEvent } from 'react'
import { useEngineEvent } from '../../bridge/useEngineEvent'
import { LEFT_W, TRACK_INSET } from './constants'

export function Playhead({
  frameStart,
  pxPerFrame,
  currentFrame,
  scrubHandlers,
}: {
  frameStart: number
  pxPerFrame: number
  currentFrame: number
  scrubHandlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void
    onPointerMove: (event: PointerEvent<HTMLElement>) => void
    onPointerUp: (event: PointerEvent<HTMLElement>) => void
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void
  }
}) {
  const ref = useRef<HTMLDivElement>(null)
  const layoutRef = useRef({ start: frameStart, px: pxPerFrame })
  layoutRef.current = { start: frameStart, px: pxPerFrame }

  useEngineEvent('frame', (frame) => {
    const { start, px } = layoutRef.current
    const el = ref.current
    if (el) el.style.left = `${LEFT_W + TRACK_INSET + (frame - start) * px}px`
  })

  return (
    <div
      ref={ref}
      className="t3d-timeline-playhead"
      style={{ left: LEFT_W + TRACK_INSET + (currentFrame - frameStart) * pxPerFrame }}
      {...scrubHandlers}
    />
  )
}
