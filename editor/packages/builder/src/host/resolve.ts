// 资源解析入口。
//
// 素材一律在加密桶（官方库 `3d-builder/library/`、用户素材 `canvas/` 与 `3d-builder/user/`），
// 取 URL 必须由宿主签名，所以包内没有兜底规则：宿主必须实现 resolveAssetUrl 或 resolveMediaUrl。
import type { HostAdapter, MediaRef, ResolvedUrl } from './types'
import { normalizeAssetKey, resolveMediaKey } from './assetKeys'

export function isHttpAssetUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

export function resolveAssetUrl(adapter: HostAdapter<unknown>, key: string): ResolvedUrl {
  const trimmed = key.trim()
  if (isHttpAssetUrl(trimmed)) return trimmed
  if (adapter.resolveAssetUrl) return adapter.resolveAssetUrl(trimmed)

  throw new Error(
    `素材 key 需要宿主签名，请实现 adapter.resolveAssetUrl：${normalizeAssetKey(trimmed)}`,
  )
}

export function resolveMediaUrl(adapter: HostAdapter<unknown>, ref: MediaRef): ResolvedUrl {
  if (adapter.resolveMediaUrl) return adapter.resolveMediaUrl(ref)

  const key = resolveMediaKey(ref)
  if (!key) throw new Error(`无法解析媒体引用：kind=${ref.kind}`)
  return resolveAssetUrl(adapter, key)
}
