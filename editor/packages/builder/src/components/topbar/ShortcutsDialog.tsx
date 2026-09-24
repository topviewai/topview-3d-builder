import { useMemo, useState } from 'react'
import { useT, type TranslateFn } from '../../locale'
import { Modal } from '../common/Modal'
import { Tooltip } from '../common/Tooltip'
import { KeyboardGlyph } from './icons'
import { isApplePlatform, modifierSymbol } from './platform'

type ShortcutGroupId = 'view' | 'touch' | 'object' | 'timeline'

interface ShortcutRow {
  labelKey: string
  keys: string[][]
}

export function ShortcutsButton() {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Tooltip label={t('topbar.shortcuts')}>
        <button
          type="button"
          className="t3d-topbar-icon-btn"
          aria-label={t('topbar.shortcuts')}
          onClick={() => setOpen(true)}
        >
          <KeyboardGlyph />
        </button>
      </Tooltip>
      {open ? <ShortcutsDialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const appleDefault = isApplePlatform()
  const [apple, setApple] = useState(appleDefault)
  const groups = useMemo(() => buildGroups(t, modifierSymbol(apple)), [apple, t])

  return (
    <Modal title={t('topbar.shortcutsTitle')} onClose={onClose} className="t3d-shortcuts-modal">
      <div className="t3d-shortcuts-tabs" role="tablist" aria-label={t('topbar.shortcutsTitle')}>
        <button
          type="button"
          role="tab"
          aria-selected={!apple}
          className={!apple ? 'is-active' : undefined}
          onClick={() => setApple(false)}
        >
          {t('topbar.shortcutsWindows')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={apple}
          className={apple ? 'is-active' : undefined}
          onClick={() => setApple(true)}
        >
          {t('topbar.shortcutsMac')}
        </button>
      </div>
      <div className="t3d-shortcuts-grid">
        {[groups.slice(0, 2), groups.slice(2)].map((column, index) => (
          <div key={index} className="t3d-shortcuts-stack">
            {column.map((group) => (
              <section key={group.id} className="t3d-shortcuts-col">
                <h3>{t(group.titleKey)}</h3>
                {group.rows.length === 0 ? (
                  <p className="t3d-shortcuts-empty">{t('topbar.shortcutEmpty')}</p>
                ) : (
                  group.rows.map((row) => (
                    <div key={row.labelKey} className="t3d-shortcuts-row">
                      <span className="t3d-shortcuts-label" dir="auto">{t(row.labelKey)}</span>
                      <span className="t3d-shortcuts-keys">
                        {row.keys.map((combination, index) => (
                          <span key={index} className="t3d-shortcuts-combination" dir="ltr">
                            {index > 0 ? <span className="t3d-shortcuts-alternative" aria-hidden>/</span> : null}
                            {combination.map((key) => <kbd key={key}>{key}</kbd>)}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))
                )}
              </section>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  )
}

function buildGroups(t: TranslateFn, mod: string): Array<{
  id: ShortcutGroupId
  titleKey: string
  rows: ShortcutRow[]
}> {
  return [
    {
      id: 'view',
      titleKey: 'topbar.shortcutView',
      rows: [
        { labelKey: 'topbar.shortcutLookAround', keys: [[t('topbar.shortcutLeftDrag')]] },
        { labelKey: 'topbar.shortcutOrbitRotate', keys: [[t('topbar.shortcutRightDrag')]] },
        { labelKey: 'topbar.shortcutOrbitPan', keys: [[t('topbar.shortcutMiddleDrag')], [t('topbar.shortcutSpaceLeftDrag')]] },
        { labelKey: 'topbar.shortcutOrbitZoom', keys: [[t('topbar.shortcutWheel')]] },
        { labelKey: 'topbar.shortcutFlyMove', keys: [['W', 'A', 'S', 'D']] },
        { labelKey: 'topbar.shortcutFlyVertical', keys: [['Q', 'E']] },
        { labelKey: 'topbar.shortcutFlyFaster', keys: [['Shift']] },
        { labelKey: 'topbar.shortcutFocusSelection', keys: [['F']] },
        { labelKey: 'topbar.shortcutFocusDblclick', keys: [[t('topbar.shortcutDoubleClick')]] },
        { labelKey: 'topbar.shortcutBoxSelect', keys: [[mod, t('topbar.shortcutLeftDrag')]] },
      ],
    },
    {
      id: 'touch',
      titleKey: 'topbar.shortcutTouch',
      rows: [
        { labelKey: 'topbar.shortcutLookAround', keys: [[t('topbar.shortcutOneFingerDrag')]] },
        { labelKey: 'topbar.shortcutOrbitPan', keys: [[t('topbar.shortcutTwoFinger')]] },
        {
          labelKey: 'topbar.shortcutOrbitZoom',
          keys: [[t('topbar.shortcutPinch')], [t('topbar.shortcutModWheel', { mod })]],
        },
      ],
    },
    {
      id: 'object',
      titleKey: 'topbar.shortcutObject',
      rows: [
        { labelKey: 'topbar.shortcutAddSelect', keys: [['Shift', t('topbar.shortcutClick')]] },
        { labelKey: 'topbar.shortcutTransformHandle', keys: [[t('topbar.shortcutDragHandle')]] },
        { labelKey: 'topbar.shortcutDuplicate', keys: [['Alt', t('topbar.shortcutDragHandle')], [mod, 'D']] },
        { labelKey: 'topbar.shortcutDelete', keys: [['Delete'], ['Backspace']] },
        { labelKey: 'topbar.shortcutInsertKeyframe', keys: [['I']] },
      ],
    },
    {
      id: 'timeline',
      titleKey: 'topbar.shortcutTimeline',
      rows: [
        { labelKey: 'topbar.shortcutPlay', keys: [['Alt', 'V']] },
        { labelKey: 'topbar.shortcutPrevFrame', keys: [['←']] },
        { labelKey: 'topbar.shortcutNextFrame', keys: [['→']] },
        { labelKey: 'topbar.shortcutUndo', keys: [[mod, 'Z']] },
        { labelKey: 'topbar.shortcutRedo', keys: [[mod, 'Shift', 'Z']] },
      ],
    },
  ]
}

