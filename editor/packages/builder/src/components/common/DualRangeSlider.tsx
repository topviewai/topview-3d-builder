import {
  useCallback,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { cx } from './cx'
import {
  applyRangeThumb,
  pickCloserThumb,
  rangePercent,
  valueFromClientX,
  type RangeThumb,
} from './rangeSliderUtils'

interface DualRangeSliderProps {
  min: number
  max: number
  start: number
  end: number
  disabled?: boolean
  startAriaLabel: string
  endAriaLabel: string
  onStartChange: (value: number) => void
  onEndChange: (value: number) => void
}

export function DualRangeSlider({
  min,
  max,
  start,
  end,
  disabled,
  startAriaLabel,
  endAriaLabel,
  onStartChange,
  onEndChange,
}: DualRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragThumb = useRef<RangeThumb | null>(null)
  const live = useRef({ start, end, min, max })
  live.current = { start, end, min, max }

  const commit = useCallback(
    (thumb: RangeThumb, next: number) => {
      const current = live.current
      const range = applyRangeThumb(thumb, next, current.start, current.end, current.min, current.max)
      live.current = { ...current, start: range.start, end: range.end }
      if (range.start !== current.start) onStartChange(range.start)
      if (range.end !== current.end) onEndChange(range.end)
    },
    [onEndChange, onStartChange],
  )

  const valueAt = (clientX: number): number => {
    const track = trackRef.current
    if (!track) return start
    const rect = track.getBoundingClientRect()
    return valueFromClientX(clientX, rect.left, rect.width, min, max)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return
    const target = event.target as HTMLElement
    const fromThumb = target.dataset.thumb as RangeThumb | undefined
    const next = valueAt(event.clientX)
    const thumb = fromThumb ?? pickCloserThumb(next, start, end)
    dragThumb.current = thumb
    event.currentTarget.setPointerCapture(event.pointerId)
    commit(thumb, next)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragThumb.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    commit(dragThumb.current, valueAt(event.clientX))
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragThumb.current = null
  }

  const onThumbKeyDown = (thumb: RangeThumb) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    const current = thumb === 'start' ? start : end
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      commit(thumb, current - 1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      commit(thumb, current + 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      commit(thumb, min)
    } else if (event.key === 'End') {
      event.preventDefault()
      commit(thumb, max)
    }
  }

  const startPct = rangePercent(start, min, max)
  const endPct = rangePercent(end, min, max)
  const trackStyle: CSSProperties & {
    '--t3d-dual-range-start': string
    '--t3d-dual-range-end': string
  } = {
    '--t3d-dual-range-start': `${startPct}%`,
    '--t3d-dual-range-end': `${endPct}%`,
  }

  return (
    <div
      ref={trackRef}
      className={cx('t3d-dual-range', disabled && 'is-disabled')}
      style={trackStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="t3d-dual-range-track" aria-hidden />
      <div className="t3d-dual-range-fill" aria-hidden />
      <button
        type="button"
        className="t3d-dual-range-thumb"
        data-thumb="start"
        style={{ left: `${startPct}%` }}
        disabled={disabled}
        role="slider"
        aria-label={startAriaLabel}
        aria-valuemin={min}
        aria-valuemax={end}
        aria-valuenow={start}
        onKeyDown={onThumbKeyDown('start')}
      />
      <button
        type="button"
        className="t3d-dual-range-thumb"
        data-thumb="end"
        style={{ left: `${endPct}%` }}
        disabled={disabled}
        role="slider"
        aria-label={endAriaLabel}
        aria-valuemin={start}
        aria-valuemax={max}
        aria-valuenow={end}
        onKeyDown={onThumbKeyDown('end')}
      />
    </div>
  )
}
