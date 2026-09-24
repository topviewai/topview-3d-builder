// 离线素材层（仅服务端）：读取与 CLI 相同的素材清单（scene3d-asset-manifest v1）。
// 内置库在仓库根 builtin-assets/，可用 TOPVIEW3D_BUILTIN_ASSETS 覆盖；
// TOPVIEW3D_PROJECTS 里每个 CLI 项目的 .topview-3d/assets/ 叠加在内置库之上（同 id 以项目为准）。
// 只提供清单里列出的文件，不做任何远程请求。
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { projectRoots } from './localProjects'

const MANIFEST_FORMAT = 'scene3d-asset-manifest'
const MANIFEST_NAME = 'manifest.json'
const POSE_PREFIX = 'a3d_pose_'
export const LOCAL_ASSET_ROUTE = '/api/local-assets'

export type LocalAssetKind = 'character' | 'prop' | 'pose' | 'primitive'

export interface LocalAsset {
  id: string
  kind: LocalAssetKind
  name: string
  key?: string
  file?: string
  cover?: string
  category?: string
  tags?: string[]
  description?: string
  rig?: string
  /** 模型 / 姿势文件的绝对路径 */
  path?: string
  /** 封面的绝对路径 */
  coverPath?: string
}

interface CachedManifest {
  mtimeMs: number
  assets: LocalAsset[]
}

const manifestCache = new Map<string, CachedManifest>()

export function builtinAssetRoot(): string {
  const override = process.env.TOPVIEW3D_BUILTIN_ASSETS?.trim()
  return override ? path.resolve(override) : path.resolve(process.cwd(), '../../../builtin-assets')
}

function inside(root: string, relative: unknown): string | null {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) return null
  if (relative.split(/[\\/]+/).some((part) => part === '..' || part === '.')) return null
  const resolved = path.resolve(root, relative)
  return resolved.startsWith(`${path.resolve(root)}${path.sep}`) ? resolved : null
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizeKey(raw: string): string {
  return raw.trim().split('?')[0]!.replace(/^\/+/, '')
}

function loadManifest(root: string): LocalAsset[] {
  const file = path.join(root, MANIFEST_NAME)
  let mtimeMs: number
  try {
    mtimeMs = statSync(file).mtimeMs
  } catch {
    return []
  }
  const cached = manifestCache.get(root)
  if (cached && cached.mtimeMs === mtimeMs) return cached.assets
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    console.warn(`[studio] 素材清单无法解析: ${file}`, error)
    return []
  }
  const raw = (manifest as { format?: unknown; assets?: unknown })
  if (raw.format !== MANIFEST_FORMAT || !Array.isArray(raw.assets)) {
    console.warn(`[studio] 素材清单格式不对: ${file}`)
    return []
  }
  const assets: LocalAsset[] = []
  for (const item of raw.assets as Record<string, unknown>[]) {
    const id = readString(item?.id)
    const kind = item?.kind as LocalAssetKind
    const name = readString(item?.name) ?? id
    if (!id || !name || !['character', 'prop', 'pose', 'primitive'].includes(kind)) continue
    const asset: LocalAsset = {
      id,
      kind,
      name,
      key: readString(item.key) ? normalizeKey(item.key as string) : undefined,
      file: readString(item.file),
      cover: readString(item.cover),
      category: readString(item.category),
      tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string' && !!tag.trim()) : undefined,
      description: readString(item.description),
      rig: readString(item.rig),
    }
    if (kind !== 'primitive') {
      const modelPath = inside(root, asset.file)
      if (!modelPath || !isFile(modelPath)) continue
      asset.path = modelPath
    }
    const coverPath = asset.cover ? inside(root, asset.cover) : null
    if (coverPath && isFile(coverPath)) asset.coverPath = coverPath
    assets.push(asset)
  }
  manifestCache.set(root, { mtimeMs, assets })
  return assets
}

export function assetCatalog(): LocalAsset[] {
  const byId = new Map<string, LocalAsset>()
  for (const asset of loadManifest(builtinAssetRoot())) byId.set(asset.id, asset)
  for (const root of projectRoots()) {
    for (const asset of loadManifest(path.join(root, '.topview-3d', 'assets'))) {
      byId.delete(asset.id)
      byId.set(asset.id, asset)
    }
  }
  return [...byId.values()]
}

