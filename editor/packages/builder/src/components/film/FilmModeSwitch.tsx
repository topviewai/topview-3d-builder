import { Tooltip } from '../common/Tooltip'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import type { WorkspaceMode } from '../../stores/types'
import { cx } from '../common/cx'

export function FilmModeSwitch({ disabled }: { disabled?: boolean }) {
  const t = useT()
  const { useStore } = useDirector()
  const mode = useStore((s) => s.workspaceMode)
  const setWorkspaceMode = useStore((s) => s.setWorkspaceMode)

  return (
    <div className="t3d-film-mode" role="radiogroup" aria-label={t('film.mode')}>
      {(['scene', 'film'] as const).map((value: WorkspaceMode) => (
        <Tooltip key={value} label={disabled ? t('help.exporting') : value === 'film' ? t('help.filmMode') : ''} side="top" variant="description">
          <button
            type="button"
            role="radio"
            aria-label={t(value === 'scene' ? 'film.modeScene' : 'film.modeFilm')}
            aria-checked={mode === value}
            className={cx('t3d-film-mode-btn', mode === value && 'is-active')}
            disabled={disabled}
            data-tutorial-anchor={value === 'film' ? 'filmMode' : undefined}
            onClick={() => setWorkspaceMode(value)}
          >
            {t(value === 'scene' ? 'film.modeScene' : 'film.modeFilm')}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}
