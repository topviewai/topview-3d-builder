import { navigationHintPreference } from './navigationHintPreference'
import {
  normalizeAssetKey,
  type AssetFacets,
  type AssetPage,
  type AssetQuery,
  type CharacterLibEntry,
  type DirectorDocument,
  type HostAdapter,
  type MediaRef,
  type MotionLibEntry,
  type PoseBonesPayload,
  type PoseLibEntry,
  type PropLibEntry,
  type ExportMeta,
  type TopviewCanvasSummary,
} from '@topview/3d-builder'

const LOCAL_ASSET_ROUTE = '/api/local-assets'

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

const getInflight = new Map<string, Promise<unknown>>()
const poseJsonByUrl = new Map<string, Promise<unknown>>()

async function canvasJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  const body = await res.json().catch(() => null)
  if (res.status === 401) throw new Error('TOPVIEW_CANVAS_AUTH')
  if (!res.ok) {
    const message = isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${res.status}`
    throw new Error(message)
  }
  return body
}

function fetchJsonOnce(url: string): Promise<unknown> {
  const pending = getInflight.get(url)
  if (pending) return pending
  const request = fetchJson(url).finally(() => {
    getInflight.delete(url)
  })
  getInflight.set(url, request)
  return request
}

function fetchPoseJson(url: string): Promise<unknown> {
  const hit = poseJsonByUrl.get(url)
  if (hit) return hit
  const request = fetchJson(url).catch((error) => {
    poseJsonByUrl.delete(url)
    throw error
  })
  poseJsonByUrl.set(url, request)
  return request
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function keyUrl(key: string): string {
  return `${LOCAL_ASSET_ROUTE}/file/${normalizeAssetKey(key).split('/').map(encodeURIComponent).join('/')}`
}

export type LocalDocumentSource = 'draft' | 'project'

/**
 * 纯本地宿主：草稿走 /api/drafts，CLI 项目走 /api/projects。两边都可以保存。
 * 素材搜索与文件都来自本机素材清单（/api/local-assets）。没有登录，也不访问外网。
 */
export class LocalHostAdapter implements HostAdapter<DirectorDocument> {
  getNavigationHintDismissed = navigationHintPreference.read
  dismissNavigationHint = navigationHintPreference.dismiss

  readonly readOnly: boolean
  private readonly base: string

  constructor(source: LocalDocumentSource = 'draft') {
    this.readOnly = false
    this.base = source === 'project' ? '/api/projects' : '/api/drafts'
  }

  async loadDocument(documentId: string): Promise<DirectorDocument> {
    const doc = (await fetchJson(`${this.base}/${documentId}`)) as DirectorDocument
    if (doc.type !== 'biz/scene3d-director-document') throw new Error(`未知草稿类型: ${doc.type}`)
    return doc
  }

  saveDocument?: (documentId: string, doc: DirectorDocument) => Promise<void> = async (documentId, doc) => {
    const res = await fetch(`${this.base}/${documentId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) })
    if (!res.ok) throw new Error(`保存失败: HTTP ${res.status}`)
  }

  saveFCurves?: (documentId: string, data: unknown) => Promise<void> = async (documentId, data) => {
    const res = await fetch(`${this.base}/${documentId}/fcurves`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    if (!res.ok) throw new Error(`关键帧保存失败: HTTP ${res.status}`)
  }

  async loadFCurves(documentId: string): Promise<unknown | null> {
    try { return await fetchJson(`${this.base}/${documentId}/fcurves`) } catch { return null }
  }

  resolveAssetUrl(key: string): string {
    const trimmed = key.trim()
    if (trimmed.startsWith(`${LOCAL_ASSET_ROUTE}/`)) return trimmed
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    const normalized = normalizeAssetKey(trimmed)
    if (!normalized) throw new Error('素材 key 为空')
    return keyUrl(normalized)
  }

  resolveMediaUrl(ref: MediaRef): string {
    // character 的 sourcePath 是 'user' / 'base' 这类枚举，不是路径。
    const raw = (ref.sourceUrl || (ref.kind === 'character' ? '' : ref.sourcePath) || '').trim()
    if (!raw) throw new Error(`unable to resolve media ref kind=${ref.kind}`)
    return this.resolveAssetUrl(raw)
  }

  async searchAssets(query: AssetQuery): Promise<AssetPage<CharacterLibEntry | PropLibEntry | MotionLibEntry | PoseLibEntry>> {
    const empty = { items: [], total: 0, pageNo: query.pageNo, pageSize: query.pageSize }
    // 本地素材清单没有动作（motion）类型；返回空列表，面板显示「未安装动作」。
    if (query.kind === 'motion') return empty
    const params = new URLSearchParams({ kind: query.kind, pageNo: String(query.pageNo), pageSize: String(query.pageSize) })
    if (query.keyword) params.set('keyword', query.keyword)
    if (query.category) params.set('category', query.category)
    query.tags?.forEach((tag) => params.append('tags', tag))
    try {
      return (await fetchJsonOnce(`${LOCAL_ASSET_ROUTE}/search?${params}`)) as AssetPage<CharacterLibEntry | PropLibEntry | PoseLibEntry>
    } catch (error) {
      console.warn('[studio] local asset search failed', error)
      return empty
    }
  }

  async loadPoseById(poseId: string): Promise<PoseBonesPayload | null> {
    // 内置预设（如 stand）不在素材清单里，查不到就交回 builder 用自带数据。
    const page = await this.searchAssets({ kind: 'pose', pageNo: 1, pageSize: 500 })
    const shortId = poseId.startsWith('a3d_pose_') ? poseId.slice('a3d_pose_'.length) : poseId
    const entry = (page.items as PoseLibEntry[]).find((item) => item.id === shortId)
    return entry?.modelUrl ? this.loadPoseAsset(entry.modelUrl) : null
  }

  async loadPoseAsset(modelUrl: string): Promise<PoseBonesPayload | null> {
    let payload: unknown
    try {
      payload = await fetchPoseJson(this.resolveAssetUrl(modelUrl))
    } catch {
      return null
    }
    if (!isRecord(payload) || !Array.isArray(payload.hips) || !isRecord(payload.bones)) return null
    const hips = payload.hips
    if (hips.length !== 3 || hips.some((value) => typeof value !== 'number')) return null
    return {
      poseId: readString(payload.pose_id) ?? undefined,
      hips: [hips[0], hips[1], hips[2]],
      bones: payload.bones as PoseBonesPayload['bones'],
    }
  }

  topviewCanvasLoginUrl = (): string => '/api/topview-canvas/login'

  async listTopviewCanvases(): Promise<TopviewCanvasSummary[]> {
    const body = await canvasJson('/api/topview-canvas/canvases')
    const rows = isRecord(body) && Array.isArray(body.canvases) ? body.canvases : []
    return rows.flatMap((row) => {
      if (!isRecord(row) || typeof row.id !== 'string') return []
      return [{ id: row.id, name: typeof row.name === 'string' ? row.name : row.id }]
    })
  }

  async createTopviewCanvas(name: string): Promise<TopviewCanvasSummary> {
    const body = await canvasJson('/api/topview-canvas/canvases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const canvas = isRecord(body) ? body.canvas : null
    if (!isRecord(canvas) || typeof canvas.id !== 'string') throw new Error('新建 Canvas 失败')
    return { id: canvas.id, name: typeof canvas.name === 'string' ? canvas.name : name }
  }

  async uploadToTopviewCanvas(canvasId: string, blob: Blob, meta: ExportMeta): Promise<void> {
    const form = new FormData()
    form.set('canvasId', canvasId)
    form.set('file', new File([blob], meta.filename, { type: meta.mimeType }))
    await canvasJson('/api/topview-canvas/upload', { method: 'POST', body: form })
  }

  async listAssetFacets(kind: AssetQuery['kind']): Promise<AssetFacets> {
    if (kind === 'motion') return { categories: [], tags: [] }
    try {
      return (await fetchJsonOnce(`${LOCAL_ASSET_ROUTE}/facets?kind=${encodeURIComponent(kind)}`)) as AssetFacets
    } catch (error) {
      console.warn('[studio] local asset facets failed', error)
      return { categories: [], tags: [] }
    }
  }
}
