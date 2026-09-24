import { useEffect, useId, useMemo } from 'react'
import { DEFAULT_FPS, DEFAULT_FRAMES, FPS_MAX, FPS_MIN } from '../constants'

interface CreateDialogProps {
  busy: boolean
  name: string
  fps: number
  frames: number
  withCamera: boolean
  error?: string | null
  onName: (value: string) => void
  onFps: (value: number) => void
  onFrames: (value: number) => void
  onCamera: (value: boolean) => void
  onClose: () => void
  onSubmit: () => void
}

export function CreateDialog({
  busy,
  name,
  fps,
  frames,
  withCamera,
  error,
  onName,
  onFps,
  onFrames,
  onCamera,
  onClose,
  onSubmit,
}: CreateDialogProps) {
  const titleId = useId()
  const duration = useMemo(() => (fps > 0 ? (frames / fps).toFixed(1) : '—'), [fps, frames])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="wb-overlay" onClick={onClose} role="presentation">
      <div
        className="wb-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="wb-dialog-head">
          <h2 id={titleId}>新建草稿</h2>
          <button type="button" className="wb-icon-btn" onClick={onClose} disabled={busy} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="wb-dialog-body">
          <label className="wb-field">名称<input value={name} onChange={(e) => onName(e.target.value)} autoFocus />
          </label>
          <div className="wb-field-row">
            <label className="wb-field">帧率<input
                type="number"
                min={FPS_MIN}
                max={FPS_MAX}
                value={fps}
                onChange={(e) => {
                  const raw = Number(e.target.value)
                  if (!Number.isFinite(raw)) {
                    onFps(DEFAULT_FPS)
                    return
                  }
                  onFps(Math.min(FPS_MAX, Math.max(FPS_MIN, Math.round(raw))))
                }}
              />
            </label>
            <label className="wb-field">总帧数<input
                type="number"
                min={1}
                value={frames}
                onChange={(e) => onFrames(Number(e.target.value) || DEFAULT_FRAMES)}
              />
            </label>
          </div>
          <p className="wb-hint">
            {`约 ${duration} 秒 · ${fps} fps · ${frames} 帧`}
          </p>
          <label className="wb-check">
            <input type="checkbox" checked={withCamera} onChange={(e) => onCamera(e.target.checked)} />含默认机位（正面中景）</label>
          {error ? <p className="wb-error">{error}</p> : null}
        </div>
        <div className="wb-dialog-foot">
          <button type="button" className="wb-ghost" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="wb-cta" onClick={onSubmit} disabled={busy}>
            {busy ? '创建中…' : '创建并打开'}
          </button>
        </div>
      </div>
    </div>
  )
}
