import { LIBRARY_ASSET_PREFIX } from '../contract/assetKeyPrefixes'

export function normalizeAssetKey(value: string): string {
  const noQuery = value.trim().split('?')[0] ?? ''
  return noQuery.replace(/^\/+/, '')
}

export function assetBasename(value: string): string {
  const key = normalizeAssetKey(value)
  return key.slice(key.lastIndexOf('/') + 1)
}

/**
 * 宿主能解析的素材 key 命名空间。
 *
 * 官方素材库（`3d-builder/library/`）与用户素材（`canvas/`、`3d-builder/user/`）都在加密桶，
 * 一律由宿主签名后才能取到 URL；包内没有兜底的公共 CDN 规则。
 */
export function isResolvableAssetKey(key: string): boolean {
  const normalized = normalizeAssetKey(key)
  return normalized.startsWith('canvas/')
    || normalized.startsWith('3d-builder/user/')
    || normalized.startsWith(LIBRARY_ASSET_PREFIX)
}

/**
 * 把 MediaRef 收成可交给 resolveAssetUrl 的 S3 key。
 *
 * 必须已是 `3d-builder/library/` 或用户私有 key（`canvas/` / `3d-builder/user/`）。
 * 不把 http(s)、`motions/sources/`、裸文件名猜成 key。
 */
export function resolveMediaKey(ref: {
  kind: 'character' | 'prop' | 'motion'
  assetId?: string
  sourceUrl?: string
  sourcePath?: string
}): string {
  // character 的 sourcePath 来自 metadata.assetSource，是 'user' / 'base' 这类枚举而非路径
  // （见 engine/io/mediaRefs.ts:characterMediaRef），拿它兜底只会把枚举值当 key 报错。
  const fallbackPath = ref.kind === 'character' ? '' : ref.sourcePath
  const raw = (ref.sourceUrl || fallbackPath || '').trim()
  if (!raw) return ''

  // 上游素材接口可能已经返回签名后的完整 URL；这类引用无需再按 S3 key 解析。
  if (/^https?:\/\//i.test(raw)) return raw

  const key = normalizeAssetKey(raw)
  if (isResolvableAssetKey(key)) return key

  throw new Error(
    `媒体引用必须是 ${LIBRARY_ASSET_PREFIX} 或用户私有 S3 key，收到: ${raw.slice(0, 160)}`,
  )
}
