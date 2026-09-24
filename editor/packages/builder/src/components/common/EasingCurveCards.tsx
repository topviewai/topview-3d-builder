import { Tooltip } from './Tooltip'
import { useT } from '../../locale'
import { cx } from './cx'

export const EASINGS = ['ease-in-out', 'ease-in', 'ease-out', 'linear'] as const
export type EasingKind = (typeof EASINGS)[number]

const EASING_LABEL: Record<EasingKind, string> = {
  'ease-in-out': 'inspector.easingEaseInOut',
  'ease-in': 'inspector.easingEaseIn',
  'ease-out': 'inspector.easingEaseOut',
  linear: 'inspector.easingLinear',
}

/** ViewBox 0..24 - curves from (2,20) to (22,4) approximating CSS easing shapes. */
const EASING_PATH: Record<EasingKind, string> = {
  'ease-in-out': 'M2 20 C8 20, 10 4, 22 4',
  'ease-in': 'M2 20 C10 20, 16 18, 22 4',
  'ease-out': 'M2 20 C8 6, 14 4, 22 4',
  linear: 'M2 20 L22 4',
}

function EasingCurve({ kind }: { kind: EasingKind }) {
  return (
    <svg className="t3d-inspector-easing-curve" viewBox="0 0 24 24" aria-hidden="true">
      <path d={EASING_PATH[kind]} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

export type EasingCurveCardsProps = {
  value: string | null
  onChange: (kind: EasingKind) => void
  /** When true, wrap with easing-block + optional label (camera motion style). */
  labeled?: boolean
  className?: string
}

/** Normalize legacy keyframe `smooth` to the ease-in-out card. */
export function normalizeEasingKind(value: string | undefined): EasingKind {
  if (value === 'ease-in' || value === 'ease-out' || value === 'linear' || value === 'ease-in-out') {
    return value
  }
  if (value === 'smooth') return 'ease-in-out'
  return 'ease-in-out'
}

/**
 * Shared 2×2 easing curve radio cards — used by camera-motion preset panel
 * and keyframe property panel.
 */
export function EasingCurveCards({ value, onChange, labeled = true, className }: EasingCurveCardsProps) {
  const t = useT()
  const selected = value === null ? null : normalizeEasingKind(value)
  const grid = (
    <div className={cx('t3d-inspector-easing-grid', className)} role="radiogroup" aria-label={t('inspector.interpolation')}>
      {EASINGS.map((kind) => {
        const isSelected = selected === kind
        return (
          <Tooltip key={kind} label={t('help.' + kind)} side="top" variant="description">
            <button
              aria-label={t(EASING_LABEL[kind])}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={cx('t3d-inspector-easing-card', isSelected && 'is-selected')}
              onClick={() => onChange(kind)}
            >
              <EasingCurve kind={kind} />
              <span className="t3d-inspector-easing-card-label">{t(EASING_LABEL[kind])}</span>
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
  if (!labeled) return grid
  return (
    <div className="t3d-inspector-easing-block">
      <div className="t3d-inspector-param-label t3d-inspector-easing-label">{t('inspector.interpolation')}</div>
      {value === null && <p className="t3d-inspector-help">{t('inspector.mixedEasing')}</p>}
      {grid}
    </div>
  )
}
