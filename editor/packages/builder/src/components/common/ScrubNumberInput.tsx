import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  clampNumber,
  commitNumericDraft,
  formatScrubNumber,
  isNumericDraft,
  parseNumericDraft,
  quantizeNumber,
  scrubNumericValue,
} from '../../document/numericDraft'
import { cx } from './cx'

const DRAG_THRESHOLD_PX = 3

export function ScrubNumberInput({
  value,
  step = 0.05,
  min,
  max,
  precision = 3,
  fixed,
  disabled,
  className,
  ariaLabel,
  onChange,
  onCommit,
  onFocus,
  onBlur,
  onEditStart,
  onEditEnd,
  commitOnRelease = false,
}: {
  value: number
  step?: number
  min?: number
  max?: number
  precision?: number
  fixed?: boolean
  disabled?: boolean
  className?: string
  ariaLabel?: string
  onChange: (value: number) => void
  onCommit?: (value: number) => void
  onFocus?: () => void
  onBlur?: () => void
  onEditStart?: () => void
  onEditEnd?: () => void
  /** Preview scrubbing locally when intermediate writes could destroy data (e.g. key collisions). */
  commitOnRelease?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const lastRef = useRef(value)
  const editRef = useRef({ active: false, original: value, changed: false, cancelled: false })
  const editEndRef = useRef(onEditEnd)
  editEndRef.current = onEditEnd
  useEffect(() => () => {
    if (editRef.current.active) {
      editRef.current.active = false
      editEndRef.current?.()
    }
  }, [])
  const dragRef = useRef({ active: false, moved: false, startX: 0, startVal: value })
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? formatScrubNumber(value, precision, fixed)

  const emit = useCallback(
    (next: number, commit: boolean) => {
      lastRef.current = next
      if (commit && onCommit) onCommit(next)
      else onChange(next)
    },
    [onChange, onCommit],
  )

  const snap = useCallback(
    (raw: number) => quantizeNumber(clampNumber(raw, min, max), precision),
    [max, min, precision],
  )

  const applyDraft = (raw: string) => {
    if (!isNumericDraft(raw)) return
    editRef.current.changed = true
    setDraft(raw)
  }

  const finishDraft = () => {
    const edit = editRef.current
    if (edit.changed && !edit.cancelled) {
      const raw = commitNumericDraft(draft ?? '', edit.original)
      // precision controls display/scrubbing, not the accuracy of typed decimals.
      const next = raw === edit.original ? edit.original
        : precision <= 0 ? snap(raw) : clampNumber(raw, min, max)
      if (next !== edit.original) emit(next, true)
    }
    setDraft(null)
  }

  const beginEdit = () => {
    if (editRef.current.active) return
    editRef.current = { active: true, original: value, changed: false, cancelled: false }
    onEditStart?.()
  }

  const endEdit = () => {
    if (!editRef.current.active) return
    editRef.current.active = false
    onEditEnd?.()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      editRef.current.cancelled = true
      e.currentTarget.blur()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
      return
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const base = parseNumericDraft(draft ?? display) ?? value
    const next = clampNumber(quantizeNumber(base + (e.key === 'ArrowUp' ? step : -step), precision <= 0 ? 0 : 12), min, max)
    editRef.current.changed = true
    setDraft(String(next))
  }

  const handlePointerDown = (e: PointerEvent<HTMLInputElement>) => {
    if (disabled) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (document.activeElement === inputRef.current) return
    e.preventDefault()
    // Finish the previous field before starting another history interaction.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    lastRef.current = value
    dragRef.current = { active: true, moved: false, startX: e.clientX, startVal: value }
    beginEdit()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const handlePointerMove = (e: PointerEvent<HTMLInputElement>) => {
    const state = dragRef.current
    if (!state.active) return
    const dx = e.clientX - state.startX
    if (!state.moved && Math.abs(dx) >= DRAG_THRESHOLD_PX) state.moved = true
    if (state.moved) {
      const next = scrubNumericValue(state.startVal, dx, step, { min, max, precision })
      if (commitOnRelease) {
        lastRef.current = next
        setDraft(formatScrubNumber(next, precision, fixed))
      } else {
        emit(next, false)
      }
    }
  }

  const endPointer = (e: PointerEvent<HTMLInputElement>) => {
    const state = dragRef.current
    if (!state.active) return
    state.active = false
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (e.type === 'pointercancel') {
      if (state.moved && !commitOnRelease) emit(state.startVal, false)
      setDraft(null)
      endEdit()
      return
    }
    if (state.moved) {
      if (!commitOnRelease || lastRef.current !== state.startVal) emit(lastRef.current, true)
      setDraft(null)
      endEdit()
      return
    }
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode={precision <= 0 ? 'numeric' : 'decimal'}
      autoComplete="off"
      spellCheck={false}
      draggable={false}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cx('t3d-scrub-input', className)}
      value={display}
      onFocus={() => {
        beginEdit()
        setDraft(String(value))
        onFocus?.()
      }}
      onChange={(e) => applyDraft(e.target.value)}
      onBlur={() => {
        finishDraft()
        endEdit()
        onBlur?.()
      }}
      onKeyDown={onKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    />
  )
}
