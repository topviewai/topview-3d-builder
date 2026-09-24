import type { ReactElement } from 'react'
import { cx } from '../common/cx'
import { useChipScroll } from './hooks/useChipScroll'

export interface ChipItem {
  id: string
  label: string
}

export function Chips({
  items,
  activeId,
  onSelect,
}: {
  items: ChipItem[]
  activeId: string
  onSelect: (id: string) => void
}): ReactElement | null {
  const scrollRef = useChipScroll()
  if (items.length === 0) return null
  return (
    <div ref={scrollRef} className="t3d-leftrail-chips" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === activeId}
          className={cx('t3d-leftrail-chip', item.id === activeId && 't3d-leftrail-chip-active')}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
