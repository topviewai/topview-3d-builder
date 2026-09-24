import type { CSSProperties, InputHTMLAttributes } from 'react'
import { cx } from './cx'

interface RangeSliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'min' | 'max'> {
  value: number
  min: number
  max: number
}

export function RangeSlider({ className, value, min, max, style, ...props }: RangeSliderProps) {
  const progress = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0
  const sliderStyle: CSSProperties & { '--t3d-range-slider-progress': string } = {
    ...style,
    '--t3d-range-slider-progress': `${progress}%`,
  }

  return (
    <input
      {...props}
      type="range"
      className={cx('t3d-range-slider', className)}
      min={min}
      max={max}
      value={value}
      style={sliderStyle}
    />
  )
}
