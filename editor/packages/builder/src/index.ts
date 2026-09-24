export { DirectorStudio, StudioBootOverlay, DEFAULT_AUTO_SAVE_INTERVAL_MS } from './DirectorStudio'
export type { DirectorStudioProps, StudioBootOverlayProps, DirectorApi, StudioCloseHandler } from './DirectorStudio'
export { DEFAULT_LOCALE, listLocales, resolveLocale } from './locale'

export type {
  HostAdapter,
  ExportMeta,
  CharacterLibEntry,
  PropLibEntry,
  MotionLibEntry,
  PoseLibEntry,
  PoseBonesPayload,
  AssetQuery,
  AssetPage,
  AssetFacet,
  AssetFacets,
  ResolvedUrl,
} from './host/types'

// 新建文档不是包的功能：宿主用它造一份空文档，自己决定存到哪，再以新 id 挂载。
// 默认场景（相机 + 原点默认角色）仍由包定义，宿主新建时调 createInitialDraft。
export { makeEmptyDraft } from './contract/emptyDraft'
export type { EmptyDraftCamera } from './contract/emptyDraft'
export { DEFAULT_SKY_COLOR } from './contract/skyColor'
export {
  createInitialDraft,
  pickDefaultCharacter,
  seedDefaultCharacterInPlace,
} from './evaluate/initialDraft'
export type { InitialDraftInput } from './evaluate/initialDraft'
export { DEFAULT_CHARACTER, INITIAL_DRAFT_SEED } from './data/defaultCharacter'
export type { DefaultCharacterPreset } from './data/defaultCharacter'

// 可选 helper：素材 key 约定的参考实现，宿主可不用（见 architecture.md §3.5）。
export {
  isResolvableAssetKey,
  normalizeAssetKey,
  assetBasename,
  resolveMediaKey,
} from './host/assetKeys'
export { LIBRARY_ASSET_PREFIX } from './contract/assetKeyPrefixes'

// 导演台领域数据：宿主造空草稿时选初始机位用
export { CAMERA_PRESETS } from './data/cameraLibrary'
export type { CameraPreset } from './data/cameraLibrary'

export type {
  DirectorDocument,
  MediaRef,
  EditorialData,
  EditSequence,
  EditSequenceClip,
} from './contract/types'
