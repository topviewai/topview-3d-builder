import { useRef, type PointerEvent } from 'react'
import { useEngineEvent } from '../../bridge/useEngineEvent'
import { formatTimelinePlayhead, timelineSheetRuler } from './utils'

export function Ruler({
  frameStart,
  frameEnd,
  fps,
  pxPerFrame,
  currentFrame,
  ariaLabel,
  rulerRef,
  scrubHandlers,
}: {
  frameStart: number
  frameEnd: number
  fps: number
  pxPerFrame: number
  currentFrame: number
  ariaLabel: string
  rulerRef: { current: HTMLDivElement | null }
  scrubHandlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void
    onPointerMove: (event: PointerEvent<HTMLElement>) => void
    onPointerUp: (event: PointerEvent<HTMLElement>) => void
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void
  }
}) {
  const labelRef = useRef<HTMLSpanElement>(null)
  const layoutRef = useRef({ start: frameStart, px: pxPerFrame, fps })
  layoutRef.current = { start: frameStart, px: pxPerFrame, fps }
  const sheet = timelineSheetRuler(pxPerFrame, fps)
  const first = Math.floor(frameStart / sheet.step) * sheet.step
  const ticks: number[] = []
  for (let frame = first; frame <= frameEnd; frame += sheet.step) {
    if (frame >= frameStart) ticks.push(frame)
  }

  useEngineEvent('frame', (frame) => {
    const { start, px, fps: rate } = layoutRef.current
    const el = labelRef.current
    if (!el) return
    el.style.left = `${(frame - start) * px}px`
    el.textContent = formatTimelinePlayhead(frame, rate)
  })

  return (
    <div className="t3d-timeline-row t3d-timeline-ruler-row">
      <div className="t3d-timeline-name t3d-timeline-ruler-name" />
      <div
        ref={rulerRef}
        className="t3d-timeline-track t3d-timeline-ruler"
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={frameStart}
        aria-valuemax={frameEnd}
        aria-valuenow={Math.round(currentFrame)}
        aria-valuetext={formatTimelinePlayhead(currentFrame, fps)}
        tabIndex={0}
        {...scrubHandlers}
      >
        {ticks.map((frame) => (
          <span
            key={frame}
            className="t3d-timeline-tick"
            style={{ left: (frame - frameStart) * pxPerFrame }}
          >
            {sheet.format(frame)}
          </span>
        ))}
        <span
          ref={labelRef}
          className="t3d-timeline-cursor-label"
          style={{ left: (currentFrame - frameStart) * pxPerFrame }}
        >
          {formatTimelinePlayhead(currentFrame, fps)}
        </span>
      </div>
    </div>
  )
}