export function findAssetById(id: string): LocalAsset | undefined {
  const catalog = assetCatalog()
  return catalog.find((asset) => asset.id === id)
    ?? catalog.find((asset) => asset.kind === 'pose' && asset.id === `${POSE_PREFIX}${id}`)
}

export function findAssetByKey(key: string): LocalAsset | undefined {
  const normalized = normalizeKey(key)
  return assetCatalog().find((asset) => asset.key === normalized)
}

export interface LocalSearchQuery {
  kind: string
  keyword?: string
  category?: string
  tags?: string[]
  pageNo: number
  pageSize: number
}

function fold(value: string | undefined): string {
  return (value ?? '').toLocaleLowerCase()
}

function matches(asset: LocalAsset, tokens: string[]): boolean {
  const haystack = [asset.name, asset.id, asset.category, asset.description, ...(asset.tags ?? [])].map(fold).join('\n')
  return tokens.every((token) => haystack.includes(token))
}

function assetUrl(id: string): string {
  return `${LOCAL_ASSET_ROUTE}/asset/${encodeURIComponent(id)}`
}

function coverUrl(asset: LocalAsset): string | undefined {
  return asset.coverPath ? `${LOCAL_ASSET_ROUTE}/cover/${encodeURIComponent(asset.id)}` : undefined
}

/** 转成 builder 目录面板认的条目形状。 */
function libraryEntry(asset: LocalAsset): Record<string, unknown> {
  const cover = coverUrl(asset)
  if (asset.kind === 'pose') {
    return {
      id: asset.id.startsWith(POSE_PREFIX) ? asset.id.slice(POSE_PREFIX.length) : asset.id,
      name: asset.name,
      tag: asset.category,
      tags: asset.tags,
      cover,
      coverUrl: cover,
      file: asset.key,
      modelUrl: assetUrl(asset.id),
    }
  }
  return {
    id: asset.id,
    name: asset.name,
    file: asset.key,
    cover,
    coverUrl: cover,
    modelUrl: assetUrl(asset.id),
    description: asset.description,
    category: asset.category,
    rig: asset.rig?.toLowerCase() === 'ual1' ? 'ual1' : asset.rig ? 'mixamorig' : undefined,
  }
}

export function searchAssets(query: LocalSearchQuery) {
  const tokens = fold(query.keyword).split(/\s+/).filter(Boolean)
  const wantedTags = (query.tags ?? []).map(fold)
  const hits = assetCatalog().filter((asset) => {
    if (asset.kind !== query.kind || asset.kind === 'primitive') return false
    if ((asset.kind === 'character' || asset.kind === 'prop') && !asset.key) return false
    if (query.category && asset.category !== query.category) return false
    const tags = (asset.tags ?? []).map(fold)
    if (wantedTags.some((tag) => !tags.includes(tag))) return false
    return matches(asset, tokens)
  })
  const pageSize = Math.max(1, Math.min(500, query.pageSize))
  const pageNo = Math.max(1, query.pageNo)
  const start = (pageNo - 1) * pageSize
  return {
    items: hits.slice(start, start + pageSize).map(libraryEntry),
    total: hits.length,
    pageNo,
    pageSize,
  }
}

function countBy(values: (string | undefined)[]) {
  const counts = new Map<string, number>()
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }))
}

export function assetFacets(kind: string) {
  const assets = assetCatalog().filter((asset) => asset.kind === kind && asset.kind !== 'primitive')
  return {
    categories: countBy(assets.map((asset) => asset.category)),
    tags: countBy(assets.flatMap((asset) => asset.tags ?? [])),
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

export function fileResponse(file: string | undefined): Response {
  if (!file) return Response.json({ error: '素材不存在' }, { status: 404 })
  let body: Buffer
  try {
    body = readFileSync(file)
  } catch {
    return Response.json({ error: '素材文件缺失' }, { status: 404 })
  }
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    },
  })
}
