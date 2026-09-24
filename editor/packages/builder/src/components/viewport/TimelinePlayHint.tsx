import { useEffect, useLayoutEffect, useState, type ReactElement } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { cx } from '../common/cx'

function IconHint(): ReactElement {
  return (
    <svg className="t3d-timeline-play-hint-icon" viewBox="0 0 1024 1024" aria-hidden>
      <path
        fill="currentColor"
        d="M469.333333 725.333333h85.333334V469.333333h-85.333334v256z m42.666667-640C276.266667 85.333333 85.333333 276.266667 85.333333 512s190.933333 426.666667 426.666667 426.666667 426.666667-190.933333 426.666667-426.666667S747.733333 85.333333 512 85.333333z m0 768c-188.16 0-341.333333-153.173333-341.333333-341.333333S323.84 170.666667 512 170.666667s341.333333 153.173333 341.333333 341.333333-153.173333 341.333333-341.333333 341.333333z m-42.666667-469.333333h85.333334v-85.333333h-85.333334v85.333333z"
      />
    </svg>
  )
}

const FADE_MS = 200

/** 时间轴开关上方的一次性播放引导。不挡视口，超时后淡出。 */
export function TimelinePlayHint() {
  const t = useT()
  const { useStore } = useDirector()
  const until = useStore((s) => s.timelinePlayHintUntil)
  const [leaving, setLeaving] = useState(false)

  useLayoutEffect(() => {
    const remaining = until - Date.now()
    if (remaining <= 0) {
      useStore.getState().dismissTimelinePlayHint()
      return
    }
    const fade = window.setTimeout(() => setLeaving(true), remaining)
    return () => window.clearTimeout(fade)
  }, [until, useStore])

  useEffect(() => {
    if (!leaving) return
    const hide = window.setTimeout(() => useStore.getState().dismissTimelinePlayHint(), FADE_MS)
    return () => window.clearTimeout(hide)
  }, [leaving, useStore])

  return (
    <button
      type="button"
      className={cx('t3d-timeline-play-hint', leaving && 'is-leaving')}
      onClick={(event) => {
        event.stopPropagation()
        useStore.getState().acceptTimelinePlayHint()
      }}
    >
      <IconHint />
      <span className="t3d-timeline-play-hint-text">{t('viewport.timelinePlayHint')}</span>
    </button>
  )
}
