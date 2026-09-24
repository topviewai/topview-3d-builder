import { createPortal } from 'react-dom'
import { useT } from '../../locale'
import { usePortalRoot } from '../overlay/PortalRoot'
import { useNavigationHint } from './hooks/useNavigationHint'

export function NavigationHint({ hidden }: { hidden: boolean }) {
  const t = useT()
  const portal = usePortalRoot()
  const { visible, toast, dismiss } = useNavigationHint()
  return <>
    {visible && !hidden && (
      <aside className="t3d-navigation-hint" aria-label={t('topbar.shortcuts')} onPointerDown={(event) => event.stopPropagation()}>
        <div className="t3d-navigation-hint-header">
          <span>{t('topbar.shortcuts')}</span>
          <button type="button" className="t3d-navigation-hint-close" aria-label={t('common.close')} onClick={dismiss}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="m3 3 6 6m0-6L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="t3d-navigation-hint-body">
        <div className="t3d-navigation-hint-move">
          <div className="t3d-navigation-hint-keys" dir="ltr">
            <kbd className="t3d-navigation-hint-w">W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
          </div>
          <span>{t('viewport.translate')}</span>
        </div>
        <div className="t3d-navigation-hint-vertical">
          <span><kbd>E</kbd>{t('tutorial.viewportUp')}</span>
          <span><kbd>Q</kbd>{t('tutorial.viewportDown')}</span>
        </div>
        </div>
      </aside>
    )}
    {toast && portal && createPortal(
      <div className="t3d-camera-aim-toast" role="status" aria-live="polite">{t('viewport.navigationHintDismissed')}</div>, portal,
    )}
  </>
}
