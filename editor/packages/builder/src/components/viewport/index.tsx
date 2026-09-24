import { useEffect, useRef, useState } from 'react'
import type { PathDrawStyle } from '../../stores/types'
import { poseEditEligibleId, cameraPilotEligibleId } from '../../stores/nodeSelection'
import { useDirector } from '../../bridge/DirectorContext'
import { useViewportAttach } from '../../bridge/useViewportAttach'
import { useEngineEvent } from '../../bridge/useEngineEvent'
import { IconCrosshair, IconExitFullscreen, IconFullscreen, IconPath, IconPointer, IconTimeline } from '../leftrail/icons'
import { cx } from '../common/cx'
import { Tooltip } from '../common/Tooltip'
import { useT } from '../../locale'
import { isAutoAspectRatio, resolveAspectRatio } from '../../contract/aspectRatio'
import { useViewportAspect } from '../hooks/useViewportAspect'
import { AxisCompass, ResetViewIcon, type AxisCompassRotation } from './AxisCompass'
import { FloatingAnchor } from './FloatingAnchor'
import { LookAtPreview } from './LookAtPreview'
import { NavigationHint } from './NavigationHint'
import { TimelinePlayHint } from './TimelinePlayHint'
import { useViewportInteractions } from './hooks/useViewportInteractions'

const DRAW_STYLES: [PathDrawStyle, string, string][] = [
  ['click', 'viewport.clickAdd', '↖'],
  ['draw', 'viewport.dragDraw', '✎'],
]

