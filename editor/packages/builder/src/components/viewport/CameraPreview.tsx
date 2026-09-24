import { useEffect, useRef, useState } from 'react'
import { isAutoAspectRatio, resolveAspectRatio } from '../../contract/aspectRatio'
import { nodesOfType } from '../../contract/parser'
import { findEditClip, getEditorial } from '../../evaluate'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { Dropdown } from '../common/Dropdown'
import { displayCameraName } from '../displayNames'
import { cx } from '../common/cx'
import { Tooltip } from '../common/Tooltip'
import { useViewportAspect } from '../hooks/useViewportAspect'
import { IconChevron, IconLocate } from '../leftrail/icons'

export function CameraPreview() {
  const t = useT()
  const { stage, useStore } = useDirector()
  const ref = useRef<HTMLCanvasElement>(null)
  const doc = useStore((s) => s.doc)
  const ready = useStore((s) => s.ready)
  const activeCameraId = useStore((s) => s.activeCameraId)
  const setActiveCamera = useStore((s) => s.setActiveCamera)
  const film = useStore((s) => s.workspaceMode === 'film')
  const filmSelection = useStore((s) => s.filmSelection)
  const filmDraft = useStore((s) => s.filmAddDraft)
  const followMode = useStore((s) => s.followMode)
  const setFollowMode = useStore((s) => s.setFollowMode)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    stage.attachViewport('preview', canvas)
    return () => stage.detachViewport('preview')
  }, [stage])

  const cameras = doc ? nodesOfType(doc, 'camera') : []
  const filmFound = doc && filmSelection ? findEditClip(getEditorial(doc), filmSelection.clipId) : null
  const filmCameraId = filmDraft?.cameraNodeId
    ?? (filmFound ? filmFound.sequence.clips[filmFound.clipIndex]?.cameraNodeId : null)
  const previewCameraId = film ? (filmCameraId ?? activeCameraId) : activeCameraId
  const viewportAspect = useViewportAspect(Boolean(ready && isAutoAspectRatio(doc?.content.aspectRatio)))
  const previewAspect = resolveAspectRatio(doc?.content.aspectRatio, viewportAspect)

  return (
    <div className={cx('t3d-preview', !open && 'is-collapsed')}>
      <Tooltip label={open ? t('viewport.collapsePreview') : t('viewport.expandPreview')} side="top">
        <button type="button" className="t3d-preview-title" onClick={() => setOpen((v) => !v)}>
          <IconChevron className={cx('t3d-inspector-chevron', open && 'is-open')} />
          {t('viewport.previewTitle')}
          {followMode && !film && <span className="t3d-preview-mode-badge">{t('viewport.cameraViewActive')}</span>}
        </button>
      </Tooltip>
      <div className="t3d-preview-body" hidden={!open}>
        <div className="t3d-preview-cam-row">
          <Dropdown
            ariaLabel={t('viewport.pickCamera')}
            value={previewCameraId ?? ''}
            disabled={!ready || film}
            options={cameras.map((c) => ({ value: c.id, label: displayCameraName(t, c.name) }))}
            onChange={setActiveCamera}
          />
        </div>
        {!film && <button
          type="button"
          className={cx('t3d-preview-mode-button', followMode && 'is-active')}
          aria-pressed={followMode}
          onClick={() => setFollowMode(!followMode)}
          disabled={!ready || !activeCameraId}
        >
          <IconLocate />
          {t(followMode ? 'viewport.exitCameraView' : 'viewport.enterCameraView')}
        </button>}
        <div
          className="t3d-preview-canvas-wrap"
          style={{
            ['--t3d-preview-aspect' as string]: String(previewAspect),
          }}
        >
          <canvas ref={ref} className="t3d-preview-canvas" />
          {!ready && <div className="t3d-preview-loading">{t('common.loading')}</div>}
        </div>
        {!film && <p className="t3d-preview-hint" role="status">
          {t(followMode ? 'viewport.cameraViewActiveHint' : 'viewport.cameraViewHint')}
        </p>}
      </div>
    </div>
  )
}
