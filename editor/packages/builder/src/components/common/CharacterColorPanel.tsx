import { useT } from '../../locale'

function normalizeHex(value: string): string {
  const raw = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[1]
    const g = raw[2]
    const b = raw[3]
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return '#cccccc'
}

const PALETTE = [
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#84cc16',
  '#14b8a6',
  '#38bdf8',
  '#8b5cf6',
  '#6b7280',
  '#22c55e',
  '#0d9488',
  '#a16207',
]

/** 材质色板：点色块立刻改颜色；自定义取色与场景背景色控件同款。 */
export function CharacterColorPanel({
  color,
  disabled,
  onChange,
}: {
  color: string
  disabled?: boolean
  onChange: (next: string) => void
}) {
  const t = useT()
  const current = normalizeHex(color)
  return (
    <div className="t3d-char-color">
      <label className="t3d-inspector-row">
        <span>{t('inspector.color')}</span>
        <span className={`t3d-inspector-color${disabled ? ' is-disabled' : ''}`}>
          <span className="t3d-inspector-swatch" style={{ backgroundColor: current }}>
            <input
              type="color"
              value={current}
              disabled={disabled}
              aria-label={t('inspector.customColor')}
              onChange={(e) => onChange(e.target.value)}
            />
          </span>
          <em>{current}</em>
        </span>
      </label>
      <div className="t3d-char-color-swatches">
        {PALETTE.map((hex) => (
          <button
            key={hex}
            type="button"
            className={`t3d-char-color-chip${current.toLowerCase() === hex ? ' is-on' : ''}`}
            style={{ backgroundColor: hex }}
            disabled={disabled}
            title={hex}
            onClick={() => onChange(hex)}
          />
        ))}
      </div>
    </div>
  )
}
