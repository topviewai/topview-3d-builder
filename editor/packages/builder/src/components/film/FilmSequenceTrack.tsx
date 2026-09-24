import { Tooltip } from '../common/Tooltip'
import { useEffect, useMemo, useRef } from 'react'
import type { DirectorDocument, EditSequence } from '../../contract/types'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { cx } from '../common/cx'
import { displayCameraName } from '../displayNames'
import { FilmClipBlock } from './FilmClipBlock'
import { COMPACT_CLIP_PX, STRIP_ASPECT } from './constants'
import { useHeldWhileInteracting } from './hooks/filmInteraction'
import { useClipDrag } from './hooks/useClipDrag'
import { useClipHeight } from './hooks/useClipHeight'
import { useFilmPlayback } from './hooks/useFilmPlayback'
import { useFilmThumbnails } from './hooks/useFilmThumbnails'
import { useSequenceScrub } from './hooks/useSequenceScrub'
import {
  buildClipStrips,
  buildSourceTicks,
  computeSequenceLayout,
  dedupeThumbRequests,
  filmTrackDisplayFrames,
  formatFilmPlayhead,
  invalidClipIds,
  resolveThumbHeight,
  sourceTimelineFrames,
} from './utils'

function measureSourceAxisWidth(scroller: HTMLElement): number {
  const axis = scroller.closest('.t3d-film-body')?.querySelector('[data-film-source-axis]')
  if (axis instanceof HTMLElement && axis.clientWidth >= 8) return axis.clientWidth
  const style = getComputedStyle(scroller)
  return scroller.clientWidth
    - Number.parseFloat(style.paddingLeft)
    - Number.parseFloat(style.paddingRight)
}

