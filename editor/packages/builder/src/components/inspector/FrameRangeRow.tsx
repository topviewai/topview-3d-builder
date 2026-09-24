import { useT } from '../../locale'
import { IconTrash } from '../leftrail/icons'
import { ScrubNumberInput } from '../common/ScrubNumberInput'
import { Tooltip } from '../common/Tooltip'

/** Compact trash control for timeline-object inspectors (next to end frame). */
export function InspectorRangeDelete({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        className="t3d-inspector-range-delete"
        aria-label={label}
        onClick={onClick}
      >
        <IconTrash />
      </button>
    </Tooltip>
  )
}

/** Start – end frame inputs with optional delete pinned after end. */
export function FrameRangeRow({
  label,
  start,
  end,
  onStart,
  onEnd,
  onDelete,
  deleteLabel,
  startReadOnly,
  endReadOnly,
  startMin,
  startMax,
  endMin,
  endMax,
}: {
  label?: string
  start: number
  end: number
  onStart?: (n: number) => void
  onEnd?: (n: number) => void
  onDelete?: () => void
  deleteLabel?: string
  startReadOnly?: boolean
  endReadOnly?: boolean
  startMin?: number
  startMax?: number
  endMin?: number
  endMax?: number
}) {
  const t = useT()
  const rowLabel = label ?? t('inspector.frameRange')
  const delLabel = deleteLabel ?? t('common.delete')
  return (
    <div className="t3d-inspector-kv">
      <span className="t3d-inspector-k">{rowLabel}</span>
      <span className="t3d-inspector-v t3d-inspector-inline-inputs">
        <ScrubNumberInput
          value={start}
          step={1}
          precision={0}
          min={startMin}
          max={startMax}
          disabled={startReadOnly || !onStart}
          onChange={onStart ?? (() => {})}
        />
        <span>–</span>
        <ScrubNumberInput
          value={end}
          step={1}
          precision={0}
          min={endMin}
          max={endMax}
          disabled={endReadOnly || !onEnd}
          onChange={onEnd ?? (() => {})}
        />
        {onDelete ? <InspectorRangeDelete label={delLabel} onClick={onDelete} /> : null}
      </span>
    </div>
  )
}
