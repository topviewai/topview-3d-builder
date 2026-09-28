import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { localeName, orderedLocales, useLocale, useLocaleChange, useT } from '../../locale'
import { Tooltip } from '../common/Tooltip'
import { cx } from '../common/cx'
import { usePortalRoot } from '../overlay/PortalRoot'
import { placeMenu } from './AspectRatioSelect'

/** Topbar language menu; rendered only when the host passes `onLocaleChange`. */
export function LanguageSelect() {
  const t = useT()
  const locale = useLocale()
  const onChange = useLocaleChange()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const portal = usePortalRoot()
  const listId = useId()
  const locales = orderedLocales()

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
    if (!open || !portal || !menuRef.current || !triggerRef.current) return
    placeMenu(menuRef.current, triggerRef.current)
  }, [open, portal])

  if (!onChange) return null
  const label = t('topbar.language')

  const menu = open ? (
    <div
      ref={menuRef}
      id={listId}
      className={cx('t3d-dropdown-menu t3d-topbar-ratio-menu t3d-topbar-language-menu', !portal && 'is-anchored t3d-topbar-ratio-menu-local')}
      data-placement="bottom"
      role="listbox"
      aria-label={label}
    >
      <div className="t3d-dropdown-menu-title t3d-topbar-ratio-menu-title">{label}</div>
      {locales.map((id) => {
        const selected = id === locale
        return (
          <button
            key={id}
            type="button"
            role="option"
            lang={id}
            aria-selected={selected}
            className={cx('t3d-topbar-ratio-item', selected && 't3d-topbar-ratio-item-active')}
            onClick={() => {
              setOpen(false)
              if (!selected) onChange(id)
            }}
          >
            <span className="t3d-topbar-ratio-item-label">{localeName(id)}</span>
            {selected ? <span className="t3d-topbar-ratio-check">✓</span> : null}
          </button>
        )
      })}
    </div>
  ) : null

  return (
    <div className="t3d-topbar-ratio" ref={wrapRef}>
      <Tooltip label={label}>
        <button
          ref={triggerRef}
          type="button"
          className="t3d-topbar-ratio-trigger"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <GlobeIcon />
          <span className="t3d-topbar-ratio-value" lang={locale}>{localeName(locale)}</span>
        </button>
      </Tooltip>
      {menu && portal ? createPortal(menu, portal) : menu}
    </div>
  )
}

function GlobeIcon() {
  return (
    <svg className="t3d-topbar-ratio-icon" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="7.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.8 9h14.4M9 1.6c2 2.1 3 4.6 3 7.4s-1 5.3-3 7.4c-2-2.1-3-4.6-3-7.4s1-5.3 3-7.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}
