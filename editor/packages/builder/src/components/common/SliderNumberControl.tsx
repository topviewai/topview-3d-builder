import { useId } from 'react'
import { FieldHelp } from './FieldHelp'
import { RangeSlider } from './RangeSlider'
import { ScrubNumberInput } from './ScrubNumberInput'

/** A single value with both coarse adjustment and exact keyboard entry. */
export function SliderNumberControl({
  label, value, min, max, step, precision = 2, unit = '', disabled, onChange, helpText,
}: {
  label: string
  helpText?: string
  value: number
  min: number
  max: number
  step: number
  precision?: number
  unit?: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <div className="t3d-slider-number" aria-disabled={disabled || undefined}>
      <label htmlFor={id}>{label}{helpText && <FieldHelp text={helpText} />}</label>
      <RangeSlider id={id} aria-label={label} value={value} min={min} max={max} step={step}
        disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="t3d-slider-number-value">
        <ScrubNumberInput value={value} min={min} max={max} step={step}
          precision={precision} disabled={disabled} ariaLabel={label} onChange={onChange} />
        {unit && <span>{unit}</span>}
      </span>
    </div>
  )
}
