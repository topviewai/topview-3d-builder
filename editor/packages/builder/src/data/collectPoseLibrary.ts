import { poseRecordFromLibrary } from './poseLibraryBank'
import type { PoseLibraryRecord } from './poseLibraryBank'

export const POSE_LIBRARY_PAGE_SIZE = 200
export const POSE_LIBRARY_MAX_PAGES = 20

export interface PoseLibrarySearchPage {
  items: readonly unknown[]
  total?: number
}

function isPoseEntry(value: unknown): value is Parameters<typeof poseRecordFromLibrary>[0] {
  if (!value || typeof value !== 'object') return false
  const row = value as { id?: unknown }
  return typeof row.id === 'string' && row.id.length > 0
}

export function collectUsedPoseIds(doc: {
  content: { nodes: Array<{ character?: { animation?: { posePresetId?: string } } }> }
}): string[] {
  const ids = new Set<string>()
  for (const node of doc.content.nodes) {
    const poseId = node.character?.animation?.posePresetId
    if (poseId) ids.add(poseId)
  }
  return [...ids]
}

export async function collectPoseLibraryPages(
  search: (pageNo: number, pageSize: number) => Promise<PoseLibrarySearchPage>,
): Promise<PoseLibraryRecord[]> {
  const records: PoseLibraryRecord[] = []
  let pageNo = 1
  let total = Number.POSITIVE_INFINITY
  while (pageNo <= POSE_LIBRARY_MAX_PAGES && (pageNo - 1) * POSE_LIBRARY_PAGE_SIZE < total) {
    const page = await search(pageNo, POSE_LIBRARY_PAGE_SIZE)
    if (typeof page.total === 'number' && page.total >= 0) {
      total = page.total
    } else if (page.items.length < POSE_LIBRARY_PAGE_SIZE) {
      total = (pageNo - 1) * POSE_LIBRARY_PAGE_SIZE + page.items.length
    } else {
      total = pageNo * POSE_LIBRARY_PAGE_SIZE + 1
    }
    for (const item of page.items) {
      if (!isPoseEntry(item)) continue
      const record = poseRecordFromLibrary(item)
      if (record) records.push(record)
    }
    if (page.items.length === 0) break
    pageNo += 1
  }
  return records
}
