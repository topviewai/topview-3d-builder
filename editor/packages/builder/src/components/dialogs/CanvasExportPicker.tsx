import { useEffect, useState } from 'react'
import type { HostAdapter, TopviewCanvasSummary } from '../../host/types'
import { useT } from '../../locale'

export function CanvasExportPicker({
  adapter,
  busy,
  onCancel,
  onConfirm,
  onUnauthorized,
}: {
  adapter: HostAdapter
  busy: boolean
  onCancel: () => void
  onConfirm: (canvas: TopviewCanvasSummary) => void
  onUnauthorized: () => void
}) {
  const t = useT()
  const [canvases, setCanvases] = useState<TopviewCanvasSummary[]>([])
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void adapter.listTopviewCanvases?.()
      .then((rows) => {
        if (cancelled) return
        setCanvases(rows)
        setSelected(rows[0]?.id ?? '')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof Error && err.message === 'TOPVIEW_CANVAS_AUTH') onUnauthorized()
        else setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // onUnauthorized 每次渲染都是新函数，只在换宿主时重新拉列表。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter])

  const create = async () => {
    setError('')
    try {
      const created = await adapter.createTopviewCanvas?.(name)
      if (!created) return
      setCanvases((rows) => [created, ...rows.filter((row) => row.id !== created.id)])
      setSelected(created.id)
      setName('')
    } catch (err) {
      if (err instanceof Error && err.message === 'TOPVIEW_CANVAS_AUTH') onUnauthorized()
      else setError(err instanceof Error ? err.message : String(err))
    }
  }

  const chosen = canvases.find((row) => row.id === selected)

  return (
    <div className="t3d-export-field t3d-canvas-picker">
      <span>{t('export.pickCanvas')}</span>
      {loading ? (
        <span>{t('common.loading')}</span>
      ) : (
        <div className="t3d-canvas-list" role="listbox" aria-label={t('export.pickCanvas')}>
          {canvases.length === 0 ? <span>{t('export.canvasEmpty')}</span> : null}
          {canvases.map((canvas) => (
            <label key={canvas.id}>
              <input
                type="radio"
                name="topview-canvas"
                value={canvas.id}
                checked={selected === canvas.id}
                disabled={busy}
                onChange={() => setSelected(canvas.id)}
              />
              <span>{canvas.name}</span>
            </label>
          ))}
        </div>
      )}
      <div className="t3d-canvas-create">
        <input
          type="text"
          value={name}
          maxLength={200}
          disabled={busy}
          placeholder={t('export.canvasName')}
          aria-label={t('export.canvasName')}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="button" className="t3d-dialog-ghost" disabled={busy || !name.trim()} onClick={() => void create()}>
          {t('export.createCanvas')}
        </button>
      </div>
      {error ? <div className="t3d-dialog-status">{error}</div> : null}
      <div className="t3d-canvas-actions">
        <button type="button" className="t3d-dialog-ghost" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="t3d-dialog-solid" disabled={busy || !chosen} onClick={() => chosen && onConfirm(chosen)}>
          {t('export.sendToCanvas')}
        </button>
      </div>
    </div>
  )
}
