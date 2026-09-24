import type { ReactElement } from 'react'
import type { TranslateFn } from '../../locale'
import type { LibraryTab } from '../../stores/types'
import { cx } from '../common/cx'
import { Tooltip } from '../common/Tooltip'
import { TAB_LABEL, TAB_ORDER } from './constants'
import {
  IconCamera,
  IconCameraMotion,
  IconCharacter,
  IconChevron,
  IconMotion,
  IconObject,
  IconProp,
} from './icons'

const TAB_ICON: Record<LibraryTab, (props: { className?: string }) => ReactElement> = {
  object: IconObject,
  character: IconCharacter,
  prop: IconProp,
  motion: IconMotion,
  camera: IconCamera,
  cameraMotion: IconCameraMotion,
}

export function IconRail({
  tab,
  open,
  t,
  onSelect,
  onToggle,
  tabs = TAB_ORDER,
}: {
  tab: LibraryTab
  open: boolean
  t: TranslateFn
  onSelect: (tab: LibraryTab) => void
  onToggle: () => void
  tabs?: readonly LibraryTab[]
}): ReactElement {
  return (
    <div className="t3d-leftrail-rail">
      {tabs.map((id) => {
        const Icon = TAB_ICON[id]
        return (
          <div key={id} className="t3d-leftrail-rail-item">
            <button
              type="button"
              className={cx('t3d-leftrail-rail-btn', tab === id && 't3d-leftrail-rail-btn-active')}
              onClick={() => onSelect(id)}
            >
              <Icon />
              <span className="t3d-leftrail-rail-label">{t(TAB_LABEL[id])}</span>
            </button>
            {id === 'object' ? <div className="t3d-leftrail-rail-divider" role="separator" /> : null}
          </div>
        )
      })}
      {open ? null : (
        <Tooltip label={t('library.expandContent')} side="right">
          <button type="button" className="t3d-leftrail-expand" onClick={onToggle}>
            <IconChevron className="t3d-leftrail-chevron-expand" />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
