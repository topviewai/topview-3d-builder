import { useState } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { Tooltip } from '../common/Tooltip'
import { ExportDialog } from '../dialogs/ExportDialog'
import { ExportGlyph } from './icons'

export function ExportMenu({ disabled }: { disabled: boolean }) {
  const t = useT()
  const { useStore } = useDirector()
  const ready = useStore((s) => s.ready)
  const exporting = useStore((s) => s.exporting)
  const [renderOpen, setRenderOpen] = useState(false)

  const label = t('topbar.exportMenu')
  const tip = exporting ? t('help.exporting') : !ready ? t('help.loading') : ''
  const trigger = (
    <button
      type="button"
      className="t3d-topbar-export-btn"
      disabled={disabled}
      aria-label={label}
      onClick={() => {
        if (!disabled) setRenderOpen(true)
      }}
    >
      <ExportGlyph />
      <span>{label}</span>
    </button>
  )

  return (
    <>
      {tip ? (
        <Tooltip label={tip} variant="description">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      {renderOpen ? <ExportDialog onClose={() => setRenderOpen(false)} /> : null}
    </>
  )
}
