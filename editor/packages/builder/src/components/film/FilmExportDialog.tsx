import { useState } from 'react'
import { Tooltip } from '../common/Tooltip'
import { CanvasExportPicker } from '../dialogs/CanvasExportPicker'
import { aspectRatioLabel } from '../../contract/aspectRatio'
import { Dropdown } from '../common/Dropdown'
import { Modal } from '../common/Modal'
import { useFilmExportDialog } from './hooks/useFilmExportDialog'

export function FilmExportDialog({
  sequenceId,
  onClose,
}: {
  sequenceId: string
  onClose: () => void
}) {
  const s = useFilmExportDialog(sequenceId, onClose)
  const [picking, setPicking] = useState(false)
  if (!s.sequence) return null

  return (
    <Modal
      title={s.t('film.exportTitle')}
      subtitle={s.t('film.exportSubtitle')}
      onClose={s.exporting ? s.abort : onClose}
      closeDisabled={false}
      className="t3d-export-modal t3d-export-modal--film"
      footer={
        <>
          <span className="t3d-export-footer-hint">
            {s.t('film.exportHint', { clips: s.sequence.clips.length, duration: s.durationLabel })}
          </span>
          <button
            type="button"
            className="t3d-dialog-ghost"
            onClick={() => (s.exporting ? s.abort() : onClose())}
          >
            {s.t('common.cancel')}
          </button>
          <button
            type="button"
            className="t3d-dialog-ghost t3d-export-download"
            disabled={!s.canExport}
            onClick={() => void s.start(true)}
          >
            {s.t('export.download')}
          </button>
          <Tooltip label={s.exporting ? s.t('help.exporting') : s.duration <= 0 ? s.t('help.needClip') : s.issues.length ? s.t('film.issue.' + s.issues[0].code) : ''} side="top" variant="description">
            <button
              aria-label={s.t('export.sendToCanvas')}
              type="button"
              className="t3d-dialog-solid"
              disabled={!s.canExport}
              onClick={() => (s.supportsTopviewCanvas ? setPicking(true) : void s.start())}
            >
              {s.t('export.sendToCanvas')}
            </button>
          </Tooltip>
        </>
      }
    >
      <div className="t3d-export-layout t3d-export-layout--film">
        <div
          className="t3d-export-preview t3d-export-preview--stage"
          style={{ ['--t3d-export-aspect' as string]: String(s.previewAspect) }}
        >
          <div className="t3d-export-preview-frame">
            {s.previewUrl ? (
              <img src={s.previewUrl} alt="" />
            ) : (
              <div className="t3d-export-preview-empty">
                {s.previewLoading ? s.t('common.loading') : s.t('export.previewEmpty')}
              </div>
            )}
          </div>
          {s.progress ? (
            <div className="t3d-export-progress">
              {s.t('film.exportProgress', {
                index: s.progress.index,
                total: s.progress.total,
                source: s.progress.sourceFrame,
              })}
              <button type="button" className="t3d-dialog-cancel" onClick={s.abort}>
                {s.t('common.cancel')}
              </button>
            </div>
          ) : null}
        </div>
        <div className="t3d-export-form">
          <label className="t3d-export-field">
            <span>{s.t('film.exportName')}</span>
            <input
              type="text"
              value={s.fileName}
              disabled={s.exporting}
              placeholder={s.versionName}
              onChange={(event) => s.setFileName(event.target.value)}
            />
          </label>
          <div className="t3d-export-field">
            <span>{s.t('film.exportLength')}</span>
            <span className="t3d-export-readonly">
              {s.durationLabel}
            </span>
          </div>
          <div className="t3d-export-field">
            <span>{s.t('export.resolution')}</span>
            <Dropdown
              ariaLabel={s.t('export.resolution')}
              value={String(s.height)}
              disabled={s.exporting}
              options={s.resolutionOptions}
              onChange={s.setExportHeight}
            />
          </div>
          <div className="t3d-export-field">
            <span>{s.t('export.aspectRatio')}</span>
            <Dropdown
              ariaLabel={s.t('export.aspectRatio')}
              value={s.aspectRatio}
              disabled={s.exporting}
              options={s.aspectOptions.map((ratio) => ({
                value: ratio,
                label: aspectRatioLabel(ratio, s.t('topbar.aspectRatioAuto')),
              }))}
              onChange={s.setAspectRatio}
            />
          </div>
          {picking && s.supportsTopviewCanvas ? (
            <CanvasExportPicker
              adapter={s.adapter}
              busy={s.exporting}
              onCancel={() => setPicking(false)}
              onConfirm={(canvas) => {
                setPicking(false)
                s.sendToCanvas(canvas.id)
              }}
            />
          ) : null}
          {s.issues.length > 0 ? (
            <div className="t3d-film-issues" role="alert">
              {s.issues.map((issue) => <div key={issue.code}>{issue.message}</div>)}
            </div>
          ) : null}
          {s.error ? <p className="t3d-film-field-error">{s.error}</p> : null}
        </div>
      </div>
    </Modal>
  )
}
