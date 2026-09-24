import { useRef, useState, type ReactNode } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { useEngineEvent } from '../../bridge/useEngineEvent'
import { ScrubNumberInput } from '../common/ScrubNumberInput'
import { Tooltip } from '../common/Tooltip'
import { cx } from '../common/cx'

export function TimelineFrameField({
  min,
  max,
  onChange,
}: {
  min: number
  max: number
  onChange: (n: number) => void
}) {
  const { stage } = useDirector()
  const [value, setValue] = useState(() => Math.round(stage.currentFrame))
  const editingRef = useRef(false)
  useEngineEvent('frame', (frame) => {
    if (!editingRef.current) setValue(Math.round(frame))
  })
  return (
    <ScrubNumberInput
      value={value}
      min={min}
      max={max}
      step={1}
      precision={0}
      onEditStart={() => {
        editingRef.current = true
      }}
      onChange={(n) => {
        editingRef.current = true
        setValue(n)
        onChange(n)
      }}
      onEditEnd={() => {
        editingRef.current = false
      }}
    />
  )
}

export function TimelineRangeField({
  label,
  unit,
  value,
  min,
  max,
  step = 1,
  precision = 0,
  fixed,
  disabled,
  onBegin,
  onCommit,
  onEnd,
}: {
  label: string
  unit?: string
  value: number
  min?: number
  max?: number
  step?: number
  precision?: number
  fixed?: boolean
  disabled?: boolean
  onBegin: () => void
  onCommit: (n: number) => void
  onEnd: () => void
}) {
  return (
    <label className="t3d-timeline-field t3d-timeline-field-range">
      {label}
      <ScrubNumberInput
        value={value}
        min={min}
        max={max}
        step={step}
        precision={precision}
        fixed={fixed}
        disabled={disabled}
        onEditStart={onBegin}
        onChange={onCommit}
        onEditEnd={onEnd}
      />
      {unit ? <span className="t3d-timeline-field-unit">{unit}</span> : null}
    </label>
  )
}

export function TransportButton({
  label,
  className,
  onClick,
  disabled,
  children,
}: {
  label: string
  className?: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        className={cx('t3d-timeline-icon-btn', className)}
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  )
}
