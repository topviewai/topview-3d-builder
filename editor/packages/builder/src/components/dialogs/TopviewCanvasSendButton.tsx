import { Tooltip } from '../common/Tooltip'
import { useT } from '../../locale'
import type { TopviewCanvasAuth } from './hooks/useTopviewCanvasAuth'

export function TopviewCanvasSendButton({
  auth,
  loginUrl,
  disabled,
  tooltip,
  onClick,
}: {
  auth: TopviewCanvasAuth | null
  loginUrl: string
  disabled: boolean
  tooltip: string
  onClick: () => void
}) {
  const t = useT()
  const needsLogin = auth === 'unauthorized'
  const blocked = disabled || auth === 'checking' || needsLogin
  const label = needsLogin ? t('export.needSignIn') : tooltip
  return (
    <>
      {needsLogin && loginUrl ? (
        <a className="t3d-export-signin" href={loginUrl} target="_blank" rel="noopener">
          {t('export.signUpOrIn')}
        </a>
      ) : null}
      <Tooltip label={label} side="top" variant="description">
        <button
          type="button"
          className="t3d-dialog-solid"
          aria-label={t('export.sendToCanvas')}
          disabled={blocked}
          onClick={onClick}
        >
          {t('export.sendToCanvas')}
        </button>
      </Tooltip>
    </>
  )
}
