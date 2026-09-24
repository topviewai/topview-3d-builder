import { nodesOfType } from '../../contract/parser'
import { getActiveEditSequence, getEditSequenceDurationFrames, resolveEditSequenceFrame } from '../../evaluate'
import { formatTimecode } from '../../evaluate/timecode'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { FieldRow, InspectorSection } from '../inspector/PosePanel'
import { formatSeconds } from './utils'
import { useFilmPlayback } from './hooks/useFilmPlayback'

export function FilmInspector() {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const draft = useStore((s) => s.filmAddDraft)
  const playback = useFilmPlayback()
  if (!doc) return <div className="t3d-inspector">{t('common.loading')}</div>
  const sequence = getActiveEditSequence(doc)
  const tl = doc.content.timeline
  const duration = sequence ? getEditSequenceDurationFrames(sequence.clips) : 0
  const resolved = sequence ? resolveEditSequenceFrame(sequence.clips, playback.sequenceFrame) : null
  const cameraId = draft?.cameraNodeId ?? resolved?.cameraNodeId
  const camera = cameraId ? nodesOfType(doc, 'camera').find((node) => node.id === cameraId) : null
  return (
    <div className="t3d-inspector">
      <div className="t3d-inspector-title">{t('film.inspectorTitle')}</div>
      <InspectorSection title={t('film.programInfo')}>
        <FieldRow label={t('film.currentCamera')} value={camera?.name || cameraId || t('common.none')} />
        <FieldRow label={t('film.aspect')} value={doc.content.aspectRatio || t('common.none')} />
        <FieldRow label={t('film.fps')} value={`${tl.fps} fps`} />
      </InspectorSection>
      <InspectorSection title={t('film.versionInfo')}>
        <FieldRow label={t('film.versionName')} value={sequence?.name || t('film.untitledVersion')} />
        <FieldRow label={t('film.shotCount')} value={String(sequence?.clips.length ?? 0)} />
        <FieldRow
          label={t('film.totalDuration')}
          value={`${formatTimecode(duration, tl.fps)} · ${t('film.durationSeconds', { seconds: formatSeconds(duration, tl.fps) })}`}
        />
      </InspectorSection>
      <p className="t3d-film-inspector-hint">{t('film.inspectorHint')}</p>
    </div>
  )
}
