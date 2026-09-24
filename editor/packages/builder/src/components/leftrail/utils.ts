import type { DraftNode } from '../../contract/types'
import type { TranslateFn } from '../../locale'
import { isDerivedTransformPath } from '../../evaluate/path/deriveWalk'
import { displayNodeName } from '../displayNames'

export { isDerivedTransformPath }

export function tOr(t: TranslateFn, key: string, fallback: string): string {
  const value = t(key)
  return value === key ? fallback : value
}

export function catalogPreviewSrc(url?: string, key?: string): string | undefined {
  const value = url?.trim() || key?.trim()
  return value || undefined
}

export function matchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return name.toLowerCase().includes(q)
}

export function groupByCategory<T extends { category?: string }>(
  items: T[],
  fallback = '',
): Array<{ category: string; items: T[] }> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = item.category?.trim() || fallback
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return [...map.entries()].map(([category, grouped]) => ({ category, items: grouped }))
}

export interface TreeRow {
  id: string
  name: string
  type: DraftNode['type'] | 'scene'
  depth: number
  node?: DraftNode
}

export function buildObjectRows(nodes: DraftNode[], query: string, t: TranslateFn): TreeRow[] {
  const byParent = new Map<string | null, DraftNode[]>()
  for (const node of nodes) {
    if (isDerivedTransformPath(node)) continue
    const parent = node.parentId ?? null
    const list = byParent.get(parent)
    if (list) list.push(node)
    else byParent.set(parent, [node])
  }
  const walk = (parentId: string | null, depth: number): TreeRow[] => {
    const children = byParent.get(parentId) ?? []
    return children.flatMap((node) => [
      { id: node.id, name: displayNodeName(t, node), type: node.type, depth, node },
      ...walk(node.id, depth + 1),
    ])
  }
  const rows = walk(null, 0)
  if (!query.trim()) {
    return [{ id: '__scene__', name: '', type: 'scene', depth: 0 }, ...rows]
  }
  return rows.filter((row) => {
    const persist = row.node?.name ?? row.name
    return matchesQuery(persist, query) || matchesQuery(row.name, query)
  })
}

export function uniqueCategories(
  facets: string[],
  items: Array<{ category?: string }> | null,
): string[] {
  const fromItems = [...new Set((items ?? []).map((i) => i.category?.trim()).filter(Boolean))] as string[]
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of [...facets, ...fromItems]) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export function sectionDomId(tab: string, key: string): string {
  return `t3d-leftrail-sec-${tab}-${key.replace(/[^\w\u4e00-\u9fff-]+/g, '-')}`
}

export function treeIconKind(type: TreeRow['type']): 'scene' | 'character' | 'prop' | 'camera' | 'object' {
  if (type === 'scene') return 'scene'
  if (type === 'character') return 'character'
  if (type === 'camera') return 'camera'
  if (type === 'prop' || type === 'primitive') return 'prop'
  return 'object'
}
