import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'
import { usePortalRoot } from '../overlay/PortalRoot'

const SHOW_DELAY_MS = 280
const GAP = 8
const VIEW_PAD = 8

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

interface TooltipTriggerProps {
  disabled?: boolean
  title?: string
  'aria-label'?: string
  'aria-describedby'?: string
  onPointerEnter?: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerLeave?: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void
  onFocus?: (event: ReactFocusEvent<HTMLElement>) => void
  onBlur?: (event: ReactFocusEvent<HTMLElement>) => void
}

export interface TooltipProps {
  label: string
  shortcut?: string
  side?: TooltipSide
  delay?: number
  showOnFocus?: boolean
  variant?: 'default' | 'description'
  children: ReactElement<TooltipTriggerProps>
}

export function Tooltip({ label, shortcut, side = 'bottom', delay = SHOW_DELAY_MS, showOnFocus = false, variant = 'default', children }: TooltipProps) {
  const tooltipId = useId()
  const portal = usePortalRoot()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef(0)
  const [open, setOpen] = useState(false)
  const disabled = Boolean(children.props.disabled)

  const hide = () => {
    window.clearTimeout(timerRef.current)
    setOpen(false)
  }

  const show = () => {
    window.clearTimeout(timerRef.current)
    if (!label) return
    timerRef.current = window.setTimeout(() => setOpen(true), delay)
  }

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  useLayoutEffect(() => {
    if (!open) return
    const bubble = bubbleRef.current
    const trigger = wrapRef.current?.firstElementChild
    if (!bubble || !(trigger instanceof HTMLElement)) return
    placeTooltip(bubble, trigger.getBoundingClientRect(), side)
  }, [open, label, shortcut, side])

  if (!label) return children

  const childProps = children.props
  const trigger = cloneElement(children, {
    title: undefined,
    'aria-label': childProps['aria-label'] ?? (variant === 'default' ? label : undefined),
    'aria-describedby': open ? [childProps['aria-describedby'], tooltipId].filter(Boolean).join(' ') : childProps['aria-describedby'],
    onPointerEnter: disabled ? childProps.onPointerEnter : mergeHandler(childProps.onPointerEnter, show),
    onPointerLeave: disabled ? childProps.onPointerLeave : mergeHandler(childProps.onPointerLeave, hide),
    onPointerDown: disabled ? childProps.onPointerDown : mergeHandler(childProps.onPointerDown, hide),
    onFocus: !showOnFocus || disabled ? childProps.onFocus : mergeHandler(childProps.onFocus, show),
    onBlur: !showOnFocus || disabled ? childProps.onBlur : mergeHandler(childProps.onBlur, hide),
  })

  const bubble =
    open && portal ? (
      createPortal(
        <div id={tooltipId} ref={bubbleRef} className={`t3d-tooltip${variant === 'description' ? ' t3d-tooltip-description' : ''}`} role="tooltip">
          <span>{label}</span>
          {shortcut ? <kbd className="t3d-tooltip-kbd">{shortcut}</kbd> : null}
        </div>,
        portal,
      )
    ) : null

  return (
    <span
      ref={wrapRef}
      className={disabled ? 't3d-tooltip-hit is-disabled' : 't3d-tooltip-hit'}
      onPointerEnter={disabled ? show : undefined}
      onPointerLeave={disabled ? hide : undefined}
      onPointerDown={disabled ? hide : undefined}
    >
      {trigger}
      {bubble}
    </span>
  )
}

function mergeHandler<E>(
  existing: ((event: E) => void) | undefined,
  next: () => void,
): (event: E) => void {
  return (event) => {
    existing?.(event)
    next()
  }
}

function placeTooltip(bubble: HTMLElement, rect: DOMRect, side: TooltipSide): void {
  const width = bubble.offsetWidth
  const height = bubble.offsetHeight
  let top = 0
  let left = 0
  if (side === 'bottom') {
    top = rect.bottom + GAP
    left = rect.left + rect.width / 2 - width / 2
  } else if (side === 'top') {
    top = rect.top - height - GAP
    left = rect.left + rect.width / 2 - width / 2
  } else if (side === 'right') {
    top = rect.top + rect.height / 2 - height / 2
    left = rect.right + GAP
  } else {
    top = rect.top + rect.height / 2 - height / 2
    left = rect.left - width - GAP
  }
  bubble.style.top = `${clamp(top, VIEW_PAD, window.innerHeight - height - VIEW_PAD)}px`
  bubble.style.left = `${clamp(left, VIEW_PAD, window.innerWidth - width - VIEW_PAD)}px`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
