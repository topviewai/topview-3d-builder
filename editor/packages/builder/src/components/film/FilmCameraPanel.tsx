import { Tooltip } from '../common/Tooltip'
import { useMemo } from 'react'
import { nodesOfType } from '../../contract/parser'
import type { DirectorDocument, EditSequence, EditSequenceClip } from '../../contract/types'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import type { FilmAddDraft } from '../../stores/types'
import { Dropdown } from '../common/Dropdown'
import { displayCameraName } from '../displayNames'
import { IconPause, IconPlay } from '../leftrail/icons'
import { FilmSourceLane } from './FilmSourceLane'
import { buildUsedRanges, clipIssueCodes } from './utils'

/**
 * 常驻机位面板：上半切机位，下半是这台机位的整条源时间轴。
 * 选中分镜时改的是那条分镜的机位，未选中时只换看哪台机位。
 */
export function FilmCameraPanel({
  document,
  sequence,
  cameraNodeId,
  clip,
  draft,
  disabled,
}: {
  document: DirectorDocument
  sequence: EditSequence
  cameraNodeId: string | null
  clip: EditSequenceClip | null
  draft: FilmAddDraft | null
  disabled?: boolean
}) {
  const t = useT()
  const { useStore } = useDirector()
  const preview = useStore((s) => s.filmDragPreview)
  const filmClock = useStore((s) => s.filmClock)
  const exporting = useStore((s) => s.exporting)
  const writeLocked = useStore((s) => s.writeLocked)
  const {
    setFilmBrowseCamera,
    beginFilmAddDraft,
    commitFilmAddDraft,
    cancelFilmAddDraft,
    playFilmSource,
    pauseFilm,
  } = useStore()
  const cameras = nodesOfType(document, 'camera')
  const live = preview && clip && preview.clipId === clip.id
    ? { cameraNodeId: preview.cameraNodeId, sourceFrameStart: preview.sourceFrameStart, sourceFrameEnd: preview.sourceFrameEnd }
    : null
  const working = live ?? draft ?? clip
  const laneCamera = working?.cameraNodeId ?? cameraNodeId ?? cameras[0]?.id ?? ''
  const usedRanges = useMemo(
    () => buildUsedRanges(sequence.clips, laneCamera),
    [sequence.clips, laneCamera],
  )
  const issues = clip && !draft ? clipIssueCodes(document, clip.id) : []
  const sourcePlaying = filmClock === 'source'
  const canPlayClip = Boolean(clip || draft) && !disabled && !exporting

  const busyHelp = exporting || disabled ? t('help.exporting') : ''
  const addHelp = busyHelp || (cameras.length === 0 ? t('help.needCamera') : draft ? t('help.finishDraft') : clip ? t('film.browseHint') : '')
  const cameraHelp = busyHelp || (cameras.length === 0 ? t('help.needCamera') : t(draft ? 'help.cameraDraft' : clip ? 'help.cameraReplace' : 'help.cameraBrowse'))
  const playHelp = sourcePlaying ? '' : busyHelp || (!canPlayClip ? t('help.selectClip') : '')

  return (
    <div className="t3d-film-camera-panel">
      <div className="t3d-film-camera-top">
        <div className="t3d-film-camera-pick">
          <Dropdown
            className="t3d-film-select"
            ariaLabel={t('film.camera')}
            tooltip={cameraHelp}
            value={laneCamera}
            disabled={disabled || cameras.length === 0 || (writeLocked && Boolean(working))}
            options={[
              ...cameras.map((camera) => ({ value: camera.id, label: displayCameraName(t, camera.name) })),
              ...(laneCamera && !cameras.some((camera) => camera.id === laneCamera)
                ? [{ value: laneCamera, label: laneCamera }]
                : []),
            ]}
            onChange={setFilmBrowseCamera}
          />
          {sequence.clips.length > 0 ? (
            <Tooltip label={addHelp} side="top" variant="description">
              <button
                type="button"
                className="t3d-film-btn"
                disabled={disabled || writeLocked || exporting || Boolean(draft) || cameras.length === 0}
                onClick={() => beginFilmAddDraft(null)}
              >
                {t('film.addClip')}
              </button>
            </Tooltip>
          ) : null}
          <Tooltip label={playHelp} side="top" variant="description">
            <button
              type="button"
              className="t3d-film-btn t3d-film-play-clip"
              disabled={!canPlayClip && !sourcePlaying}
              aria-label={t(sourcePlaying ? 'timeline.pause' : 'film.playSelectedClip')}
              onClick={() => (sourcePlaying ? pauseFilm() : playFilmSource())}
            >
              {sourcePlaying ? <IconPause className="t3d-film-btn-icon" /> : <IconPlay className="t3d-film-btn-icon" />}
              {t(sourcePlaying ? 'timeline.pause' : 'film.playSelectedClip')}
            </button>
          </Tooltip>
        </div>
        {clip || draft ? null : (
          <span className="t3d-film-camera-hint">{t('film.browseHint')}</span>
        )}
        {draft ? (
          <div className="t3d-film-camera-actions">
            <button type="button" className="t3d-film-btn" disabled={disabled} onClick={cancelFilmAddDraft}>
              {t('common.cancel')}
            </button>
            <Tooltip label={busyHelp} side="top" variant="description">
              <button type="button" className="t3d-film-btn is-primary" disabled={disabled || writeLocked} onClick={commitFilmAddDraft}>
                {t('film.addToFilm')}
              </button>
            </Tooltip>
          </div>
        ) : null}
      </div>
      {issues.length > 0 ? (
        <div className="t3d-film-editor-issues" role="alert">
          {issues.map((code) => <span key={code}>{t(`film.issue.${code}`)}</span>)}
        </div>
      ) : null}
      <FilmSourceLane
        document={document}
        cameraNodeId={laneCamera}
        clip={clip}
        working={working}
        usedRanges={usedRanges}
        isDraft={Boolean(draft)}
        disabled={disabled}
      />
    </div>
  )
}
