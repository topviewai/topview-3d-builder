import * as THREE from 'three'
import type { DraftNode } from '../../contract/types'
import { applyTransform } from './transform'
import type { StageGraph } from './graph'
import { markTemplateShared } from './templateShared'

export function attachProp(graph: StageGraph, n: DraftNode, sceneRoot: THREE.Object3D): void {
  const root = new THREE.Group()
  root.name = n.id
  root.add(sceneRoot)
  markTemplateShared(sceneRoot)
  const colorHex = n.prop?.appearance?.color ?? '#cccccc'
  const color = new THREE.Color(colorHex)
  sceneRoot.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const tinted = list.map((mat) => {
      const cloned = (mat as THREE.Material).clone()
      const std = cloned as THREE.MeshStandardMaterial
      if (std.color) std.color.copy(color)
      return cloned
    })
    // Three 只在 geometry.groups 非空时遍历 material[]；单材质却写成数组
    // 会被直接跳过，库道具看起来「加进去了」但视口是空的。
    mesh.material = tinted.length === 1 ? tinted[0] : tinted
    mesh.userData.t3dTint = true
    mesh.frustumCulled = false
  })
  applyTransform(root, n.transform)
  graph.scene.add(root)
  graph.nodeById.set(n.id, n)
  graph.props.set(n.id, root)
}
