import { TopviewCanvasSendButton } from './TopviewCanvasSendButton'
import { TopviewCanvasSentDialog } from './TopviewCanvasSentDialog'
import { useTopviewCanvasAuth } from './hooks/useTopviewCanvasAuth'
import { useTopviewCanvasSend } from './hooks/useTopviewCanvasSend'
import { aspectRatioLabel } from '../../contract/aspectRatio'
import { DualRangeSlider } from '../common/DualRangeSlider'
import { Dropdown } from '../common/Dropdown'
import { Modal } from '../common/Modal'
import { RangeSlider } from '../common/RangeSlider'
import { cx } from '../common/cx'
import { displayCameraName } from '../displayNames'
import { useExportDialog } from './hooks/useExportDialog'

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const s = useExportDialog()
  const canvasAuth = useTopviewCanvasAuth(s.adapter, s.supportsTopviewCanvas)
  const canvasSend = useTopviewCanvasSend((canvas) => s.sendToCanvas(canvas.id, s.output))
  if (!s.doc || !s.tl) return null
  if (canvasSend.sent) return <TopviewCanvasSentDialog canvasUrl={canvasSend.sent.canvasUrl} onClose={onClose} />

  return (
    <Modal
      title={s.t('export.title')}
      onClose={onClose}
      closeDisabled={s.exporting}
      className="t3d-export-modal"
      footer={
        <>
          <span className="t3d-export-footer-hint">
            {s.output === 'image'
              ? s.t('export.hintImage')
              : s.t('export.hintVideo', { start: s.start, end: s.end })}
          </span>
          <button
            type="button"
            className="t3d-dialog-ghost"
            onClick={canvasSend.sending ? s.abort : onClose}
            disabled={s.exporting && !canvasSend.sending}
          >
            {canvasSend.sending ? s.t('export.cancelSend') : s.t('common.cancel')}
          </button>
          <button
            type="button"
            className="t3d-dialog-ghost t3d-export-download"
            disabled={s.exporting}
            onClick={() => void (s.output === 'image' ? s.onDownloadImage() : s.onDownloadVideo())}
          >
            {s.t('export.download')}
          </button>
          {s.supportsTopviewCanvas ? (
            <TopviewCanvasSendButton
              adapter={s.adapter}
              auth={canvasAuth.auth}
              loginUrl={canvasAuth.loginUrl}
              disabled={s.exporting}
              sending={canvasSend.sending}
              tooltip={s.exporting ? s.t('help.exporting') : ''}
              onSend={(canvas) => void canvasSend.start(canvas)}
              onUnauthorized={canvasAuth.markUnauthorized}
            />
          ) : (
            <button
              type="button"
              className="t3d-dialog-solid"
              disabled={s.exporting}
              onClick={() => void (s.output === 'image' ? s.onExportImage() : s.onExportVideo())}
            >
              {s.t('export.sendToCanvas')}
            </button>
          )}
        </>
      }
    >
      <div className="t3d-export-layout">
        <div className="t3d-export-preview">
          <canvas
            ref={s.previewCanvasRef}
            className="t3d-export-preview-canvas"
            hidden={s.output !== 'video'}
          />
          {s.output === 'image' ? (
            s.previewUrl ? (
              <img src={s.previewUrl} alt="" />
            ) : (
              <div className="t3d-export-preview-empty">
                {s.previewLoading ? s.t('common.loading') : s.t('export.previewEmpty')}
              </div>
            )
          ) : null}
          {s.progress ? (
            <div className="t3d-export-progress">
              {s.t('export.progress', {
                index: s.progress.index,
                total: s.progress.total,
                frame: Math.round(s.progress.frame),
              })}
              <button type="button" className="t3d-dialog-cancel" onClick={s.abort}>
                {s.t('common.cancel')}
              </button>
            </div>
          ) : null}
        </div>
        <div className="t3d-export-form">
          <div className="t3d-export-field">
            <span>{s.t('export.outputType')}</span>
            <div className="t3d-export-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                className={cx(s.output === 'image' && 'is-active')}
                aria-selected={s.output === 'image'}
                disabled={s.exporting}
                onClick={() => s.setOutput('image')}
              >
                {s.t('export.outputImage')}
              </button>
              <button
                type="button"
                role="tab"
                className={cx(s.output === 'video' && 'is-active')}
                aria-selected={s.output === 'video'}
                disabled={s.exporting}
                onClick={() => s.setOutput('video')}
              >
                {s.t('export.outputVideo')}
              </button>
            </div>
          </div>
          <div className="t3d-export-field">
            <span>{s.t('export.camera')}</span>
            <Dropdown
              ariaLabel={s.t('export.camera')}
              value={s.cameraId}
              disabled={s.exporting}
              options={[
                { value: s.editorCameraId, label: s.t('cameraPreset.current') },
                ...s.cameras.map((c) => ({ value: c.id, label: displayCameraName(s.t, c.name) })),
              ]}
              onChange={s.setCameraId}
            />
          </div>
          {s.output === 'image' ? (
            <div className="t3d-export-field">
              <span className="t3d-export-field-head">
                <span>{s.t('export.currentFrame')}</span>
                <em>{Math.round(s.currentFrame)}</em>
              </span>
              <RangeSlider
                aria-label={s.t('export.currentFrame')}
                value={s.currentFrame}
                min={s.frameStart}
                max={s.frameEnd}
                step={1}
                disabled={s.exporting}
                onChange={(event) => s.setCurrentFrame(Number(event.target.value))}
              />
            </div>
          ) : (
            <div className="t3d-export-field">
              <span className="t3d-export-field-head">
                <span>{s.t('export.frameRange')}</span>
                <em>
                  {s.start}–{s.end}
                </em>
              </span>
              <DualRangeSlider
                min={s.frameStart}
                max={s.frameEnd}
                start={s.start}
                end={s.end}
                disabled={s.exporting}
                startAriaLabel={s.t('export.frameStart')}
                endAriaLabel={s.t('export.frameEnd')}
                onStartChange={s.setStart}
                onEndChange={s.setEnd}
              />
            </div>
          )}
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
          {s.status ? <div className="t3d-dialog-status">{s.status}</div> : null}
        </div>
      </div>
    </Modal>
  )
}
