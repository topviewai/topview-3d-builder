import { useCallback, useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { CONTENT_WIDTH_MAX, CONTENT_WIDTH_MIN } from '../../../stores/EditorStore'

function clampWidth(value: number): number {
  return Math.min(CONTENT_WIDTH_MAX, Math.max(CONTENT_WIDTH_MIN, value))
}

export function usePanelResize(
  contentRef: RefObject<HTMLElement | null>,
  width: number,
  enabled: boolean,
  onCommit: (width: number) => void,
  options?: { invert?: boolean; clamp?: (value: number) => number },
): {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
} {
  const startX = useRef(0)
  const startW = useRef(0)
  const dragging = useRef(false)
  const handleRef = useRef<HTMLDivElement | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopRef.current?.(), [])

  useLayoutEffect(() => {
    const el = contentRef.current
    if (el && enabled && !dragging.current) el.style.width = `${width}px`
  }, [contentRef, width, enabled])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const el = contentRef.current
    if (!el) return
    event.preventDefault()
    startX.current = event.clientX
    startW.current = el.getBoundingClientRect().width
    dragging.current = true
    handleRef.current = event.currentTarget
    handleRef.current.classList.add('is-dragging')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const clamp = options?.clamp ?? clampWidth
    const sign = options?.invert ? -1 : 1
    const onMove = (move: PointerEvent) => {
      el.style.width = `${clamp(startW.current + sign * (move.clientX - startX.current))}px`
    }
    const onUp = () => {
      stopRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      dragging.current = false
      handleRef.current?.classList.remove('is-dragging')
      handleRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      onCommit(clamp(el.getBoundingClientRect().width))
    }
    stopRef.current = onUp
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [contentRef, onCommit, options?.clamp, options?.invert])

  return { onPointerDown }
}

export function useVerticalResize(
  height: number,
  enabled: boolean,
  onCommit: (height: number) => void,
  clamp: (value: number) => number,
): {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
} {
  const startY = useRef(0)
  const startH = useRef(0)
  const dragging = useRef(false)
  const handleRef = useRef<HTMLDivElement | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopRef.current?.(), [])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0) return
    event.preventDefault()
    startY.current = event.clientY
    startH.current = height
    dragging.current = true
    handleRef.current = event.currentTarget
    handleRef.current.classList.add('is-dragging')
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (move: PointerEvent) => {
      const next = clamp(startH.current - (move.clientY - startY.current))
      handleRef.current?.parentElement?.style.setProperty('--t3d-timeline-height', `${next}px`)
    }
    const onUp = (up: PointerEvent) => {
      stopRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      dragging.current = false
      handleRef.current?.classList.remove('is-dragging')
      handleRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      onCommit(clamp(startH.current - (up.clientY - startY.current)))
    }
    stopRef.current = () => onUp(new PointerEvent('pointerup'))
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [clamp, enabled, height, onCommit])

  return { onPointerDown }
}
