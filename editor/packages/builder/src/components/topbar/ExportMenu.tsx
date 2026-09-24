import { useEffect, useRef, useState } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { useEngine } from '../../bridge/useEngine'
import { widthFromAspectHeight } from '../../contract/aspectRatio'
import { nodesOfType } from '../../contract/parser'
import { useT } from '../../locale'
import { Tooltip } from '../common/Tooltip'
import { ExportDialog } from '../dialogs/ExportDialog'
import { ExportGlyph } from './icons'

const SNAPSHOT_HEIGHT = 1080

export function ExportMenu({ disabled }: { disabled: boolean }) {
  const t = useT()
  const { useStore, adapter } = useDirector()
  const engine = useEngine()
  const ready = useStore((s) => s.ready)
  const exporting = useStore((s) => s.exporting)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [renderOpen, setRenderOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (wrapRef.current?.contains(target)) return
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

  const captureSnapshot = async () => {
    const s = useStore.getState()
    const doc = s.doc
    const cameraId = s.activeCameraId
    if (!doc || !cameraId) {
      setError(t('topbar.exportNeedCamera'))
      return
    }
    const cam = nodesOfType(doc, 'camera').find((c) => c.id === cameraId)
    const label = (cam?.name || cameraId).replace(/[\\/:*?"<>|\s]+/g, '_')
    const height = SNAPSHOT_HEIGHT
    const width = widthFromAspectHeight(height, engine.resolvedAspect())
    setError('')
    s.setExporting(true)
    try {
      await engine.captureFrame({
        onExport: adapter.onExport?.bind(adapter),
        cameraId,
        label,
        frame: s.frame,
        width,
        height,
        userKeys: s.userKeys,
        userKeysEnabled: s.userKeysEnabled,
        chainCameraMotion: s.chainCameraMotion,
      })
      setOpen(false)
    } catch (e) {
      setError(t('topbar.exportSnapshotFailed', { error: e instanceof Error ? e.message : String(e) }))
    } finally {
      s.setExporting(false)
      engine.seek(s.frame)
    }
  }

  const label = t('topbar.exportMenu')
  const tip = exporting ? t('help.exporting') : !ready ? t('help.loading') : ''
  const trigger = (
    <button
      type="button"
      className="t3d-topbar-export-btn"
      disabled={disabled}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => {
        if (!disabled) setOpen((v) => !v)
      }}
    >
      <ExportGlyph />
      <span>{label}</span>
    </button>
  )

  return (
    <div className="t3d-topbar-menu" ref={wrapRef}>
      {tip ? (
        <Tooltip label={tip} variant="description">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      {open ? (
        <div className="t3d-dropdown-menu is-anchored t3d-topbar-menu-panel" role="menu">
          <button
            type="button"
            role="menuitem"
            className="t3d-dropdown-option"
            disabled={!ready || exporting}
            onClick={() => void captureSnapshot()}
          >
            <span>{t('topbar.exportSnapshot')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="t3d-dropdown-option"
            disabled={!ready || exporting}
            onClick={() => {
              setOpen(false)
              setRenderOpen(true)
            }}
          >
            <span>{t('topbar.exportRender')}</span>
          </button>
          {error ? <div className="t3d-topbar-menu-error">{error}</div> : null}
        </div>
      ) : null}
      {renderOpen ? <ExportDialog onClose={() => setRenderOpen(false)} /> : null}
    </div>
  )
}
