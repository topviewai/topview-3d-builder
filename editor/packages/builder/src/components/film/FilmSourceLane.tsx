import { useMemo, useRef } from 'react'
import type { DirectorDocument, EditSequenceClip } from '../../contract/types'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { cx } from '../common/cx'
import { IconTrimLeft, IconTrimRight } from './icons'
import { useFilmPlayback } from './hooks/useFilmPlayback'
import { useFilmThumbnails } from './hooks/useFilmThumbnails'
import { useSourceDrag } from './hooks/useSourceDrag'
import type { SourceWorkingRange, UsedRange } from './types'
import { SOURCE_LANE_PX } from './constants'
import {
  buildSourceStripFrames,
  buildSourceTicks,
  displayDuration,
  formatFilmPlayhead,
  frameFromClientX,
  resolveThumbHeight,
} from './utils'

const SOURCE_THUMB_HEIGHT = resolveThumbHeight(SOURCE_LANE_PX)

export type { SourceWorkingRange }

export function FilmSourceLane({
  document,
  cameraNodeId,
  clip,
  working,
  usedRanges,
  isDraft,
  disabled,
}: {
  document: DirectorDocument
  /** 面板当前在看哪台机位；与 working 的机位一致，未选中分镜时由浏览态决定。 */
  cameraNodeId: string
  clip: EditSequenceClip | null
  /** 正在编辑的区间；未选中分镜也没有草稿时为 null，此时源条只读。 */
  working: SourceWorkingRange | null
  usedRanges: UsedRange[]
  isDraft: boolean
  disabled?: boolean
}) {
  void usedRanges

  const t = useT()
  const { useStore } = useDirector()
  const writeLocked = useStore((s) => s.writeLocked)
  const { seekFilmSource, setFilmSelection, beginFilmAddDraft } = useStore()
  const playback = useFilmPlayback()
  const laneRef = useRef<HTMLDivElement>(null)
  const tl = document.content.timeline
  const span = tl.frameEnd - tl.frameStart + 1
  const ticks = useMemo(() => buildSourceTicks(tl.frameStart, tl.frameEnd, tl.fps), [tl.frameStart, tl.frameEnd, tl.fps])
  const pct = (frame: number) => ((frame - tl.frameStart) / span) * 100
  const playheadRatio = (playback.sourcePreviewFrame - tl.frameStart) / span
  const stripFrames = useMemo(
    () => buildSourceStripFrames(tl.frameStart, tl.frameEnd),
    [tl.frameStart, tl.frameEnd],
  )
  const thumbRequests = useMemo(
    () => stripFrames.map((frame) => ({ cameraId: cameraNodeId, frame, height: SOURCE_THUMB_HEIGHT })),
    [stripFrames, cameraNodeId],
  )
  const lookup = useFilmThumbnails(thumbRequests)
  const startDrag = useSourceDrag({ document, clip, working, isDraft })

  const scrubTo = (clientX: number) => {
    const lane = laneRef.current
    if (disabled || !lane) return
    seekFilmSource(Math.round(frameFromClientX(clientX, lane, tl.frameStart, lane.clientWidth / span)))
  }

  return (
    <div className="t3d-film-source">
      <div className="t3d-film-source-clock">
        <div className="t3d-film-source-inner" data-film-source-axis>
          <div className="t3d-film-source-ticks" aria-hidden>
            {ticks.map((tick) => <span key={tick.frame}>{tick.label}</span>)}
          </div>
          <div className="t3d-film-source-stage">
            <div
              ref={laneRef}
              className="t3d-film-source-lane"
              role="slider"
              aria-valuemin={tl.frameStart}
              aria-valuemax={tl.frameEnd}
              aria-valuenow={playback.sourcePreviewFrame}
              aria-label={t('film.sourcePlayhead')}
              onPointerDown={(event) => {
                if (disabled || event.target !== event.currentTarget) return
                if (!working) {
                  if (writeLocked) {
                    event.currentTarget.setPointerCapture(event.pointerId)
                    scrubTo(event.clientX)
                  } else beginFilmAddDraft()
                  return
                }
                event.currentTarget.setPointerCapture(event.pointerId)
                scrubTo(event.clientX)
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                scrubTo(event.clientX)
              }}
            >
          <div className="t3d-film-source-strip" aria-hidden>
            {stripFrames.map((frame) => {
              const url = lookup(cameraNodeId, frame, SOURCE_THUMB_HEIGHT)
              return (
                <div
                  key={frame}
                  className={cx('t3d-film-source-cell', url && 'is-loaded')}
                  style={url ? { backgroundImage: `url(${url})` } : undefined}
                />
              )
            })}
          </div>
          {working ? (
            <div
              className={cx('t3d-film-source-selection', isDraft && 'is-draft')}
              style={{
                left: `${pct(working.sourceFrameStart)}%`,
                width: `${(displayDuration(working) / span) * 100}%`,
              }}
              onPointerDown={writeLocked ? undefined : (event) => startDrag('source-move', event)}
            >
              <button
                type="button"
                className="t3d-film-source-handle is-start"
                aria-label={t('film.trimStart')}
                title={t('film.trimStart')}
                disabled={disabled || writeLocked}
                onPointerDown={(event) => startDrag('source-trim-start', event)}
              >
                <IconTrimLeft className="t3d-film-handle-icon" />
              </button>
              <button
                type="button"
                className="t3d-film-source-handle is-end"
                aria-label={t('film.trimEnd')}
                title={t('film.trimEnd')}
                disabled={disabled || writeLocked}
                onPointerDown={(event) => startDrag('source-trim-end', event)}
              >
                <IconTrimRight className="t3d-film-handle-icon" />
              </button>
            </div>
            ) : null}
          </div>
        </div>
          <div className="t3d-film-playhead" style={{ left: `${playheadRatio * 100}%` }}>
            <span className="t3d-film-playhead-label">
              {formatFilmPlayhead(playback.sourcePreviewFrame, tl.fps)}
            </span>
            <div
              className="t3d-film-source-grip"
              aria-hidden
              onPointerDown={(event) => {
                if (disabled) return
                event.stopPropagation()
                event.currentTarget.setPointerCapture(event.pointerId)
                scrubTo(event.clientX)
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                scrubTo(event.clientX)
              }}
            />
          </div>
        </div>
      </div>
      {/* used-track green bar removed per visual polish */}
    </div>
  )
}
