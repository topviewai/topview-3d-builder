import { useId, useLayoutEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../locale'
import { Tooltip } from './Tooltip'
import { usePortalRoot } from '../overlay/PortalRoot'

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function listFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  )
}

export interface ModalProps {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  closeDisabled?: boolean
  className?: string
}

export function Modal({ title, subtitle, onClose, children, footer, closeDisabled, className }: ModalProps) {
  const t = useT()
  const portal = usePortalRoot()
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const restoreRef = useRef<HTMLElement | null>(null)
  if (restoreRef.current === null && document.activeElement instanceof HTMLElement) {
    restoreRef.current = document.activeElement
  }
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const closeDisabledRef = useRef(closeDisabled)
  closeDisabledRef.current = closeDisabled

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const root = portal?.closest<HTMLElement>('.t3d-root')
    root?.classList.add('t3d-root-noscroll')
    const body = dialog?.querySelector<HTMLElement>('.t3d-modal-body')
    const preferred = body ? listFocusable(body) : []
    const focusable = dialog ? listFocusable(dialog) : []
    ;(preferred[0] ?? focusable[0] ?? dialog)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!closeDisabledRef.current) {
          e.preventDefault()
          e.stopPropagation()
          onCloseRef.current()
        }
        return
      }
      if (e.key !== 'Tab' || !dialog) return
      const items = listFocusable(dialog)
      if (items.length === 0) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const outside = !dialog.contains(active)
      if (e.shiftKey) {
        if (active === first || outside) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || outside) {
        e.preventDefault()
        first.focus()
      }
    }

    // 监听挂根容器而非 dialog：焦点被移到弹窗外（宿主 focus、点其他面板）时
    // 仍能夺回，否则 aria-modal 承诺的"背景不可达"会破。挂 document 则会劫持宿主。
    root?.addEventListener('keydown', onKey)
    return () => {
      root?.removeEventListener('keydown', onKey)
      root?.classList.remove('t3d-root-noscroll')
      restoreRef.current?.focus()
    }
  }, [portal])

  if (!portal) return null

  const onOverlay = (e: MouseEvent<HTMLDivElement>) => {
    if (closeDisabled || e.target !== e.currentTarget) return
    onClose()
  }

  return createPortal(
    <div className="t3d-modal-overlay" onMouseDown={onOverlay}>
      <div
        ref={dialogRef}
        className={className ? `t3d-modal ${className}` : 't3d-modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="t3d-modal-title">
          <div className="t3d-modal-heading">
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p className="t3d-modal-subtitle">{subtitle}</p> : null}
          </div>
          <Tooltip label={t('common.close')} side="bottom">
            <button
              type="button"
              className="t3d-modal-close"
              onClick={onClose}
              disabled={closeDisabled}
            >
              ×
            </button>
          </Tooltip>
        </div>
        <div className="t3d-modal-body">{children}</div>
        {footer ? <div className="t3d-modal-footer">{footer}</div> : null}
      </div>
    </div>,
    portal,
  )
}
