import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '../common/Tooltip'
import { usePortalRoot } from '../overlay/PortalRoot'
import { useT } from '../../locale'
import type { HostAdapter, TopviewCanvasSummary } from '../../host/types'
import type { TopviewCanvasAuth } from './hooks/useTopviewCanvasAuth'

const MENU_GAP = 8
const MENU_PAD = 8
const MENU_MAX_H = 280

/** 与 Topview Canvas 列表里已有的名称格式一致，例如 2026-09-09 18:36。 */
function timestampName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function isAuthError(err: unknown): boolean {
  return err instanceof Error && err.message === 'TOPVIEW_CANVAS_AUTH'
}

export function TopviewCanvasSendButton({
  adapter,
  auth,
  loginUrl,
  disabled,
  sending,
  tooltip,
  onSend,
  onUnauthorized,
}: {
  adapter: HostAdapter
  auth: TopviewCanvasAuth
  loginUrl: string
  disabled: boolean
  sending: boolean
  tooltip: string
  onSend: (canvas: TopviewCanvasSummary) => void
  onUnauthorized: () => void
}) {
  const t = useT()
  const portal = usePortalRoot()
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [canvases, setCanvases] = useState<TopviewCanvasSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const needsLogin = auth === 'unauthorized'
  const blocked = disabled || sending || auth === 'checking' || needsLogin

  useEffect(() => {
    if (blocked) setOpen(false)
  }, [blocked])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    void adapter.listTopviewCanvases?.()
      .then((rows) => {
        if (!cancelled) setCanvases(rows)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (isAuthError(err)) {
          setOpen(false)
          onUnauthorized()
        } else setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // onUnauthorized 每次渲染都是新函数，只在打开菜单时拉一次列表。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, adapter])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  useLayoutEffect(() => {
    const menu = menuRef.current
    const trigger = triggerRef.current
    if (open && menu && trigger) placeMenu(menu, trigger)
  }, [open, loading, canvases.length, error])

  const pick = (canvas: TopviewCanvasSummary) => {
    setOpen(false)
    onSend(canvas)
  }

  const createAndSend = async () => {
    setCreating(true)
    setError('')
    try {
      const created = await adapter.createTopviewCanvas?.(timestampName())
      if (created) pick(created)
    } catch (err) {
      if (isAuthError(err)) {
        setOpen(false)
        onUnauthorized()
      } else setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const menu = open ? (
    <div ref={menuRef} className="t3d-dropdown-menu t3d-canvas-menu" role="menu" aria-label={t('export.pickCanvas')}>
      <button
        type="button"
        role="menuitem"
        className="t3d-dropdown-option t3d-canvas-menu-create"
        disabled={creating}
        onClick={() => void createAndSend()}
      >
        {creating ? <span className="t3d-spinner" aria-hidden="true" /> : null}
        <span>+ {t('export.createCanvas')}</span>
      </button>
      <div className="t3d-canvas-menu-divider" />
      {loading ? (
        <div className="t3d-dropdown-menu-title t3d-canvas-menu-loading">
          <span className="t3d-spinner" aria-hidden="true" />
          {t('common.loading')}
        </div>
      ) : null}
      {error ? <div className="t3d-dropdown-menu-title t3d-canvas-menu-error">{error}</div> : null}
      {canvases.map((canvas) => (
        <button
          key={canvas.id}
          type="button"
          role="menuitem"
          className="t3d-dropdown-option"
          disabled={creating}
          onClick={() => pick(canvas)}
        >
          <span>{canvas.name}</span>
        </button>
      ))}
    </div>
  ) : null

  return (
    <>
      {needsLogin && loginUrl ? (
        <a className="t3d-export-signin" href={loginUrl} target="_blank" rel="noopener">
          {t('export.signUpOrIn')}
        </a>
      ) : null}
      <div ref={wrapRef} className="t3d-canvas-send">
        <Tooltip label={needsLogin ? t('export.needSignIn') : tooltip} side="top" variant="description">
          <button
            ref={triggerRef}
            type="button"
            className="t3d-dialog-solid"
            aria-label={t('export.sendToCanvas')}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={blocked}
            aria-busy={sending}
            onClick={() => setOpen((v) => !v)}
          >
            {sending ? (
              <>
                <span className="t3d-spinner" aria-hidden="true" />
                {t('export.sending')}
              </>
            ) : (
              t('export.sendToCanvas')
            )}
          </button>
        </Tooltip>
      </div>
      {menu ? (portal ? createPortal(menu, portal) : menu) : null}
    </>
  )
}

function placeMenu(menu: HTMLElement, trigger: HTMLElement) {
  const rect = trigger.getBoundingClientRect()
  const width = Math.max(rect.width, 220)
  menu.style.width = `${width}px`
  let left = rect.right - width
  if (left < MENU_PAD) left = MENU_PAD
  const menuH = Math.min(menu.scrollHeight, MENU_MAX_H)
  const above = rect.top - MENU_GAP - menuH >= MENU_PAD
  menu.dataset.placement = above ? 'top' : 'bottom'
  menu.style.left = `${left}px`
  menu.style.top = `${above ? rect.top - MENU_GAP - menuH : rect.bottom + MENU_GAP}px`
}
