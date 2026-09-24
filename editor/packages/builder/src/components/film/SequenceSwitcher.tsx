// 多版本（editorial.sequences）仍是草稿的持久化能力，只是当前不在工具栏露出。
// 这个组件暂时不挂载，等版本管理重新进 UI 时直接接回去。
import { useEffect, useRef, useState } from 'react'
import { getEditorial } from '../../evaluate/editSequence'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { cx } from '../common/cx'

export function SequenceSwitcher({ disabled }: { disabled?: boolean }) {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const {
    activateFilmSequence,
    createFilmSequence,
    renameFilmSequence,
    duplicateFilmSequence,
    deleteFilmSequence,
  } = useStore()
  const [open, setOpen] = useState(false)
  const [renameId, setRenameId] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const editorial = doc ? getEditorial(doc) : null
  const active = editorial?.sequences.find((sequence) => sequence.id === editorial.activeSequenceId)

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  if (!editorial) return null

  return (
    <div className="t3d-film-version" ref={wrapRef}>
      <button
        type="button"
        className="t3d-timeline-text-btn t3d-film-version-btn"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {active?.name?.trim() || t('film.untitledVersion')}
      </button>
      {open ? (
        <div className="t3d-dropdown-menu is-anchored t3d-film-version-menu" role="menu">
          {editorial.sequences.map((sequence) => (
            <div key={sequence.id} className={cx('t3d-film-version-row', sequence.id === editorial.activeSequenceId && 'is-active')}>
              {renameId === sequence.id ? (
                <input
                  className="t3d-film-version-input"
                  defaultValue={sequence.name ?? ''}
                  autoFocus
                  aria-label={t('film.renameVersion')}
                  onBlur={(event) => {
                    renameFilmSequence(sequence.id, event.target.value)
                    setRenameId(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') setRenameId(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="t3d-film-version-name"
                  onClick={() => {
                    activateFilmSequence(sequence.id)
                    setOpen(false)
                  }}
                >
                  {sequence.name?.trim() || t('film.untitledVersion')}
                </button>
              )}
              <button type="button" className="t3d-film-version-action" onClick={() => setRenameId(sequence.id)}>
                {t('film.rename')}
              </button>
              <button type="button" className="t3d-film-version-action" onClick={() => duplicateFilmSequence(sequence.id)}>
                {t('film.duplicate')}
              </button>
              <button
                type="button"
                className="t3d-film-version-action"
                disabled={editorial.sequences.length <= 1}
                onClick={() => deleteFilmSequence(sequence.id)}
              >
                {t('film.delete')}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="t3d-film-version-create"
            onClick={() => {
              createFilmSequence()
              setOpen(false)
            }}
          >
            {t('film.newVersion')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
