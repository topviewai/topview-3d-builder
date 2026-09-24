import { useRef, type ReactElement } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { cx } from '../common/cx'
import { Tooltip } from '../common/Tooltip'
import { CatalogPane } from './CatalogPane'
import { TAB_ORDER } from './constants'
import { usePanelResize } from './hooks/usePanelResize'
import { IconRail } from './IconRail'
import { IconChevron } from './icons'
import { ObjectTree } from './ObjectTree'

export function LeftRail(): ReactElement | null {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const film = useStore((s) => s.workspaceMode === 'film')
  const libraryOpen = useStore((s) => s.libraryOpen)
  const tab = useStore((s) => s.libraryTab)
  const width = useStore((s) => s.libraryContentWidth)
  const { toggleLibrary, setLibraryTab, setLibraryContentWidth } = useStore()
  const contentRef = useRef<HTMLDivElement>(null)
  const { onPointerDown } = usePanelResize(contentRef, width, libraryOpen, setLibraryContentWidth)

  if (!doc) return null
  const resolvedTab = film ? 'object' : TAB_ORDER.includes(tab) ? tab : 'object'

  return (
    <div className="t3d-leftrail-slot">
      <div className="t3d-leftrail">
        <IconRail
          tab={resolvedTab}
          open={libraryOpen}
          t={t}
          tabs={film ? ['object'] : TAB_ORDER}
          onSelect={film ? () => setLibraryTab('object') : setLibraryTab}
          onToggle={toggleLibrary}
        />
        <div
          ref={contentRef}
          className={cx('t3d-leftrail-content', !libraryOpen && 'is-collapsed')}
          data-tutorial-anchor="leftrail"
        >
          {film || resolvedTab === 'object' ? <ObjectTree /> : <CatalogPane tab={resolvedTab} />}
        </div>
        {libraryOpen ? (
          <>
            <div
              className="t3d-leftrail-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('library.resizeLeftPanel')}
              onPointerDown={onPointerDown}
            />
            <Tooltip label={t('library.collapseContent')} side="right">
              <button type="button" className="t3d-leftrail-collapse" onClick={toggleLibrary}>
                <IconChevron className="t3d-leftrail-chevron-icon" />
              </button>
            </Tooltip>
          </>
        ) : null}
      </div>
    </div>
  )
}

export { LeftRail as LibraryPanel }
