import type { MediaRef } from '../contract/types'

export type { MediaRef }

export interface ExportMeta {
  filename: string
  mimeType: string
}

export interface CharacterLibEntry {
  id: string
  name: string
  /** glb 的完整 key */
  file: string
  cover?: string
  /** search/list 已签好的封面 URL；有则卡片直接用，不再单独换签 */
  coverUrl?: string
  /** search/list 已签好的模型 URL；进场景解析 file 时的可选捷径 */
  modelUrl?: string
  description?: string
  category?: string
  /** 库行 extra.rig_type：UAL1 → ual1，缺省 mixamorig */
  rig?: 'ual1' | 'mixamorig'
  /** @deprecated demo 草稿字段；新入口写 `rig` */
  assetSource?: string
}

export interface PropLibEntry {
  id: string
  name: string
  file: string
  cover: string
  coverUrl?: string
  modelUrl?: string
  category?: string
}

export interface MotionLibEntry {
  fbx: string
  name: string
  category: string
  gif: string
  gifUrl?: string
  modelUrl?: string
}

export interface PoseLibEntry {
  id: string
  name: string
  nameZh?: string
  tag?: string
  tags?: string[]
  rank?: number
  cover?: string
  coverUrl?: string
  file?: string
  modelUrl?: string
  hips?: readonly [number, number, number]
  bones?: Record<string, readonly [number, number, number, number]>
}

export interface PoseBonesPayload {
  hips: readonly [number, number, number]
  bones: Record<string, readonly [number, number, number, number]>
  poseId?: string
}

export interface AssetQuery {
  kind: 'character' | 'prop' | 'motion' | 'pose'
  keyword?: string
  category?: string
  tags?: string[]
  pageNo: number
  pageSize: number
}

export interface AssetPage<T> {
  items: T[]
  total: number
  pageNo: number
  pageSize?: number
}

export interface AssetFacet {
  value: string
  count: number
}

export interface AssetFacets {
  categories: AssetFacet[]
  tags: AssetFacet[]
}

export type ResolvedUrl = Promise<string> | string

export interface HostAdapter<TDocument = unknown> {
  /** Host-owned onboarding preferences; omit to keep the hint session-only. */
  getNavigationHintDismissed?(): boolean
  dismissNavigationHint?(): void
  // —— 文档：只有单数。列表 / 新建 / 删除属集合操作，归宿主，包不感知 ——
  loadDocument(documentId: string): Promise<TDocument>
  loadFCurves?(documentId: string): Promise<unknown | null>
  /** 不实现即只读宿主，包相应禁用保存入口而不是报错 */
  saveDocument?(documentId: string, doc: TDocument): Promise<void>
  /** 用户关键帧与文档分开存，与 loadFCurves 对称 */
  saveFCurves?(documentId: string, data: unknown): Promise<void>
  /**
   * 原子保存文档与用户关键帧。宿主同时实现本方法和上面两个拆分方法时，包优先调用本方法，
   * 避免同一 revision 被拆成两次网络写入。
   */
  saveDocumentState?(documentId: string, doc: TDocument, fcurves: unknown): Promise<void>
  /** 保存文档封面。宿主不实现即不产出，包内不做本地下载 */
  saveThumbnail?(documentId: string, blob: Blob): Promise<void>

  // —— 资源解析 ——
  /** 素材一律需签名，宿主必须实现它（包内无兜底规则） */
  resolveAssetUrl?(key: string): ResolvedUrl
  /** 按 MediaRef 整段覆盖解析；省略则走 resolveMediaKey + resolveAssetUrl */
  resolveMediaUrl?(ref: MediaRef): ResolvedUrl

  // —— 素材库：宿主提供服务端分页检索，包内不拉 catalog ——
  searchAssets(query: AssetQuery): Promise<AssetPage<CharacterLibEntry | PropLibEntry | MotionLibEntry | PoseLibEntry>>
  listAssetFacets(kind: AssetQuery['kind']): Promise<AssetFacets>
  /** 按需拉一条姿势 JSON。包内不 fetch。 */
  loadPoseAsset?(modelUrl: string): Promise<PoseBonesPayload | null>
  /** 目录未加载时，按 pose id 取 `a3d_pose_<id>` 再拉 JSON。 */
  loadPoseById?(poseId: string): Promise<PoseBonesPayload | null>

  onExport?(blob: Blob, meta: ExportMeta): Promise<void>
  /** 文档或用户关键帧变更后通知宿主；节流由宿主自己做。交互拖拽中不会触发。 */
  onDocumentChange?(documentId: string, doc: TDocument, fcurves: unknown): void
}
