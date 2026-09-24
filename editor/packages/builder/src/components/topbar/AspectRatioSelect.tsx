import { useEffect, useId, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import {
  ASPECT_RATIO_MENU_ORDER,
  aspectRatioLabel,
  AUTO_ASPECT_RATIO,
  isAspectRatioMenuItem,
  normalizeAspectRatio,
  parseAspectRatio,
} from '../../contract/aspectRatio'
import { Tooltip } from '../common/Tooltip'
import { cx } from '../common/cx'
import { usePortalRoot } from '../overlay/PortalRoot'

export interface AspectRatioSelectProps {
  value: string
  disabled?: boolean
  ariaLabel: string
  menuTitle: string
  autoLabel: string
  onChange: (value: string) => void
}

const SHAPE_SIZE: Record<string, readonly [number, number]> = {
  [AUTO_ASPECT_RATIO]: [22, 14],
  '21:9': [30, 13],
  '16:9': [24, 16],
  '4:3': [24, 16],
  '1:1': [18, 18],
  '3:4': [15, 24],
  '9:16': [15, 24],
}

export function AspectRatioSelect({
  value,
  disabled,
  ariaLabel,
  menuTitle,
  autoLabel,
  onChange,
}: AspectRatioSelectProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const portal = usePortalRoot()
  const listId = useId()
  const current = normalizeAspectRatio(value)
  const options = aspectRatioOptions(value)

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !portal) return
    const menu = menuRef.current
    const trigger = triggerRef.current
    if (!menu || !trigger) return
    placeMenu(menu, trigger)
  }, [open, portal, options.length])

  return (
    <div className="t3d-topbar-ratio" ref={wrapRef}>
      <Tooltip label={ariaLabel}>
        <button
          ref={triggerRef}
          type="button"
          className="t3d-topbar-ratio-trigger"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => {
            if (!disabled) setOpen((v) => !v)
          }}
        >
          <MonitorIcon />
          <span className="t3d-topbar-ratio-value">{aspectRatioLabel(current, autoLabel)}</span>
        </button>
      </Tooltip>
      {open ? (
        <RatioMenu
          listId={listId}
          ariaLabel={ariaLabel}
          menuTitle={menuTitle}
          options={options}
          current={current}
          autoLabel={autoLabel}
          portal={portal}
          menuRef={menuRef}
          onPick={(ratio) => {
            onChange(ratio)
            setOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

function RatioMenu({
  listId,
  ariaLabel,
  menuTitle,
  options,
  current,
  autoLabel,
  portal,
  menuRef,
  onPick,
}: {
  listId: string
  ariaLabel: string
  menuTitle: string
  options: string[]
  current: string
  autoLabel: string
  portal: HTMLElement | null
  menuRef: Ref<HTMLDivElement>
  onPick: (ratio: string) => void
}) {
  const menu = (
    <div
      ref={menuRef}
      id={listId}
      className={cx(
        't3d-dropdown-menu t3d-topbar-ratio-menu',
        !portal && 'is-anchored t3d-topbar-ratio-menu-local',
      )}
      data-placement="bottom"
      role="listbox"
      aria-label={ariaLabel}
    >
      <div className="t3d-dropdown-menu-title t3d-topbar-ratio-menu-title">{menuTitle}</div>
      {options.map((ratio) => {
        const selected = ratio === current
        return (
          <button
            key={ratio}
            type="button"
            role="option"
            aria-selected={selected}
            className={cx('t3d-topbar-ratio-item', selected && 't3d-topbar-ratio-item-active')}
            onClick={() => onPick(ratio)}
          >
            <RatioShape ratio={ratio} />
            <span className="t3d-topbar-ratio-item-label">{aspectRatioLabel(ratio, autoLabel)}</span>
            {selected ? <span className="t3d-topbar-ratio-check">✓</span> : null}
          </button>
        )
      })}
    </div>
  )
  return portal ? createPortal(menu, portal) : menu
}

function placeMenu(menu: HTMLElement, trigger: HTMLElement): void {
  const rect = trigger.getBoundingClientRect()
  const width = menu.offsetWidth
  const pad = 8
  let left = rect.left + rect.width / 2 - width / 2
  if (left + width > window.innerWidth - pad) left = window.innerWidth - width - pad
  if (left < pad) left = pad
  menu.style.top = `${rect.bottom + 6}px`
  menu.style.left = `${left}px`
}

function aspectRatioOptions(current: string): string[] {
  const value = normalizeAspectRatio(current)
  if (isAspectRatioMenuItem(value)) return [...ASPECT_RATIO_MENU_ORDER]
  return [...ASPECT_RATIO_MENU_ORDER, value]
}

function RatioShape({ ratio }: { ratio: string }) {
  const [width, height] = shapeSize(ratio)
  return (
    <span className="t3d-ratio-glyph" aria-hidden="true">
      <span className="t3d-ratio-glyph-frame" style={{ width, height }} />
    </span>
  )
}

function shapeSize(ratio: string): readonly [number, number] {
  const preset = SHAPE_SIZE[ratio]
  if (preset) return preset
  const aspect = parseAspectRatio(ratio)
  const maxW = 30
  const maxH = 24
  if (aspect >= 1) return [maxW, Math.max(8, Math.round(maxW / aspect))]
  return [Math.max(8, Math.round(maxH * aspect)), maxH]
}

function MonitorIcon() {
  return (
    <svg className="t3d-topbar-ratio-icon" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13.4998 2.43628C15.4672 2.43628 17.0621 4.03138 17.0623 5.99878V11.9988C17.0623 13.9663 15.4673 15.5613 13.4998 15.5613H4.49976C2.53241 15.5611 0.937256 13.9662 0.937256 11.9988V5.99878C0.937388 4.0315 2.53249 2.43648 4.49976 2.43628H13.4998ZM4.49976 3.56128C3.15381 3.56148 2.06239 4.65282 2.06226 5.99878V8.68628H8.49976C9.63861 8.68641 10.5621 9.60994 10.5623 10.7488V14.4363H13.4998C14.846 14.4363 15.9373 13.345 15.9373 11.9988V5.99878C15.9371 4.6527 14.8459 3.56128 13.4998 3.56128H4.49976ZM2.06226 11.9988C2.06226 13.3449 3.15373 14.4361 4.49976 14.4363H9.43726V10.7488C9.43706 10.2313 9.01729 9.81141 8.49976 9.81128H2.06226V11.9988Z"
      />
    </svg>
  )
}
