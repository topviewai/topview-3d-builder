import { COVER_TONES, DRAFT_QUERY_KEY, PROJECT_QUERY_KEY } from './constants'
import type { DraftRow } from './types'

const DRAFT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i

export function isValidDraftId(id: string): boolean {
  return DRAFT_ID_PATTERN.test(id)
}

export function readDraftQuery(value: string | null | undefined): string | null {
  if (!value) return null
  return isValidDraftId(value) ? value : null
}

export function buildWorkbenchHref(
  search: string,
  open: { draft?: string; project?: string } | null,
): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  params.delete(DRAFT_QUERY_KEY)
  params.delete(PROJECT_QUERY_KEY)
  if (open?.draft) params.set(DRAFT_QUERY_KEY, open.draft)
  else if (open?.project) params.set(PROJECT_QUERY_KEY, open.project)
  const qs = params.toString()
  return qs ? `/?${qs}` : '/'
}

export function slugify(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return ascii || 'draft'
}

export function coverTone(id: string): readonly [string, string] {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash + id.charCodeAt(i) * 17) % COVER_TONES.length
  }
  return COVER_TONES[hash] ?? COVER_TONES[0]
}

export function formatDraftMeta(draft: DraftRow): string {
  const parts: string[] = []
  if (draft.nodeCount != null) parts.push(`${draft.nodeCount} 节点`)
  if (draft.fps) parts.push(`${draft.fps} fps`)
  if (draft.frameEnd) parts.push(`${draft.frameEnd} 帧`)
  return parts.join(' · ')
}
