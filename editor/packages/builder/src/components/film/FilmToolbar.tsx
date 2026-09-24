import { getActiveEditSequence, getEditSequenceDurationFrames, playbackIssues } from '../../evaluate'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { IconPause, IconPlay, IconToEnd, IconToStart } from '../leftrail/icons'
import { Tooltip } from '../common/Tooltip'
import { RangeSlider } from '../common/RangeSlider'
import { FilmModeSwitch } from './FilmModeSwitch'
import { IconFit, IconRedo, IconUndo } from './icons'

export function FilmToolbar({
  disabled,
}: {
  disabled?: boolean
}) {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const exporting = useStore((s) => s.exporting)
  const filmClock = useStore((s) => s.filmClock)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)
  const writeLocked = useStore((s) => s.writeLocked)
  const filmPxPerFrame = useStore((s) => s.filmPxPerFrame)
  const seekFilmSequence = useStore((s) => s.seekFilmSequence)
  const togglePlay = useStore((s) => s.togglePlay)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const setFilmPxPerFrame = useStore((s) => s.setFilmPxPerFrame)
  const fitFilmSequence = useStore((s) => s.fitFilmSequence)
  const setFilmExportOpen = useStore((s) => s.setFilmExportOpen)
  const sequence = doc ? getActiveEditSequence(doc) : null
  const duration = sequence ? getEditSequenceDurationFrames(sequence.clips) : 0
  const issues = doc && sequence ? playbackIssues(doc, sequence.id) : []
  const blockedHelp = exporting || disabled ? t('help.exporting')
    : duration <= 0 ? t('help.needClip')
      : issues.length > 0 ? t('film.issue.' + issues[0].code) : ''
  const blocked = disabled || exporting || issues.length > 0 || duration <= 0

  return (
    <div className="t3d-timeline-toolbar t3d-film-toolbar">
      <div className="t3d-film-toolbar-left">
        <FilmModeSwitch disabled={disabled || exporting} />
      </div>
      <div className="t3d-film-toolbar-center">
        <div className="t3d-film-transport">
          <Tooltip label={blockedHelp || t('timeline.toStart')} variant="description" side="top">
            <button type="button" className="t3d-timeline-icon-btn" aria-label={t('timeline.toStart')} disabled={blocked} onClick={() => seekFilmSequence(0)}>
              <IconToStart />
            </button>
          </Tooltip>
          <Tooltip label={filmClock === 'idle' ? blockedHelp || t('timeline.play') : t('timeline.pause')} variant="description" side="top">
            <button
              type="button"
              className="t3d-timeline-icon-btn t3d-film-play"
              aria-label={t(filmClock === 'idle' ? 'timeline.play' : 'timeline.pause')}
              disabled={blocked && filmClock === 'idle'}
              onClick={togglePlay}
            >
              {filmClock === 'idle' ? <IconPlay /> : <IconPause />}
            </button>
          </Tooltip>
          <Tooltip label={blockedHelp || t('timeline.toEnd')} variant="description" side="top">
            <button type="button" className="t3d-timeline-icon-btn" aria-label={t('timeline.toEnd')} disabled={blocked} onClick={() => seekFilmSequence(Math.max(0, duration - 1))}>
              <IconToEnd />
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="t3d-film-toolbar-right">
        <RangeSlider
          className="t3d-film-zoom"
          title={t('timeline.zoom')}
          min={0.4}
          max={16}
          step={0.1}
          value={filmPxPerFrame}
          disabled={disabled}
          aria-label={t('timeline.zoom')}
          onChange={(event) => setFilmPxPerFrame(Number(event.target.value))}
        />
        <Tooltip label={t('film.fit')} side="top">
          <button type="button" className="t3d-timeline-icon-btn" disabled={disabled} onClick={fitFilmSequence}>
            <IconFit />
          </button>
        </Tooltip>
        <span className="t3d-film-toolbar-divider" aria-hidden />
        <Tooltip label={t('film.undo')} side="top">
          <button type="button" className="t3d-timeline-icon-btn" disabled={writeLocked || !canUndo || exporting} onClick={undo}>
            <IconUndo />
          </button>
        </Tooltip>
        <Tooltip label={t('film.redo')} side="top">
          <button type="button" className="t3d-timeline-icon-btn" disabled={writeLocked || !canRedo || exporting} onClick={redo}>
            <IconRedo />
          </button>
        </Tooltip>
        <Tooltip label={blockedHelp} side="top" variant="description">
          <button
            aria-label={t('film.export')}
            type="button"
            className="t3d-film-btn is-solid-white"
            disabled={blocked}
            onClick={() => setFilmExportOpen(true)}
          >
            {t('film.export')}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
