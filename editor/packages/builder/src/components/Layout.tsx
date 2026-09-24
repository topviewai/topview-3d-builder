import { useRef, type ReactNode, type SyntheticEvent } from 'react'
import { useDirector } from '../bridge/DirectorContext'
import { useT } from '../locale'
import { clampInspectorWidth } from '../stores/EditorStore'
import { cx } from './common/cx'
import { Tooltip } from './common/Tooltip'
import { FilmInspector } from './film/FilmInspector'
import { Inspector } from './inspector'
import { LibraryPanel } from './library'
import { usePanelResize } from './leftrail/hooks/usePanelResize'
import { IconChevron } from './leftrail/icons'
import { TimelinePanel } from './timeline'
import { Topbar } from './topbar'
import { CameraPreview } from './viewport/CameraPreview'
import { Viewport } from './viewport'

export function Layout() {
  const t = useT()
  const { useStore } = useDirector()
  const workspaceMode = useStore((s) => s.workspaceMode)
  const writeLocked = useStore((s) => s.writeLocked)
  const inspectorOpen = useStore((s) => s.inspectorOpen)
  const inspectorWidth = useStore((s) => s.inspectorContentWidth)
  const toggleInspector = useStore((s) => s.toggleInspector)
  const setInspectorContentWidth = useStore((s) => s.setInspectorContentWidth)
  const sideRef = useRef<HTMLElement>(null)
  const { onPointerDown } = usePanelResize(sideRef, inspectorWidth, inspectorOpen, setInspectorContentWidth, {
    invert: true,
    clamp: clampInspectorWidth,
  })

  return (
    <>
      <Topbar />
      <div className="t3d-body">
        <LibraryPanel />
        <div className="t3d-main">
          <div className="t3d-workspace">
            <Viewport />
          </div>
          <TimelinePanel />
        </div>
        <aside ref={sideRef} className={cx('t3d-side', !inspectorOpen && 'is-collapsed')} data-tutorial-anchor="inspector">
          <div className="t3d-side-content">
            <CameraPreview />
            <InspectorWriteBoundary locked={writeLocked}>
              {workspaceMode === 'film' ? <FilmInspector /> : <Inspector />}
            </InspectorWriteBoundary>
          </div>
          {inspectorOpen ? (
            <div
              className="t3d-side-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('inspector.resizeRightPanel')}
              onPointerDown={onPointerDown}
            />
          ) : null}
          <Tooltip label={inspectorOpen ? t('inspector.collapsePanel') : t('inspector.expandPanel')} side="left">
            <button
              type="button"
              className={cx('t3d-side-toggle', !inspectorOpen && 'is-expand')}
              onClick={toggleInspector}
            >
              <IconChevron className={inspectorOpen ? 't3d-side-chevron' : 't3d-side-chevron-expand'} />
            </button>
          </Tooltip>
        </aside>
      </div>
    </>
  )
}

function InspectorWriteBoundary({ locked, children }: { locked: boolean; children: ReactNode }) {
  const guardWriteControl = (event: SyntheticEvent) => {
    if (!locked || !(event.target instanceof Element)) return
    if (event.nativeEvent instanceof KeyboardEvent && (event.nativeEvent.key === 'Tab' || event.nativeEvent.key === 'Escape')) return
    if (event.target.closest('.t3d-inspector-section-head, .t3d-inspector-tab')) return
    if (!event.target.closest('button, input, select, textarea, label, [contenteditable="true"], [role="slider"]')) return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      className="t3d-inspector-write-boundary"
      aria-disabled={locked || undefined}
      onPointerDownCapture={guardWriteControl}
      onClickCapture={guardWriteControl}
      onKeyDownCapture={guardWriteControl}
      onInputCapture={guardWriteControl}
      onChangeCapture={guardWriteControl}
    >
      {children}
    </div>
  )
}
