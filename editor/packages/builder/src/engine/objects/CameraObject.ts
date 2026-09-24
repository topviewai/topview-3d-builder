import * as THREE from 'three'
import { parseAspectRatio } from '../../contract/aspectRatio'
import type { DraftNode } from '../../contract/types'
import { EDITOR_LAYER, GRID_LAYER } from '../core/Layers'
import { CameraGizmo } from '../gizmo/CameraGizmo'
import type { StageGraph } from './graph'

export function buildCameraInstance(graph: StageGraph, n: DraftNode): void {
  const c = n.camera!
  const aspect = parseAspectRatio(graph.doc?.content.aspectRatio)
  const cam = new THREE.PerspectiveCamera(c.fov, aspect, c.near, Math.min(c.far, 2000))
  cam.position.set(n.transform.position.x, n.transform.position.y, n.transform.position.z)
  cam.lookAt(c.lookAt.x, c.lookAt.y, c.lookAt.z)
  cam.layers.enable(GRID_LAYER)
  const gizmo = new CameraGizmo()
  gizmo.setAspect(aspect)
  gizmo.setFov(c.fov)
  gizmo.setFov(c.fov)
  gizmo.group.traverse((o) => o.layers.set(EDITOR_LAYER))
  graph.scene.add(gizmo.group)
  graph.cameras.set(n.id, {
    node: n,
    camera: cam,
    gizmo,
    lookAt: new THREE.Vector3(c.lookAt.x, c.lookAt.y, c.lookAt.z),
  })
}