export function Viewport() {
  const t = useT()
  const { useStore } = useDirector()
  const ref = useRef<HTMLCanvasElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const { stage } = useViewportAttach(ref)
  const followMode = useStore((s) => s.followMode)
  const pathDrawMode = useStore((s) => s.pathDrawMode)
  const pathDrawStyle = useStore((s) => s.pathDrawStyle)
  const gizmoMode = useStore((s) => s.gizmoMode)
  const selection = useStore((s) => s.selection)
  const poseEditingId = useStore((s) => s.poseEditingId)
  const cameraPilotId = useStore((s) => s.cameraPilotId)
  const pathEditingId = useStore((s) => s.pathEditingId)
  const pathEditPointIndex = useStore((s) => s.pathEditPointIndex)
  const lookAtPickingId = useStore((s) => s.lookAtPickingId)
  const pathApplyPickingId = useStore((s) => s.pathApplyPickingId)
  const doc = useStore((s) => s.doc)
  const viewportFullscreen = useStore((s) => s.viewportFullscreen)
  const timelineVisible = useStore((s) => s.timelineVisible)
  const timelinePlayHint = useStore((s) => s.timelinePlayHintVisible)
  const film = useStore((s) => s.workspaceMode === 'film')
  const [drawMenuOpen, setDrawMenuOpen] = useState(false)
  const [compassRotation, setCompassRotation] = useState<AxisCompassRotation>(
    () => stage.readEditorCameraRotation(),
  )

  useEffect(() => {
    setCompassRotation(stage.readEditorCameraRotation())
  }, [stage])

  useEngineEvent('camera:change', (next) => {
    setCompassRotation((prev) => (
      Math.abs(prev.x - next.x) < 0.05
      && Math.abs(prev.y - next.y) < 0.05
      && Math.abs(prev.z - next.z) < 0.05
        ? prev
        : next
    ))
  })

  useEffect(() => {
    if (film) {
      stage.syncGizmo(null, gizmoMode, true)
      return
    }
    const nodeId = selection?.kind === 'node' ? selection.nodeId : null
    const suspended = followMode || pathDrawMode || Boolean(poseEditingId) || Boolean(lookAtPickingId) || Boolean(pathApplyPickingId) || Boolean(cameraPilotId)
    const raf = requestAnimationFrame(() => {
      stage.setPoseEditingId(poseEditingId)
      stage.setPathEditing?.(pathEditingId, pathEditPointIndex)
      stage.syncGizmo(
        nodeId,
        gizmoMode,
        suspended && !pathEditingId,
        selection?.kind === 'node' ? selection.nodeIds : undefined,
      )
    })
    return () => cancelAnimationFrame(raf)
  }, [stage, selection, gizmoMode, followMode, pathDrawMode, poseEditingId, cameraPilotId, pathEditingId, pathEditPointIndex, lookAtPickingId, pathApplyPickingId, film])

  useEffect(() => {
    if (!drawMenuOpen) return
    const onDown = (e: PointerEvent) => {
      if (!toolbarRef.current?.contains(e.target as Node)) setDrawMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [drawMenuOpen])

  const { selectionBox, lookAtHoverId } = useViewportInteractions(ref)

  const poseEligible = poseEditEligibleId(doc?.content.nodes ?? [], selection)
  const pilotEligible = cameraPilotEligibleId(doc?.content.nodes ?? [], selection)
  const pilotAspectAuto = Boolean(cameraPilotId && isAutoAspectRatio(doc?.content.aspectRatio))
  const viewportAspect = useViewportAspect(pilotAspectAuto)
  const pilotAspect = resolveAspectRatio(doc?.content.aspectRatio, viewportAspect)
  const idleModes = !lookAtPickingId && !pathApplyPickingId && !followMode && !pathDrawMode && !pathEditingId && !film && !cameraPilotId
  const aimPickingId = lookAtPickingId || pathApplyPickingId

  return (
    <div className={cx('t3d-viewport', aimPickingId && 't3d-viewport-look-at-picking')} data-tutorial-anchor="viewport">
      <canvas ref={ref} className="t3d-viewport-canvas" />
      <NavigationHint hidden={film || followMode || pathDrawMode || Boolean(poseEditingId) || Boolean(aimPickingId) || Boolean(cameraPilotId)} />
      {aimPickingId ? (
        <LookAtPreview stage={stage} cameraId={aimPickingId} hoverId={lookAtHoverId} />
      ) : null}
      {lookAtPickingId ? (
        <div className="t3d-look-at-prompt" role="status" onPointerDown={(e) => e.stopPropagation()}>
          <span>{t('viewport.lookAtPick')}</span>
          <button type="button" onClick={() => useStore.getState().cancelLookAtPick()}>
            {t('viewport.lookAtCancel')}
          </button>
        </div>
      ) : null}
      {pathApplyPickingId ? (
        <div className="t3d-look-at-prompt" role="status" onPointerDown={(e) => e.stopPropagation()}>
          <span>{t('viewport.pathApplyPick')}</span>
          <button type="button" onClick={() => useStore.getState().cancelPathApplyPick()}>
            {t('viewport.lookAtCancel')}
          </button>
        </div>
      ) : null}
      {cameraPilotId ? (
        <div className="t3d-pose-editor-hint" role="status" onPointerDown={(e) => e.stopPropagation()}>
          <span>{t('viewport.pilotHint')}</span>
          <button type="button" className="t3d-hint-action" onClick={() => useStore.getState().setCameraPilot(null)}>
            {t('viewport.pilotExit')}
          </button>
        </div>
      ) : null}
      {cameraPilotId ? (
        <div className="t3d-pilot-mask" aria-hidden="true">
          <div
            className="t3d-pilot-frame"
            style={{ ['--t3d-pilot-aspect' as string]: String(pilotAspect) }}
          />
        </div>
      ) : null}
      {poseEditingId ? (
        <div className="t3d-pose-editor-hint" role="status" onPointerDown={(e) => e.stopPropagation()}>
          <span>{t('viewport.poseDragHint')}</span>
          <button type="button" className="t3d-hint-action" onClick={() => useStore.getState().setPoseEditingId(null)}>
            {t('viewport.finishPose')}
          </button>
        </div>
      ) : null}
      {pathEditingId ? (
        <div className="t3d-pose-editor-hint" role="status" onPointerDown={(e) => e.stopPropagation()}>
          <span>{t('viewport.pathEditHint')}</span>
          <button type="button" className="t3d-hint-action" onClick={() => useStore.getState().setPathEditingId(null)}>
            {t('viewport.finish')}
          </button>
        </div>
      ) : null}
      {poseEligible && idleModes && poseEditingId !== poseEligible ? (
        <FloatingAnchor stage={stage} nodeId={poseEligible} placement="above-label">
          <button
            type="button"
            className="t3d-viewport-float-btn"
            aria-pressed={poseEditingId === poseEligible}
            onClick={() => useStore.getState().setPoseEditingId(poseEditingId === poseEligible ? null : poseEligible)}
          >
            {t(poseEditingId === poseEligible ? 'viewport.finishPose' : 'viewport.editPose')}
          </button>
        </FloatingAnchor>
      ) : null}
      {pilotEligible && idleModes ? (
        <FloatingAnchor stage={stage} nodeId={pilotEligible} placement="above">
          <button
            type="button"
            className="t3d-viewport-float-btn"
            onClick={() => useStore.getState().setCameraPilot(pilotEligible)}
          >
            {t('viewport.pilotCamera')}
          </button>
        </FloatingAnchor>
      ) : null}
      {lookAtPickingId ? (
        <FloatingAnchor stage={stage} nodeId={lookAtPickingId} placement="above">
          <button
            type="button"
            className="t3d-viewport-float-btn"
            aria-pressed
            onClick={() => useStore.getState().cancelLookAtPick()}
          >
            <IconCrosshair />
            <span>{t('viewport.lookAtCancel')}</span>
          </button>
        </FloatingAnchor>
      ) : null}
      {pathApplyPickingId ? (
        <FloatingAnchor stage={stage} nodeId={pathApplyPickingId} placement="above">
          <button
            type="button"
            className="t3d-viewport-float-btn"
            aria-pressed
            onClick={() => useStore.getState().cancelPathApplyPick()}
          >
            <IconCrosshair />
            <span>{t('viewport.lookAtCancel')}</span>
          </button>
        </FloatingAnchor>
      ) : null}
      {selectionBox && (selectionBox.width >= 1 || selectionBox.height >= 1) ? (
        <div
          className="t3d-viewport-selection-box"
          style={{
            left: selectionBox.left,
            top: selectionBox.top,
            width: selectionBox.width,
            height: selectionBox.height,
          }}
          aria-hidden
        />
      ) : null}
      {!film && !cameraPilotId ? (
        <div className="t3d-viewport-compass-stack">
          <AxisCompass rotation={compassRotation} />
          <button
            type="button"
            className="t3d-reset-view-btn"
            onClick={() => useStore.getState().resetEditorView()}
          >
            <ResetViewIcon />
            <span>{t('viewport.resetView')}</span>
          </button>
        </div>
      ) : null}
      {followMode && !film && (
        <button type="button" className="t3d-follow-exit t3d-hint-action" onClick={() => useStore.getState().setFollowMode(false)}>
          {t('viewport.exitCameraView')}
        </button>
      )}
      {pathDrawMode && !film && (
        <div className="t3d-path-draw-bar">
          <span className="t3d-path-draw-glyph">⌥</span>
          <span className="t3d-path-draw-status">{t('viewport.pathEditing')}</span>
          <button
            type="button"
            className="t3d-path-draw-action"
            title={t('viewport.savePath')}
            onClick={() => useStore.getState().finishPathDraw()}
          >
            {t('save.action')}
          </button>
          <button
            type="button"
            className="t3d-path-draw-action"
            title={t('viewport.discardPath')}
            onClick={() => useStore.getState().setPathDrawMode(false)}
          >
            {t('common.cancel')}
          </button>
        </div>
      )}
      {!followMode && !film ? (
        <div className="t3d-viewport-bottom">
          <div className="t3d-gizmo-toolbar" ref={toolbarRef} data-tutorial-anchor="tools">
            <div className="t3d-gizmo-group">
              <Tooltip label={t('viewport.select')} side="top">
                <button type="button"
                  className={cx('t3d-gizmo-btn', gizmoMode === 'translate' && !pathDrawMode && 't3d-gizmo-btn-active')}
                  onClick={() => {
                    const state = useStore.getState()
                    state.setPathDrawMode(false)
                    state.setGizmoMode('translate')
                    setDrawMenuOpen(false)
                  }}>
                  <IconPointer />
                </button>
              </Tooltip>
            </div>
            <Tooltip label={t('viewport.drawPath')} side="top">
              <button
                type="button"
                className={`t3d-gizmo-btn t3d-path-draw-btn${pathDrawMode ? ' t3d-gizmo-btn-active' : ''}`}
                onClick={() => setDrawMenuOpen((o) => !o)}
              >
                <IconPath />
              </button>
            </Tooltip>
            <div className="t3d-timeline-hint-anchor" aria-live="polite">
              {timelinePlayHint ? <TimelinePlayHint /> : null}
              <Tooltip label={timelinePlayHint ? '' : t('viewport.timeline')} side="top">
                <button
                  type="button"
                  className={cx('t3d-gizmo-btn', timelineVisible && 't3d-gizmo-btn-active', timelinePlayHint && 'is-play-hint')}
                  aria-pressed={timelineVisible}
                  aria-label={t('viewport.timeline')}
                  onClick={() => {
                    const state = useStore.getState()
                    const opening = state.timelinePlayHintVisible || !state.timelineVisible
                    if (state.timelinePlayHintVisible) state.acceptTimelinePlayHint()
                    else state.toggleTimelinePanel()
                    // 全屏沉浸时展开时间轴，同时退出全屏。
                    if (opening && state.viewportFullscreen) state.toggleViewportFullscreen()
                  }}
                >
                  <IconTimeline />
                </button>
              </Tooltip>
            </div>
            {drawMenuOpen && (
              <div className="t3d-dropdown-menu is-anchored t3d-draw-style-menu" data-placement="top" role="listbox">
                {DRAW_STYLES.map(([s, labelKey, glyph]) => (
                  <button
                    type="button"
                    key={s}
                    role="option"
                    aria-selected={pathDrawStyle === s}
                    className={cx('t3d-dropdown-option', pathDrawStyle === s && 'is-active')}
                    onClick={() => {
                      const st = useStore.getState()
                      st.setPathDrawStyle(s)
                      st.setPathDrawMode(true)
                      setDrawMenuOpen(false)
                    }}
                  >
                    <span className="t3d-draw-style-glyph">{glyph}</span>
                    <span>{t(labelKey)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
      <div className="t3d-viewport-fs-wrap">
        <Tooltip
          label={t(viewportFullscreen ? 'viewport.exitFullscreen' : 'viewport.fullscreen')}
          side="top"
        >
          <button
            type="button"
            className={cx('t3d-viewport-fs', viewportFullscreen && 't3d-viewport-fs-active')}
            aria-pressed={viewportFullscreen}
            onClick={() => useStore.getState().toggleViewportFullscreen()}
          >
            {viewportFullscreen ? <IconExitFullscreen /> : <IconFullscreen />}
          </button>
        </Tooltip>
      </div>
      {film ? null : (
      <div className="t3d-viewport-hint">
        {pathDrawMode
          ? pathDrawStyle === 'click'
            ? t('viewport.hintClick')
            : t('viewport.hintDraw')
          : followMode
            ? t('viewport.hintFollow')
            : t('viewport.hintOrbit')}
      </div>
      )}
    </div>
  )
}
