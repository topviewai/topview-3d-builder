import { localizeMessage } from '../../locale/messages'
import { useDirector, useOverlayClose } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import type { SaveState } from '../../stores/types'
import { cx } from '../common/cx'
import { DirectorStageIcon } from '../common/DirectorStageIcon'
import { Tooltip } from '../common/Tooltip'
import { StudioCloseButton } from '../overlay/StudioCloseButton'
import { TutorialButton } from '../tutorial'
import { AspectRatioSelect } from './AspectRatioSelect'
import { ExportMenu } from './ExportMenu'
import { ShortcutsButton } from './ShortcutsDialog'

export function Topbar() {
  const t = useT()
  const { useStore } = useDirector()
  const onClose = useOverlayClose()
  const loadStatus = useStore((s) => s.loadStatus)
  const ready = useStore((s) => s.ready)
  const writeLocked = useStore((s) => s.writeLocked)
  const doc = useStore((s) => s.doc)
  const draftId = useStore((s) => s.draftId)
  const dirty = useStore((s) => s.dirty)
  const saveState = useStore((s) => s.saveState)
  const saveError = useStore((s) => s.saveError)
  const saveErrorDetail = useStore((s) => s.saveErrorDetail)
  const workspaceMode = useStore((s) => s.workspaceMode)
  const docName = readCustomDraftName(doc?.extra) ?? draftId
  const saveStatus = resolveSaveStatus({
    ready,
    dirty,
    saveState,
    saveError,
    t,
  })

  return (
    <header className="t3d-topbar">
      <div className="t3d-topbar-left">
        <DirectorStageIcon className="t3d-topbar-logo" />
        <span className="t3d-topbar-title">{t('topbar.title')}</span>
        {docName ? (
          <>
            <span className="t3d-topbar-sep" aria-hidden="true">
              ·
            </span>
            <span className="t3d-topbar-doc" title={draftId}>
              {docName}
            </span>
          </>
        ) : null}
        {saveStatus?.tone === 'ok' ? (
          <Tooltip label={saveStatus.text}>
            <span className="t3d-topbar-save t3d-topbar-save-ok">
              <SaveOkIcon />
            </span>
          </Tooltip>
        ) : saveStatus ? (
          <span
            className={cx('t3d-topbar-save', `t3d-topbar-save-${saveStatus.tone}`)}
            title={saveErrorDetail ? localizeMessage(t, saveErrorDetail) : undefined}
          >
            {saveStatus.text}
          </span>
        ) : null}
      </div>
      <div className="t3d-topbar-center">
        {doc ? (
          <AspectRatioSelect
            value={doc.content.aspectRatio}
            disabled={!ready || writeLocked}
            ariaLabel={t('topbar.aspectRatioTitle')}
            menuTitle={t('topbar.aspectRatioMenu')}
            autoLabel={t('topbar.aspectRatioAuto')}
            onChange={(ratio) => useStore.getState().setAspectRatio(ratio)}
          />
        ) : null}
        {workspaceMode !== 'film' ? <ExportMenu disabled={!ready} /> : null}
      </div>
      <div className="t3d-topbar-right">
        <TutorialButton disabled={!ready} />
        <ShortcutsButton />
        {!ready && loadStatus ? (
          <span className="t3d-topbar-status">{localizeMessage(t, loadStatus)}</span>
        ) : null}
        {onClose ? <StudioCloseButton onClose={onClose} /> : null}
      </div>
    </header>
  )
}

function resolveSaveStatus(input: {
  ready: boolean
  dirty: boolean
  saveState: SaveState
  saveError: string | null
  t: (key: string) => string
}): { text: string; tone: 'ok' | 'warn' | 'error' | 'muted' } | null {
  if (!input.ready) return null
  if (input.saveState === 'saving') return { text: input.t('save.saving'), tone: 'muted' }
  if (input.saveState === 'error') {
    return {
      text: input.saveError ? input.t(input.saveError) : input.t('save.failed'),
      tone: 'error',
    }
  }
  if (input.dirty) return { text: input.t('save.unsaved'), tone: 'warn' }
  return { text: input.t('save.saved'), tone: 'ok' }
}

function readCustomDraftName(extra: unknown): string | null {
  if (!extra || typeof extra !== 'object') return null
  const name = (extra as { customDraftName?: unknown }).customDraftName
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

function SaveOkIcon() {
  return (
    <svg className="t3d-topbar-save-mark" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="8" fill="#343434" />
      <path d="M4.15 8.05L6.35 10.45L11.7 5.35" stroke="#9c9c9c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
