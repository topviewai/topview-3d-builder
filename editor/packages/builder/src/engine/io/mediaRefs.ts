import type { DirectorDocument, DraftNode, MediaRef } from '../../contract/types'

export type ResolveMediaUrl = (ref: MediaRef) => Promise<string> | string

export async function resolvedMediaUrl(resolve: ResolveMediaUrl, ref: MediaRef): Promise<string> {
  return await Promise.resolve(resolve(ref))
}

function metaString(meta: unknown, key: string): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined
  const value = (meta as Record<string, unknown>)[key]
  return typeof value === 'string' && value ? value : undefined
}

export function characterMediaRef(node: DraftNode): MediaRef {
  return {
    kind: 'character',
    assetId: metaString(node.metadata, 'assetId'),
    sourceUrl: metaString(node.metadata, 'modelUrl'),
    sourcePath: metaString(node.metadata, 'assetSource'),
  }
}

export function propMediaRef(node: DraftNode): MediaRef | null {
  const sourceUrl = metaString(node.metadata, 'modelUrl')
  if (!sourceUrl) return null
  return { kind: 'prop', sourceUrl, sourcePath: sourceUrl }
}

export function motionMediaRef(doc: DirectorDocument, assetId: string): MediaRef | null {
  const entry = doc.content.asset.motionPath.find((e) => e.id === assetId)
  if (!entry) return null
  return { kind: 'motion', assetId, sourcePath: entry.path, sourceUrl: entry.path }
}
