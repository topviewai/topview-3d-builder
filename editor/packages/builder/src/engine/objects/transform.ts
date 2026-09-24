import * as THREE from 'three'
import type { Transform } from '../../contract/types'

const D2R = THREE.MathUtils.degToRad

export function applyTransform(obj: THREE.Object3D, t: Transform): void {
  obj.position.set(t.position.x, t.position.y, t.position.z)
  obj.rotation.set(D2R(t.rotation.x), D2R(t.rotation.y), D2R(t.rotation.z))
  obj.scale.set(t.scale.x, t.scale.y, t.scale.z)
}
