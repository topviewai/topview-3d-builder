import * as THREE from 'three'
import type { DraftNode } from '../../contract/types'
import { applyTransform } from './transform'
import type { StageGraph } from './graph'

const GEOMETRY_CTORS: Record<string, unknown> = {
  BoxGeometry: THREE.BoxGeometry,
  CylinderGeometry: THREE.CylinderGeometry,
  ConeGeometry: THREE.ConeGeometry,
  SphereGeometry: THREE.SphereGeometry,
  PlaneGeometry: THREE.PlaneGeometry,
}

const GEOMETRY_ARGS: Record<string, string[]> = {
  BoxGeometry: ['width', 'height', 'depth', 'widthSegments', 'heightSegments', 'depthSegments'],
  CylinderGeometry: [
    'radiusTop',
    'radiusBottom',
    'height',
    'radialSegments',
    'heightSegments',
    'openEnded',
    'thetaStart',
    'thetaLength',
  ],
  ConeGeometry: ['radius', 'height', 'radialSegments', 'heightSegments', 'openEnded', 'thetaStart', 'thetaLength'],
  SphereGeometry: ['radius', 'widthSegments', 'heightSegments'],
  PlaneGeometry: ['width', 'height', 'widthSegments', 'heightSegments'],
}

export function buildPrimitiveGeometry(kind: string, params: Record<string, unknown>): THREE.BufferGeometry {
  const order = GEOMETRY_ARGS[kind]
  const Ctor = GEOMETRY_CTORS[kind]
  if (!order || typeof Ctor !== 'function') {
    console.warn(`[Stage] 未知 primitive kind: ${kind}，用 BoxGeometry 兜底`)
    const width = typeof params.width === 'number' ? params.width : 1
    const height = typeof params.height === 'number' ? params.height : 1
    const depth = typeof params.depth === 'number' ? params.depth : 1
    return new THREE.BoxGeometry(width, height, depth)
  }
  const Geometry = Ctor as new (...args: never[]) => THREE.BufferGeometry
  return new Geometry(...(order.map((key) => params[key]) as never[]))
}

export function buildPrimitiveInstance(graph: StageGraph, n: DraftNode): void {
  const parentGroup = n.parentId ? graph.groups.get(n.parentId) : undefined
  const parentNode = n.parentId ? graph.nodeById.get(n.parentId) : undefined
  const colorHex =
    n.primitive?.appearance?.color ??
    parentNode?.group?.appearance.color ??
    '#cccccc'
  const color = new THREE.Color(colorHex)
  const mesh = new THREE.Mesh(
    buildPrimitiveGeometry(n.primitive?.kind ?? 'BoxGeometry', n.primitive?.parameters ?? {}),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 }),
  )
  mesh.name = n.id
  mesh.userData.t3dTint = true
  applyTransform(mesh, n.transform)
  mesh.visible = n.visible
  ;(parentGroup ?? graph.scene).add(mesh)
  graph.primitives.set(n.id, mesh)
}
