import { useEffect, useRef } from 'react'
import { Modal } from '../common/Modal'
import { useT } from '../../locale'

export function TopviewCanvasSentDialog({ canvasUrl, onClose }: { canvasUrl: string; onClose: () => void }) {
  const t = useT()
  const goRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    goRef.current?.focus()
  }, [])

  const go = () => {
    if (canvasUrl) window.open(canvasUrl, '_blank', 'noopener')
    onClose()
  }

  return (
    <Modal
      title={t('export.sentTitle')}
      onClose={onClose}
      className="t3d-canvas-sent-modal"
      footer={
        <>
          <button type="button" className="t3d-dialog-ghost" onClick={onClose}>
            {t('export.stayInBuilder')}
          </button>
          <button ref={goRef} type="button" className="t3d-dialog-solid" disabled={!canvasUrl} onClick={go}>
            {t('export.goToCanvas')}
          </button>
        </>
      }
    >
      <p className="t3d-canvas-sent-text">{t('export.sentAsk')}</p>
    </Modal>
  )
}
