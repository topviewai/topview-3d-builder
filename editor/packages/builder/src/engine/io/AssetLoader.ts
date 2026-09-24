import * as THREE from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'
import type { DirectorDocument } from '../../contract/types'
import { isCentimeterMixamorig } from '../rig/mixamorigBind'
import {
  characterMediaRef,
  motionMediaRef,
  resolvedMediaUrl,
  type ResolveMediaUrl,
} from './mediaRefs'
import {
  disposeTemplateResources,
  instanceCacheKey,
  lookupLibraryCharacter,
  lookupLibraryProp,
  storeLibraryCharacter,
  storeLibraryProp,
} from './libraryAssetCache'

/**
 * 内置人物 GLB（Child / Youth / Female / Man）带 KHR_draco_mesh_compression。解码器默认从宿主
 * 同源的 `/draco/` 加载（构建产物 `dist/draco/` 即 three r184 自带的解码器），不访问外网。
 * 宿主可用 setDefaultDracoDecoderPath 改到别处。
 */
let defaultDecoderPath = '/draco/'

let sharedDraco: DRACOLoader | null = null

export function setDefaultDracoDecoderPath(path: string): void {
  defaultDecoderPath = normalizeDecoderPath(path)
  sharedDraco?.dispose()
  sharedDraco = null
}

function dracoLoader(): DRACOLoader {
  if (!sharedDraco) {
    sharedDraco = new DRACOLoader()
    sharedDraco.setDecoderPath(defaultDecoderPath)
  }
  return sharedDraco
}

function normalizeDecoderPath(path: string): string {
  return path.endsWith('/') ? path : `${path}/`
}

function createGltfLoader(decoderPath?: string): GLTFLoader {
  const loader = new GLTFLoader()
  if (decoderPath) {
    const draco = new DRACOLoader()
    draco.setDecoderPath(normalizeDecoderPath(decoderPath))
    loader.setDRACOLoader(draco)
    return loader
  }
  loader.setDRACOLoader(dracoLoader())
  return loader
}

export class AssetLoader {
  readonly characterTemplates = new Map<string, THREE.Object3D>()
  readonly propTemplates = new Map<string, THREE.Object3D>()
  /**
   * 本次会话实际用到的角色模板（含共享缓存命中）。共享模板存在跨草稿的模块级缓存里，
   * 若 mixamorigTemplate() 直接遍历那份缓存，别的草稿加载过的骨架会参与 rest 对齐，
   * 让同一份草稿的动作烘焙结果依赖「之前打开过什么」。
   */
  private readonly usedCharacterTemplates = new Set<THREE.Object3D>()
  private readonly gltf: GLTFLoader

  constructor(
    private readonly resolveMediaUrl: ResolveMediaUrl,
    options?: { dracoDecoderPath?: string },
  ) {
    this.gltf = createGltfLoader(options?.dracoDecoderPath)
  }

  async loadGltf(url: string): Promise<THREE.Object3D> {
    const gltf = await this.gltf.loadAsync(url)
    return gltf.scene
  }

  lookupCharacterTemplate(url: string): THREE.Object3D | undefined {
    const found = lookupLibraryCharacter(url) ?? this.characterTemplates.get(instanceCacheKey(url))
    if (found) this.usedCharacterTemplates.add(found)
    return found
  }

  async loadPropTemplate(url: string): Promise<THREE.Object3D> {
    const cached = lookupLibraryProp(url) ?? this.propTemplates.get(instanceCacheKey(url))
    if (cached) return skeletonClone(cached)
    const scene = await this.loadGltf(url)
    if (!storeLibraryProp(url, scene)) this.propTemplates.set(instanceCacheKey(url), scene)
    // 带骨骼的库道具（马、人偶等）必须 SkeletonUtils.clone，普通 clone 会把
    // SkinnedMesh 和 skeleton.bones 拆开，视口里只剩空 gizmo。
    return skeletonClone(scene)
  }

  async loadCharacterTemplate(url: string, onProgress?: (msg: string) => void): Promise<THREE.Object3D> {
    const cached = this.lookupCharacterTemplate(url)
    if (cached) return cached
    onProgress?.(`加载角色模型 ${url.split('/').pop()}…`)
    const scene = await this.loadGltf(url)
    if (!storeLibraryCharacter(url, scene)) this.characterTemplates.set(instanceCacheKey(url), scene)
    this.usedCharacterTemplates.add(scene)
    return scene
  }

  async characterUrl(node: Parameters<typeof characterMediaRef>[0]): Promise<string> {
    return resolvedMediaUrl(this.resolveMediaUrl, characterMediaRef(node))
  }

  /**
   * 找一个 mixamorig 命名的角色模板，供 FBX 动作做 rest 对齐（`buildRetargetContext`
   * 按骨骼名配对，两边命名必须同源）。只读已加载的缓存，找不到时由调用方降级。
   */
  mixamorigTemplate(): THREE.Object3D | undefined {
    let metric: THREE.Object3D | undefined
    for (const template of this.usedCharacterTemplates) {
      let found = false
      template.traverse((o) => {
        if (!found && o.name.toLowerCase().startsWith('mixamorig')) found = true
      })
      if (!found) continue
      // 回退模板优先厘米绑定，避免米制 Child 把官方角色动作烘错。
      if (isCentimeterMixamorig(template)) return template
      metric ??= template
    }
    return metric
  }

  async preloadMotions(
    doc: DirectorDocument,
    loadMotion: (id: string, url: string) => Promise<unknown>,
    onProgress?: (msg: string) => void,
  ): Promise<void> {
    const assetIds = [...new Set(doc.content.timeline.animation.motionClips.map((c) => c.motion.assetId))]
    let done = 0
    await Promise.all(
      assetIds.map(async (id) => {
        // 动作素材可能缺失（离线、未导入）：解析或加载失败只告警，角色停在 rest/姿势，不中断场景加载。
        const ref = motionMediaRef(doc, id)
        let url: string | null = null
        try {
          url = ref ? await resolvedMediaUrl(this.resolveMediaUrl, ref) : null
        } catch (e) {
          console.warn(`[Stage] 动作不可用 ${id}`, e)
          return
        }
        if (!url) {
          console.warn(`[Stage] 动作不可用 ${id}`)
          return
        }
        try {
          await loadMotion(id, url)
        } catch (e) {
          console.warn(`[Stage] 动作加载失败 ${url}`, e)
        }
        done++
        onProgress?.(`加载动作 ${done}/${assetIds.length}…`)
      }),
    )
  }

  /**
   * 实例缓存里只剩私有素材（官方共享素材模板归模块级 LRU 常驻）。它们的 geometry / 贴图被
   * 场景里的 clone 共享，而 clone 带 templateShared 标记会让 disposeSceneChildren 跳过，
   * 所以必须由持有者在这里释放，否则每次 Stage.dispose 泄一份 GPU 资源。
   */
  clear(): void {
    for (const template of [...this.characterTemplates.values(), ...this.propTemplates.values()]) {
      disposeTemplateResources(template)
    }
    this.characterTemplates.clear()
    this.propTemplates.clear()
    // 官方素材库模板归模块级缓存所有，这里只松开本会话的引用，不能 dispose。
    this.usedCharacterTemplates.clear()
  }
}
