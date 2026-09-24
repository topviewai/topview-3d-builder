import { FieldHelp } from './FieldHelp'
import type { ReactNode } from 'react'
import { formatScrubNumber } from '../../document/numericDraft'
import { KeyframeButton } from './KeyframeButton'
import { ScrubNumberInput } from './ScrubNumberInput'

export const TRANSFORM_AXES = ['x', 'y', 'z'] as const
export type TransformAxis = (typeof TRANSFORM_AXES)[number]

export function XyzRow({
  label,
  helpText,
  value,
  step = 0.1,
  precision = 1,
  disabled,
  trailing,
  onAxis,
  onEditStart,
  onEditEnd,
}: {
  label: string
  helpText?: string
  value: { x: number; y: number; z: number } | undefined
  step?: number
  precision?: number
  disabled?: boolean
  trailing?: ReactNode
  onAxis?: (axis: TransformAxis, value: number, commit?: boolean) => void
  onEditStart?: () => void
  onEditEnd?: () => void
}) {
  return (
    <div className="t3d-inspector-row t3d-inspector-row-stack">
      <div className="t3d-inspector-row-top">
        <span>{label}{helpText && <FieldHelp text={helpText} />}</span>
        {trailing}
      </div>
      <span className="t3d-inspector-xyz">
        {TRANSFORM_AXES.map((axis) => {
          const n = value?.[axis]
          return (
            <span key={axis}>
              <i>{axis.toUpperCase()}</i>
              {onAxis ? (
                <ScrubNumberInput
                  value={n ?? 0}
                  step={step}
                  precision={precision}
                  disabled={disabled || n === undefined}
                  onChange={(next) => onAxis(axis, next, false)}
                  onCommit={(next) => onAxis(axis, next, true)}
                  onEditStart={onEditStart}
                  onEditEnd={onEditEnd}
                />
              ) : (
                <em>{n === undefined ? '—' : formatScrubNumber(n, precision)}</em>
              )}
            </span>
          )
        })}
      </span>
    </div>
  )
}

/** 位移 / 旋转 / 缩放：布局与只读 `XyzRow` 一致，数值可拖改。 */
export function TransformGroup({
  label,
  helpText,
  value,
  step,
  precision = 1,
  keyed,
  onAxis,
  onAddKey,
  addTitle,
  extra,
  trailing,
  disabled,
  onEditStart,
  onEditEnd,
}: {
  label: string
  helpText?: string
  value: { x: number; y: number; z: number }
  step: number
  precision?: number
  keyed?: boolean
  onAxis: (axis: TransformAxis, value: number, commit?: boolean) => void
  onAddKey?: () => void
  addTitle?: string
  extra?: ReactNode
  trailing?: ReactNode
  disabled?: boolean
  onEditStart?: () => void
  onEditEnd?: () => void
}) {
  return (
    <XyzRow
      label={label}
      helpText={helpText}
      value={value}
      step={step}
      precision={precision}
      disabled={disabled}
      onAxis={onAxis}
      onEditStart={onEditStart}
      onEditEnd={onEditEnd}
      trailing={
        extra || onAddKey || trailing ? (
          <>
            {extra}
            {onAddKey ? (
              <KeyframeButton keyed={keyed} title={addTitle} disabled={disabled} onClick={onAddKey} />
            ) : null}
            {trailing}
          </>
        ) : null
      }
    />
  )
}
