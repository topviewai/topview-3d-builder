import * as THREE from 'three'
import type { DraftNode } from '../../contract/types'
import { propMediaRef, resolvedMediaUrl } from '../io/mediaRefs'
import type { AssetLoader } from '../io/AssetLoader'
import { buildCameraInstance } from './CameraObject'
import { buildCharacterInstance } from './CharacterObject'
import { buildPrimitiveInstance } from './PrimitiveObject'
import { attachProp } from './PropObject'
import { buildPathInstance, removePathNode, type PathViewHost } from './PathObject'
import type { StageGraph } from './graph'

function disposeOwnedObject(root: THREE.Object3D, disposeGeometry: boolean): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (disposeGeometry && mesh.geometry) geometries.add(mesh.geometry)
    const raw = mesh.material
    if (!raw) return
    const list = Array.isArray(raw) ? raw : [raw]
    for (const material of list) {
      if (object.userData.t3dLabel) {
        const map = (material as THREE.SpriteMaterial).map
        map?.dispose()
      }
      materials.add(material)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}

export function hasNode(graph: StageGraph, nodeId: string): boolean {
  return (
    graph.nodeById.has(nodeId) ||
    graph.cameras.has(nodeId) ||
    graph.characters.has(nodeId) ||
    graph.props.has(nodeId) ||
    graph.primitives.has(nodeId) ||
    graph.pathNodes.has(nodeId)
  )
}

export function removeNode(graph: StageGraph, nodeId: string): void {
  graph.nodeById.delete(nodeId)
  const cam = graph.cameras.get(nodeId)
  if (cam) {
    graph.scene.remove(cam.gizmo.group)
    disposeOwnedObject(cam.gizmo.group, true)
    graph.cameras.delete(nodeId)
  }
  const character = graph.characters.get(nodeId)
  if (character) {
    graph.scene.remove(character.root)
    // skeletonClone 仍共享模板 geometry / 贴图；实例只拥有克隆材质与标签贴图。
    disposeOwnedObject(character.root, false)
    graph.characters.delete(nodeId)
  }
  const prop = graph.props.get(nodeId)
  if (prop) {
    graph.scene.remove(prop)
    // 道具 geometry / 贴图来自 AssetLoader 模板，只有 attachProp 克隆的材质归实例所有。
    disposeOwnedObject(prop, false)
    graph.props.delete(nodeId)
  }
  const prim = graph.primitives.get(nodeId)
  if (prim) {
    prim.removeFromParent()
    disposeOwnedObject(prim, true)
    graph.primitives.delete(nodeId)
  }
  const group = graph.groups.get(nodeId)
  if (group) {
    group.removeFromParent()
    graph.groups.delete(nodeId)
  }
  const groupLabels: THREE.Object3D[] = []
  graph.scene.traverse((object) => {
    if (object.userData.t3dOwnerNodeId === nodeId) groupLabels.push(object)
  })
  for (const label of groupLabels) {
    label.removeFromParent()
    disposeOwnedObject(label, false)
  }
  if ('pathViews' in graph) removePathNode(graph as PathViewHost, nodeId)
  else graph.pathNodes.delete(nodeId)
  graph.snapshot.delete(nodeId)
  graph.invalidate()
}

export async function addRuntimeNode(
  graph: StageGraph,
  loader: AssetLoader,
  node: DraftNode,
): Promise<boolean> {
  if (hasNode(graph, node.id)) return true
  if (node.type === 'camera') {
    graph.nodeById.set(node.id, node)
    buildCameraInstance(graph, node)
    return true
  }
  if (node.type === 'character') return addCharacterNode(graph, loader, node)
  if (node.type === 'primitive') {
    graph.nodeById.set(node.id, node)
    buildPrimitiveInstance(graph, node)
    return true
  }
  if (node.type === 'prop') {
    const ref = propMediaRef(node)
    if (!ref) return false
    const url = await resolvedMediaUrl(graph.resolveMediaUrl, ref)
    return addPropFromUrl(graph, loader, node, url)
  }
  if (node.type === 'path') {
    buildPathInstance(graph as PathViewHost, node)
    return true
  }
  graph.nodeById.set(node.id, node)
  return true
}

async function addCharacterNode(graph: StageGraph, loader: AssetLoader, n: DraftNode): Promise<boolean> {
  if (!graph.doc) return false
  const url = await loader.characterUrl(n)
  let template = loader.lookupCharacterTemplate(url)
  if (!template) {
    try {
      template = await loader.loadCharacterTemplate(url)
      const mixamorigTpl = loader.mixamorigTemplate()
      if (mixamorigTpl) graph.motionPlayer.setMixamorigTemplate(mixamorigTpl)
    } catch (e) {
      console.warn(`[Stage] 角色模型加载失败 ${url}`, e)
      return false
    }
  }
  graph.nodeById.set(n.id, n)
  buildCharacterInstance(
    graph,
    n,
    template,
    graph.doc.content.environment.display?.characterLabelsVisible !== false,
  )
  return true
}

async function addPropFromUrl(
  graph: StageGraph,
  loader: AssetLoader,
  n: DraftNode,
  url: string,
): Promise<boolean> {
  if (!graph.doc) return false
  try {
    attachProp(graph, n, await loader.loadPropTemplate(url))
    return true
  } catch (e) {
    console.warn(`[Stage] 道具加载失败 ${url}`, e)
    return false
  }
}
