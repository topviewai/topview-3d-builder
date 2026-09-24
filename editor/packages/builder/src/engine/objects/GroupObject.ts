import * as THREE from 'three'
import type { DraftNode } from '../../contract/types'
import { EDITOR_LAYER } from '../core/Layers'
import { applyTransform } from './transform'
import { makeLabel } from './labels'
import type { StageGraph } from './graph'

export function buildGroupInstance(graph: StageGraph, n: DraftNode): void {
  const g = new THREE.Group()
  g.name = n.id
  applyTransform(g, n.transform)
  graph.scene.add(g)
  graph.groups.set(n.id, g)
}

export function attachGroupLabel(graph: StageGraph, n: DraftNode): void {
  const labelCfg = n.group?.label
  if (!labelCfg?.showLabel) return
  const g = graph.groups.get(n.id)
  if (!g) return
  const box = new THREE.Box3().setFromObject(g)
  if (box.isEmpty()) return
  const sprite = makeLabel(n.name, n.group?.appearance.color ?? '#ffffff', labelCfg.scale || 1)
  sprite.userData.t3dOwnerNodeId = n.id
  sprite.position.set(
    (box.min.x + box.max.x) / 2,
    box.max.y + 0.18 + (labelCfg.yOffset ?? 0),
    (box.min.z + box.max.z) / 2,
  )
  sprite.layers.set(EDITOR_LAYER)
  sprite.traverse((o) => o.layers.set(EDITOR_LAYER))
  graph.scene.add(sprite)
}
