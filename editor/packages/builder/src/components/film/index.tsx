import { getActiveEditSequence, findEditClip, getEditorial, playbackIssues } from '../../evaluate'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { clampFilmTimelineHeight } from '../../stores/EditorStore'
import { cx } from '../common/cx'
import { Tooltip } from '../common/Tooltip'
import { useVerticalResize } from '../leftrail/hooks/usePanelResize'
import { IconChevron } from '../leftrail/icons'
import { FilmExportDialog } from './FilmExportDialog'
import { FilmSequenceTrack } from './FilmSequenceTrack'
import { FilmCameraPanel } from './FilmCameraPanel'
import { FilmToolbar } from './FilmToolbar'

export function FilmPanel() {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const open = useStore((s) => s.timelineOpen)
  const height = useStore((s) => s.filmTimelineHeight)
  const pxPerFrame = useStore((s) => s.filmPxPerFrame)
  const selection = useStore((s) => s.filmSelection)
  const draft = useStore((s) => s.filmAddDraft)
  const browseCamera = useStore((s) => s.filmBrowseCameraId)
  const activeCameraId = useStore((s) => s.activeCameraId)
  const exporting = useStore((s) => s.exporting)
  const exportOpen = useStore((s) => s.filmExportOpen)
  const { toggleTimeline, setFilmTimelineHeight, setFilmExportOpen } = useStore()
  const { onPointerDown } = useVerticalResize(height, open, setFilmTimelineHeight, clampFilmTimelineHeight)
  const sequence = doc ? getActiveEditSequence(doc) : null
  const editorial = doc ? getEditorial(doc) : null
  const selected = doc && selection ? findEditClip(getEditorial(doc), selection.clipId) : null
  const clip = selected?.sequence.clips[selected.clipIndex] ?? null
  // empty-sequence already has its own call-to-action inside the track
  const issues = (doc && sequence ? playbackIssues(doc, sequence.id) : [])
    .filter((issue) => issue.code !== 'empty-sequence')
  // 拖拽期间不置灰任何控件：指针已被 window 捕获，点不到别处，
  // 整片变灰只会让拖动过程一直闪。
  const disabled = exporting

  return (
    <div
      className={cx('t3d-timeline', 't3d-film-panel', !open && 'is-collapsed')}
      data-tutorial-anchor="timeline"
      style={{ ['--t3d-timeline-height' as string]: `${height}px` }}
    >
      <Tooltip label={open ? t('timeline.collapse') : t('timeline.expand')} side="top">
        <button type="button" className="t3d-timeline-fold" onClick={toggleTimeline}>
          <IconChevron className="t3d-timeline-fold-icon" />
        </button>
      </Tooltip>
      {open ? (
        <div
          className="t3d-timeline-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('timeline.resize')}
          onPointerDown={onPointerDown}
        />
      ) : null}
      <FilmToolbar disabled={exporting} />
      {open && doc && sequence ? (
        <div className="t3d-film-body">
          {issues.length > 0 ? (
            <div className="t3d-film-issues" role="alert">
              {issues.map((issue) => (
                <div key={`${issue.code}-${issue.clipId ?? issue.sequenceId}`}>{t(`film.issue.${issue.code}`)}</div>
              ))}
            </div>
          ) : null}
          <FilmCameraPanel
            document={doc}
            sequence={sequence}
            cameraNodeId={browseCamera ?? activeCameraId}
            clip={clip}
            draft={draft}
            disabled={disabled}
          />
          <FilmSequenceTrack document={doc} sequence={sequence} pxPerFrame={pxPerFrame} disabled={disabled} />
        </div>
      ) : null}
      {exportOpen && editorial ? (
        <FilmExportDialog sequenceId={editorial.activeSequenceId} onClose={() => setFilmExportOpen(false)} />
      ) : null}
    </div>
  )
}
