import type { PointerEvent as ReactPointerEvent } from 'react'
import type { EditSequenceClip } from '../../contract/types'
import { useT } from '../../locale'
import { cx } from '../common/cx'
import { IconTrimLeft, IconTrimRight } from './icons'
import { cameraHue, displayDuration, formatSeconds } from './utils'

export function FilmClipBlock({
  clip,
  cameraName,
  index,
  fps,
  selected,
  invalid,
  disabled,
  readOnly,
  thumbs,
  compact,
  onSelect,
  onDragStart,
}: {
  clip: EditSequenceClip
  cameraName: string
  index: number
  fps: number
  selected: boolean
  invalid: boolean
  disabled?: boolean
  readOnly?: boolean
  thumbs: { frame: number; url?: string }[]
  /** 片段太窄时只留序号，避免文字互相压住。 */
  compact: boolean
  onSelect: () => void
  onDragStart: (kind: 'move' | 'trim-start' | 'trim-end', event: ReactPointerEvent<HTMLElement>) => void
}) {
  const t = useT()
  const frames = displayDuration(clip)
  const hue = cameraHue(clip.cameraNodeId)
  return (
    <div
      className={cx('t3d-film-clip', compact && 'is-compact', selected && 'is-selected', invalid && 'is-invalid')}
      style={{ ['--t3d-film-clip-hue' as string]: String(hue) }}
      tabIndex={0}
      role="option"
      aria-selected={selected}
      aria-invalid={invalid}
      aria-label={t('film.clipLabel', { camera: cameraName, frames })}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return
        onSelect()
        if (!readOnly) onDragStart('move', event)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="t3d-film-clip-strip" aria-hidden>
        {thumbs.map((thumb) => (
          <div
            key={thumb.frame}
            className={cx('t3d-film-clip-cell', thumb.url && 'is-loaded')}
            style={thumb.url ? { backgroundImage: `url(${thumb.url})` } : undefined}
          />
        ))}
      </div>
      <div className="t3d-film-clip-tint" aria-hidden />
      <div className="t3d-film-clip-meta">
        <span className="t3d-film-clip-index">{String(index + 1).padStart(2, '0')}</span>
        {compact ? null : (
          <>
            <span className="t3d-film-clip-name">{cameraName}</span>
            <span className="t3d-film-clip-duration">
              {t('film.durationSeconds', { seconds: formatSeconds(frames, fps) })}
            </span>
          </>
        )}
      </div>
      <button
        type="button"
        className="t3d-film-clip-handle is-start"
        aria-label={t('film.trimStart')}
        title={t('film.trimStart')}
        disabled={disabled || readOnly}
        onPointerDown={(event) => {
          event.stopPropagation()
          onSelect()
          onDragStart('trim-start', event)
        }}
      >
        <IconTrimLeft className="t3d-film-handle-icon" />
      </button>
      <button
        type="button"
        className="t3d-film-clip-handle is-end"
        aria-label={t('film.trimEnd')}
        title={t('film.trimEnd')}
        disabled={disabled || readOnly}
        onPointerDown={(event) => {
          event.stopPropagation()
          onSelect()
          onDragStart('trim-end', event)
        }}
      >
        <IconTrimRight className="t3d-film-handle-icon" />
      </button>
    </div>
  )
}
