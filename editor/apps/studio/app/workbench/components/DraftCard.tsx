import { DraftGlyph } from './icons'
import type { DraftRow } from '../types'
import { coverTone, formatDraftMeta } from '../utils'

interface DraftCardProps {
  draft: DraftRow
  readonly?: boolean
  confirming?: boolean
  busy?: boolean
  onOpen: (id: string) => void
  onConfirmingChange?: (id: string | null) => void
  onRemove?: () => void
}

export function DraftCard({
  draft,
  readonly = false,
  confirming = false,
  busy = false,
  onOpen,
  onConfirmingChange,
  onRemove,
}: DraftCardProps) {
  const [from, to] = coverTone(draft.id)
  const meta = formatDraftMeta(draft)

  return (
    <article className="wb-card">
      <button type="button" className="wb-card-hit" onClick={() => onOpen(draft.id)}>
        <span
          className="wb-card-cover"
          style={{ background: `linear-gradient(160deg, ${from} 0%, #111214 58%, ${to} 140%)` }}
        >
          <span className="wb-card-cover-grid" />
          <DraftGlyph />
          {readonly && <span className="wb-card-flag">只读</span>}
        </span>
        <span className="wb-card-body">
          <span className="wb-card-title">{draft.name}</span>
          <span className="wb-card-meta">{meta || draft.id}</span>
        </span>
      </button>
      {!readonly && (
        <div className="wb-card-actions">
          {confirming ? (
            <>
              <button type="button" className="wb-danger" disabled={busy} onClick={onRemove}>确认删除</button>
              <button type="button" className="wb-ghost" disabled={busy} onClick={() => onConfirmingChange?.(null)}>取消</button>
            </>
          ) : (
            <button
              type="button"
              className="wb-ghost"
              disabled={busy}
              onClick={() => onConfirmingChange?.(draft.id)}
            >删除</button>
          )}
        </div>
      )}
    </article>
  )
}
