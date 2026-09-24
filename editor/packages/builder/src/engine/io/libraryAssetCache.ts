import type * as THREE from 'three'

import { LIBRARY_ASSET_PREFIX } from '../../contract/assetKeyPrefixes'
import { releaseTemplateShared } from '../objects/templateShared'

const MAX_LIBRARY_TEMPLATES = 48

/** three 的 GPU 资源必须显式释放，仅从 Map 里移除引用不会回收显存。 */
export function disposeTemplateResources(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    mesh.geometry?.dispose?.()
    const material = mesh.material
    if (!material) return
    for (const item of Array.isArray(material) ? material : [material]) {
      const std = item as THREE.MeshStandardMaterial
      std.map?.dispose?.()
      std.dispose?.()
    }
  })
}

class LruMap<T> {
  private readonly map = new Map<string, T>()

  constructor(
    private readonly max: number,
    private readonly onEvict?: (value: T) => void,
  ) {}

  get(key: string): T | undefined {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: string, value: T): void {
    const previous = this.map.get(key)
    if (previous !== undefined) {
      this.map.delete(key)
      // 同一 URL 并发加载（同草稿放两个相同道具）会各下一份再先后写入，
      // 被覆盖的那份同样要走淘汰回收，否则它带着 templateShared 标记永远没人释放。
      if (previous !== value) this.onEvict?.(previous)
    }
    this.map.set(key, value)
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      const evicted = this.map.get(oldest)
      this.map.delete(oldest)
      // 不在此处 dispose：被淘汰的模板可能仍被活跃场景里的 clone 共享几何体。
      // 改为交回给场景销毁流程回收，见 releaseTemplateShared。
      if (evicted !== undefined) this.onEvict?.(evicted)
    }
  }
}

const libraryCharacters = new LruMap<THREE.Object3D>(MAX_LIBRARY_TEMPLATES, releaseTemplateShared)
const libraryProps = new LruMap<THREE.Object3D>(MAX_LIBRARY_TEMPLATES, releaseTemplateShared)

/**
 * 从资源 URL 或裸 key 还原官方素材库的 S3 key；用户私有素材返回 null，由调用方退回实例缓存。
 *
 * 后端 `CloudFrontService.generateSignedUrl` 用 `URLEncoder.encode(key)` 拼签名 URL，斜杠会被
 * 编码成 `%2F`（`https://cdn/3d-builder%2Flibrary%2Fprops%2Fx.glb?Signature=...`），所以
 * decodeURIComponent 这步是必需的，不只是容错。
 */
export function libraryAssetCacheKey(urlOrKey: string): string | null {
  const trimmed = urlOrKey.trim()
  if (!trimmed) return null
  let path = trimmed
  try {
    if (/^https?:\/\//i.test(trimmed)) path = new URL(trimmed).pathname
  } catch {
    path = trimmed.split('?')[0] ?? trimmed
  }
  // 用户上传的文件名可能带裸 %，decodeURIComponent 会抛；这条路径挡在每次模型加载前，不能崩。
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    decoded = path
  }
  const normalized = decoded.replace(/^\/+/, '').split('?')[0] ?? ''
  return normalized.startsWith(LIBRARY_ASSET_PREFIX) ? normalized : null
}

export function instanceCacheKey(url: string): string {
  return url.split('?')[0] ?? url
}

export function lookupLibraryCharacter(url: string): THREE.Object3D | undefined {
  const key = libraryAssetCacheKey(url)
  return key ? libraryCharacters.get(key) : undefined
}

export function storeLibraryCharacter(url: string, scene: THREE.Object3D): boolean {
  const key = libraryAssetCacheKey(url)
  if (!key) return false
  libraryCharacters.set(key, scene)
  return true
}

export function lookupLibraryProp(url: string): THREE.Object3D | undefined {
  const key = libraryAssetCacheKey(url)
  return key ? libraryProps.get(key) : undefined
}

export function storeLibraryProp(url: string, scene: THREE.Object3D): boolean {
  const key = libraryAssetCacheKey(url)
  if (!key) return false
  libraryProps.set(key, scene)
  return true
}
