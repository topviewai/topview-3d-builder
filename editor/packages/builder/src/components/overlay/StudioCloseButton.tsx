import { useState } from 'react'
import { useT } from '../../locale'

interface StudioCloseButtonProps {
  onClose: () => void | boolean | Promise<void | boolean>
}

export function StudioCloseButton({ onClose }: StudioCloseButtonProps) {
  const t = useT()
  const [closing, setClosing] = useState(false)

  const close = () => {
    if (closing) return
    setClosing(true)
    // 保存成功后保持转圈直到卸载。清掉 loading 会在退回前把 Done 再画出来。
    void Promise.resolve(onClose()).then(
      (closed) => {
        if (closed === false) setClosing(false)
      },
      () => setClosing(false),
    )
  }

  return (
    <button
      type="button"
      className={closing ? 't3d-studio-close is-loading' : 't3d-studio-close'}
      aria-label={closing ? t('close.saving') : t('close.done')}
      aria-busy={closing}
      disabled={closing}
      onClick={close}
    >
      <span className="t3d-studio-close-face">
        <DoneMark />
        {t('close.done')}
      </span>
      {closing ? <span className="t3d-studio-close-spinner" aria-hidden="true" /> : null}
    </button>
  )
}

function DoneMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.6 7.2 5.5 10.1 11.4 3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
