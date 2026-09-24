import { Tooltip } from './Tooltip'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx'
import { IconChevron } from '../leftrail/icons'
import { usePortalRoot } from '../overlay/PortalRoot'

const MENU_GAP = 8
const MENU_PAD = 8
const MENU_MAX_H = 156
const MENU_MIN_W = 120

export type DropdownOption = { value: string; label: string; disabled?: boolean }

export function Dropdown({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  tooltip,
  className,
  menuPlacement = 'bottom',
}: {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  disabled?: boolean
  tooltip?: string
  ariaLabel?: string
  className?: string
  menuPlacement?: 'top' | 'bottom'
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const portal = usePortalRoot()
  const selected = options.find((opt) => opt.value === value)

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
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const menu = menuRef.current
    const trigger = triggerRef.current
    if (!menu || !trigger) return
    placeMenu(menu, trigger, menuPlacement)
  }, [open, menuPlacement, options.length, value])

  const menu = open ? (
    <div
      ref={menuRef}
      className="t3d-dropdown-menu"
      role="listbox"
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value || '__empty__'}
            type="button"
            role="option"
            aria-selected={active}
            className={cx('t3d-dropdown-option', active && 'is-active')}
            disabled={opt.disabled}
            onClick={() => {
              onChange(opt.value)
              setOpen(false)
            }}
          >
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  ) : null

  return (
    <div ref={wrapRef} className={cx('t3d-dropdown', open && 'is-open', className)}>
      <Tooltip label={tooltip ?? ''} side="top" variant="description">
        <button
          ref={triggerRef}
          type="button"
          className="t3d-dropdown-trigger"
          disabled={disabled}
          aria-disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => {
            if (!disabled) setOpen((v) => !v)
          }}
        >
          <span className="t3d-dropdown-value">{selected?.label ?? value}</span>
          <IconChevron className="t3d-dropdown-chevron" />
        </button>
      </Tooltip>
      {menu ? (portal ? createPortal(menu, portal) : menu) : null}
    </div>
  )
}

function placeMenu(menu: HTMLElement, trigger: HTMLElement, placement: 'top' | 'bottom') {
  const rect = trigger.getBoundingClientRect()
  const width = Math.max(rect.width, MENU_MIN_W)
  menu.style.width = `${width}px`
  menu.style.minWidth = `${width}px`

  let left = rect.left
  if (left + width > window.innerWidth - MENU_PAD) left = window.innerWidth - MENU_PAD - width
  if (left < MENU_PAD) left = MENU_PAD

  const menuH = Math.min(menu.scrollHeight, MENU_MAX_H)
  let side = placement
  if (side === 'bottom' && rect.bottom + MENU_GAP + menuH > window.innerHeight - MENU_PAD) {
    side = 'top'
  } else if (side === 'top' && rect.top - MENU_GAP - menuH < MENU_PAD) {
    side = 'bottom'
  }

  menu.dataset.placement = side
  menu.style.left = `${left}px`
  if (side === 'bottom') {
    menu.style.top = `${rect.bottom + MENU_GAP}px`
    menu.style.bottom = 'auto'
  } else {
    menu.style.top = `${rect.top - MENU_GAP - menuH}px`
    menu.style.bottom = 'auto'
  }
}
