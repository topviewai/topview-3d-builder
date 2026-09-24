import { nodesOfType } from '../../contract/parser'
import { getActiveEditSequence, resolveEditSequenceFrame } from '../../evaluate'
import { formatTimecode } from '../../evaluate/timecode'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { cx } from '../common/cx'
import { useFilmPlayback } from './hooks/useFilmPlayback'

export function FilmHud() {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const draft = useStore((s) => s.filmAddDraft)
  const playback = useFilmPlayback()
  if (!doc) return null
  const sequence = getActiveEditSequence(doc)
  const resolved = sequence ? resolveEditSequenceFrame(sequence.clips, playback.sequenceFrame) : null
  const sourceMode = playback.mode === 'source' || Boolean(draft)
  const cameraId = draft?.cameraNodeId ?? resolved?.cameraNodeId
  const camera = cameraId ? nodesOfType(doc, 'camera').find((node) => node.id === cameraId) : null
  const fps = doc.content.timeline.fps
  const sourceFrame = sourceMode ? playback.sourcePreviewFrame : resolved?.sourceFrame ?? 0
  return (
    <>
      <div className="t3d-film-hud">
        <span className={cx('t3d-film-hud-badge', sourceMode && 'is-source')}>
          {sourceMode ? t('film.hudSource') : t('film.hudProgram')}
        </span>
        <strong className="t3d-film-hud-camera">{camera?.name || cameraId || t('common.none')}</strong>
      </div>
      <div className="t3d-film-hud-time">
        <span>{sourceMode ? t('film.hudSource') : t('film.hudProgram')}</span>
        <strong>{formatTimecode(sourceMode ? sourceFrame : playback.sequenceFrame, fps)}</strong>
      </div>
    </>
  )
}
