import { cx } from './cx'
import { useT } from '../../locale'
import { Tooltip } from './Tooltip'

export function hasKeyAtFrame(
  keys: { frame: number }[] | undefined,
  frame: number,
): boolean {
  return !!keys?.some((k) => Math.abs(k.frame - frame) <= 0.5)
}

/** 检查器属性行末端：与时间轴同一套白色钻石，keyed = 当前帧已有关键帧 */
export function KeyframeButton({
  keyed,
  title,
  disabled,
  onClick,
}: {
  keyed?: boolean
  title?: string
  disabled?: boolean
  onClick: () => void
}) {
  const t = useT()
  const label = title ?? t('timeline.addKeyframe')
  const help = !disabled && keyed ? t('help.keyUpdate') : label
  return (
    <Tooltip label={help} side="top" variant="description">
      <button
        type="button"
        className={cx('t3d-kf-btn', keyed && 't3d-kf-btn-on')}
        aria-label={label}
        aria-pressed={Boolean(keyed)}
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClick()
        }}
      >
        <span className="t3d-kf-btn-diamond" aria-hidden />
      </button>
    </Tooltip>
  )
}
