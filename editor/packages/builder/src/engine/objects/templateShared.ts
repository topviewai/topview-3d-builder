import type * as THREE from 'three'

/**
 * 归缓存模板所有的 GPU 资源，dispose 场景时必须跳过。
 *
 * 记的是 geometry / material / 贴图本身而不是节点：skeletonClone 出来的实例共享这些资源，
 * 但 CharacterObject / PropObject 随后只给 `isMesh` 的节点换上每实例新材质，
 * Line / Points 这类节点仍指向模板材质。按节点记会把两者混为一谈——
 * 要么泄漏每实例材质，要么把还要复用的模板材质 dispose 掉。
 *
 * 用 WeakSet 而不是 userData：`Material.clone()` 会连 userData 一起深拷贝，
 * 克隆出的每实例材质会继承标记，反而永远不被释放。
 */
const templateOwned = new WeakSet<object>()

function eachTemplateResource(root: THREE.Object3D, visit: (resource: object) => void): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) visit(mesh.geometry)
    const material = mesh.material
    if (!material) return
    for (const item of Array.isArray(material) ? material : [material]) {
      visit(item)
      const std = item as THREE.MeshStandardMaterial
      if (std.map) visit(std.map)
    }
  })
}

export function markTemplateShared(root: THREE.Object3D): void {
  eachTemplateResource(root, (resource) => templateOwned.add(resource))
}

/**
 * 模板被缓存淘汰后调用：此后没有任何缓存持有它，继续保留标记会让 disposeSceneChildren
 * 永远跳过这批资源，GPU 显存要等 context lost 才回收。解除标记后，仍在场景里的 clone
 * 会在下一次 disposeSceneChildren 时把它们一并释放。
 */
export function releaseTemplateShared(root: THREE.Object3D): void {
  eachTemplateResource(root, (resource) => templateOwned.delete(resource))
}

export function isTemplateShared(resource: object | null | undefined): boolean {
  return Boolean(resource && templateOwned.has(resource))
}