export function FilmSequenceTrack({
  document,
  sequence,
  pxPerFrame,
  disabled,
}: {
  document: DirectorDocument
  sequence: EditSequence
  pxPerFrame: number
  disabled?: boolean
}) {
  const t = useT()
  const { useStore } = useDirector()
  const writeLocked = useStore((s) => s.writeLocked)
  const hasCamera = document.content.nodes.some((node) => node.type === 'camera')
  const addBlocked = disabled || writeLocked || !hasCamera
  const addHelp = t(disabled ? 'help.exporting' : !hasCamera ? 'help.needCamera' : 'film.browseHint')
  const selection = useStore((s) => s.filmSelection)
  const preview = useStore((s) => s.filmDragPreview)
  const filmTrackAligned = useStore((s) => s.filmTrackAligned)
  const { setFilmSelection, seekFilmSequence, beginFilmAddDraft, alignFilmTrackToSource } = useStore()
  const playback = useFilmPlayback()
  const trackRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tl = document.content.timeline
  const fps = tl.fps
  const sourceFrames = sourceTimelineFrames(tl)
  const sourceTicks = useMemo(
    () => buildSourceTicks(tl.frameStart, tl.frameEnd, fps),
    [tl.frameStart, tl.frameEnd, fps],
  )

  const { slots, drop, total } = useMemo(
    () => computeSequenceLayout(sequence.clips, preview, pxPerFrame),
    [sequence.clips, preview, pxPerFrame],
  )
  // 三个 O(片段) 的查找都提到渲染外：拖拽时这段每帧都要跑
  const invalidIds = useMemo(() => invalidClipIds(document), [document])
  const indexById = useMemo(
    () => new Map(sequence.clips.map((item, index) => [item.id, index])),
    [sequence.clips],
  )
  const clipFrames = Math.max(0, Math.round(total / Math.max(pxPerFrame, 0.0001)))
  const displayFrames = filmTrackDisplayFrames(clipFrames, sourceFrames)
  const sourceAxisPx = sourceFrames * pxPerFrame
  const empty = sequence.clips.length === 0
  // 空轨且尚未锁定缩放：铺满，和机位胶片同一条 100% 时间轴
  const width = empty && !filmTrackAligned
    ? undefined
    : Math.max(total, sourceAxisPx, 1)
  const clipHeight = useClipHeight(trackRef)
  const thumbHeight = resolveThumbHeight(clipHeight)
  const sampledStrips = useMemo(
    () => buildClipStrips(slots, Math.round(clipHeight * STRIP_ASPECT)),
    [slots, clipHeight],
  )
  // 拖拽中沿用拖拽前的采样帧：格子跟着片段宽度拉伸即可，
  // 重新采样只会让整条轨道的缩略图边拖边闪
  const strips = useHeldWhileInteracting(sampledStrips)
  const stripSignature = strips.map((s) => `${s.cameraId}:${s.frames.join(',')}`).join('|')
  const thumbRequests = useMemo(
    () => dedupeThumbRequests(strips, thumbHeight),
    // 请求集合按内容做签名，避免每次渲染都触发重新排队
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stripSignature, thumbHeight],
  )
  const stripByClip = useMemo(() => new Map(strips.map((item) => [item.clipId, item])), [strips])
  const lookup = useFilmThumbnails(thumbRequests)
  const frameCount = displayFrames
  const persistAlign = sequence.clips.length > 0
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const fit = () => {
      alignFilmTrackToSource(measureSourceAxisWidth(scroller), sourceFrames, persistAlign)
    }
    fit()
    if (filmTrackAligned) return
    const axis = scroller.closest('.t3d-film-body')?.querySelector('[data-film-source-axis]')
    const target = axis instanceof HTMLElement ? axis : scroller
    const observer = new ResizeObserver(fit)
    observer.observe(target)
    return () => observer.disconnect()
  }, [alignFilmTrackToSource, filmTrackAligned, persistAlign, sourceFrames])
  const startDrag = useClipDrag({
    clips: sequence.clips,
    pxPerFrame,
    track: trackRef,
    disabled: Boolean(disabled || writeLocked),
    seek: seekFilmSequence,
    frameMax: Math.max(0, frameCount - 1),
  })

  const clipCount = sequence.clips.length
  const selectedId = selection?.clipId
  const prevCountRef = useRef(clipCount)
  useEffect(() => {
    const grew = clipCount > prevCountRef.current
    prevCountRef.current = clipCount
    if (!grew || !selectedId) return
    const slot = trackRef.current?.querySelector(`[data-clip-id="${CSS.escape(selectedId)}"]`)
    const scroller = trackRef.current?.closest('.t3d-film-sequence-scroll')
    if (!(slot instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return
    const slotBox = slot.getBoundingClientRect()
    const viewBox = scroller.getBoundingClientRect()
    const left = scroller.scrollLeft + (slotBox.left - viewBox.left) - (viewBox.width - slotBox.width) / 2
    scroller.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [clipCount, selectedId])

  const insertAfter = (clipId: string) => beginFilmAddDraft(clipId)
  const appendShot = () => beginFilmAddDraft(null)
  const startScrub = useSequenceScrub({
    trackRef,
    pxPerFrame,
    frameMax: Math.max(0, frameCount - 1),
    disabled,
    seek: seekFilmSequence,
  })

  return (
    <div className="t3d-film-sequence">
      <div ref={scrollRef} className="t3d-film-sequence-scroll">
        <div className="t3d-film-sequence-inner" style={width == null ? undefined : { width }}>
          <div
            className="t3d-film-ruler"
            role="slider"
            tabIndex={-1}
            aria-label={t('film.sequenceTrack')}
            aria-valuemin={0}
            aria-valuemax={Math.max(0, frameCount - 1)}
            aria-valuenow={playback.sequenceFrame}
            onPointerDown={startScrub}
          >
            <div
              className="t3d-film-source-ticks"
              style={empty && !filmTrackAligned ? undefined : { width: sourceAxisPx }}
              aria-hidden
            >
              {sourceTicks.map((tick) => <span key={tick.frame}>{tick.label}</span>)}
            </div>
          </div>
          <div
            ref={trackRef}
            className={cx('t3d-film-sequence-track', preview?.kind === 'sequence-reorder' && 'is-reordering')}
            style={{ ['--t3d-film-clip-h' as string]: `${clipHeight}px` }}
            role="listbox"
            aria-label={t('film.sequenceTrack')}
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget || disabled) return
              // 点空白＝退出分镜编辑，机位面板回到浏览态（切机位不再改分镜）
              setFilmSelection(null)
              startScrub(event)
            }}
          >
            {slots.length === 0 ? (
              <div className="t3d-film-sequence-empty">
                <span>{t('film.emptyCta')}</span>
                <Tooltip label={addHelp} side="top" variant="description">
                  <button
                    type="button"
                    className="t3d-film-btn is-solid-white"
                    disabled={addBlocked}
                    onClick={appendShot}
                  >
                    <span className="t3d-film-btn-plus" aria-hidden>+</span>
                    {t('film.addClip')}
                  </button>
                </Tooltip>
              </div>
            ) : null}
            {slots.map((slot, slotIndex) => {
              const index = indexById.get(slot.clip.id) ?? 0
              const camera = document.content.nodes.find((node) => node.id === slot.clip.cameraNodeId)
              const strip = stripByClip.get(slot.clip.id)
              const last = slotIndex === slots.length - 1
              return (
                <div
                  key={slot.clip.id}
                  data-clip-id={slot.clip.id}
                  className={cx('t3d-film-clip-slot', slot.dragging && 'is-dragging')}
                  style={{ left: slot.left, width: slot.width }}
                >
                  <FilmClipBlock
                    clip={slot.clip}
                    cameraName={camera ? displayCameraName(t, camera.name) : slot.clip.cameraNodeId}
                    index={index < 0 ? 0 : index}
                    fps={fps}
                    compact={slot.width < COMPACT_CLIP_PX}
                    invalid={invalidIds.has(slot.clip.id)}
                    thumbs={(strip?.frames ?? []).map((frame) => ({
                      frame,
                      url: lookup(slot.clip.cameraNodeId, frame, thumbHeight),
                    }))}
                    selected={selection?.clipId === slot.clip.id}
                    disabled={disabled}
                    readOnly={writeLocked}
                    onSelect={() => setFilmSelection({ kind: 'edit-clip', clipId: slot.clip.id })}
                    onDragStart={(kind, event) => startDrag(kind, slot.clip, event)}
                  />
                  <Tooltip label={addHelp} side="top" variant="description">
                    <button
                      type="button"
                      className={cx('t3d-film-track-add is-after', last && 'is-tail')}
                      disabled={addBlocked}
                      aria-label={t('film.addClip')}
                      onClick={() => (last ? appendShot() : insertAfter(slot.clip.id))}
                    >
                      +
                    </button>
                  </Tooltip>
                </div>
              )
            })}
            {drop ? (
              <div className="t3d-film-drop-slot" style={{ left: drop.left, width: drop.width }} aria-hidden />
            ) : null}
          </div>
          {total > 0 ? (
            <div
              className="t3d-film-playhead"
              style={{ transform: `translateX(${playback.sequenceFrame * pxPerFrame}px)` }}
              aria-hidden
            >
              <span className="t3d-film-playhead-label">
                {formatFilmPlayhead(playback.sequenceFrame, fps)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
