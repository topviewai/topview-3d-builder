const LIBRARY_PREFIX = '3d-builder/library/'
const PUBLIC_PREFIX = '3d-builder/public/'

// Resolution order: local asset map (key -> same-origin URL served by the renderer),
// then an explicitly configured public asset base. There is no default CDN, so
// offline renders never leave the machine.
export function resolveHeadlessMediaUrl(ref, publicAssetBase, localAssets = {}) {
  if (typeof ref === 'string') {
    if (/^https?:\/\//i.test(ref)) return ref
    return resolveAssetKey(ref, publicAssetBase, localAssets, undefined)
  }
  const kind = ref?.kind
  const sourcePath = typeof ref?.sourcePath === 'string' ? ref.sourcePath : ''
  if (kind === 'character' && sourcePath === 'user' && ref?.assetId) {
    const local = localAssets?.[`user:${ref.assetId}`]
    if (local) return local
    const origin = String(publicAssetBase || '')
      .replace(/\/+$/, '')
      .replace(/\/3d-builder\/public$/i, '')
    if (origin) return `${origin}/3d-builder/public/characters/user_child_${ref.assetId}.glb`
    throw new Error(`ASSET_NOT_AVAILABLE:user:${ref.assetId}`)
  }
  const raw = String(ref?.sourceUrl || ref?.sourcePath || '').trim()
  if (/^https?:\/\//i.test(raw)) return raw
  return resolveAssetKey(raw, publicAssetBase, localAssets, kind)
}

export function assetKey(raw) {
  return String(raw || '').replace(/^\/+/, '').split('?')[0]
}

function resolveAssetKey(raw, publicAssetBase, localAssets, kind) {
  const key = assetKey(raw)
  if (!key) return ''
  const local = localAssets?.[key]
  if (local) return local
  const origin = String(publicAssetBase || '')
    .replace(/\/+$/, '')
    .replace(/\/3d-builder\/public$/i, '')
  if (origin && key.startsWith(PUBLIC_PREFIX)) return `${origin}/${key}`
  // Motions are optional: an unavailable clip leaves the character in its pose.
  if (kind === 'motion') return ''
  if (key.startsWith(LIBRARY_PREFIX) || key.startsWith(PUBLIC_PREFIX)) {
    throw new Error(`ASSET_NOT_AVAILABLE:${key}`)
  }
  return ''
}
