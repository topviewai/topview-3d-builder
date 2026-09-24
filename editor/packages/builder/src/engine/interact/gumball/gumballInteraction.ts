import * as THREE from 'three'
import { GumballHandleType, type GumballAxis, type GumballHandleUserData } from './buildGumball'

export { pickHandle } from './buildGumball'

export interface GumballDragSession {
  handle: GumballHandleUserData
  startPosition: THREE.Vector3
  startScale: THREE.Vector3
  startQuaternion: THREE.Quaternion
  origin: THREE.Vector3
  axisDir?: THREE.Vector3
  startScalar?: number
  planeNormal?: THREE.Vector3
  startHit?: THREE.Vector3
  rotateAxis?: THREE.Vector3
  basisU?: THREE.Vector3
  basisV?: THREE.Vector3
  startAngle?: number
}

const EPS = 1e-6

function uniformScaleAxisDir(): THREE.Vector3 {
  return new THREE.Vector3(-1, -1, -1).normalize()
}

function axisUnit(axis: 'x' | 'y' | 'z'): THREE.Vector3 {
  if (axis === 'x') return new THREE.Vector3(1, 0, 0)
  if (axis === 'y') return new THREE.Vector3(0, 1, 0)
  return new THREE.Vector3(0, 0, 1)
}

function scaleProjectionWeights(
  quaternion: THREE.Quaternion,
  worldAxis: 'x' | 'y' | 'z',
): { x: number; y: number; z: number } {
  const worldDir = axisUnit(worldAxis)
  const localX = axisUnit('x').applyQuaternion(quaternion)
  const localY = axisUnit('y').applyQuaternion(quaternion)
  const localZ = axisUnit('z').applyQuaternion(quaternion)
  return {
    x: Math.abs(worldDir.dot(localX)),
    y: Math.abs(worldDir.dot(localY)),
    z: Math.abs(worldDir.dot(localZ)),
  }
}

function planeBasis(axis: GumballAxis): { normal: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 } {
  if (axis === 'xy') {
    return { normal: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0) }
  }
  if (axis === 'yz') {
    return { normal: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 1, 0), v: new THREE.Vector3(0, 0, 1) }
  }
  return { normal: new THREE.Vector3(0, 1, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1) }
}

function rotateBasis(axis: 'x' | 'y' | 'z'): { normal: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 } {
  if (axis === 'z') {
    return { normal: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0) }
  }
  if (axis === 'y') {
    return { normal: new THREE.Vector3(0, 1, 0), u: new THREE.Vector3(0, 0, 1), v: new THREE.Vector3(1, 0, 0) }
  }
  return { normal: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 1, 0), v: new THREE.Vector3(0, 0, 1) }
}

function closestAxisParam(ray: THREE.Ray, origin: THREE.Vector3, dir: THREE.Vector3): number {
  const w0 = ray.origin.clone().sub(origin)
  const b = ray.direction.dot(dir)
  const d0 = ray.direction.dot(w0)
  const e = dir.dot(w0)
  const denom = 1 - b * b
  if (Math.abs(denom) < EPS) return e
  return (e - b * d0) / denom
}

function intersectPlane(ray: THREE.Ray, origin: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 | null {
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin)
  const hit = new THREE.Vector3()
  if (!ray.intersectPlane(plane, hit)) return null
  return hit
}

export function createRaycaster(ndc: THREE.Vector2, camera: THREE.Camera): THREE.Raycaster {
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(ndc, camera)
  return raycaster
}

export function beginDrag(
  handle: GumballHandleUserData,
  mesh: THREE.Object3D,
  raycaster: THREE.Raycaster,
  pivot?: THREE.Vector3,
): GumballDragSession | null {
  const origin = pivot != null ? pivot.clone() : mesh.getWorldPosition(new THREE.Vector3())
  const session: GumballDragSession = {
    handle,
    startPosition: mesh.position.clone(),
    startScale: mesh.scale.clone(),
    startQuaternion: mesh.quaternion.clone(),
    origin,
  }

  if (handle.handleType === GumballHandleType.TRANSLATE || handle.handleType === GumballHandleType.SCALE) {
    let dir: THREE.Vector3
    if (handle.handleType === GumballHandleType.SCALE && handle.axis === 'uniform') {
      dir = uniformScaleAxisDir()
    } else {
      dir = axisUnit(handle.axis as 'x' | 'y' | 'z')
      if (handle.handleType === GumballHandleType.SCALE) dir.negate()
    }
    session.axisDir = dir
    session.startScalar = closestAxisParam(raycaster.ray, origin, dir)
    return session
  }

  if (handle.handleType === GumballHandleType.PLANE) {
    const { normal } = planeBasis(handle.axis)
    const hit = intersectPlane(raycaster.ray, origin, normal)
    if (!hit) return null
    session.planeNormal = normal
    session.startHit = hit
    return session
  }

  const { normal, u, v } = rotateBasis(handle.axis as 'x' | 'y' | 'z')
  const hit = intersectPlane(raycaster.ray, origin, normal)
  if (!hit) return null
  const rel = hit.clone().sub(origin)
  session.rotateAxis = normal
  session.basisU = u
  session.basisV = v
  session.startAngle = Math.atan2(rel.dot(v), rel.dot(u))
  return session
}

export type GumballSnapFn = (value: number) => number

export function updateDrag(
  session: GumballDragSession,
  mesh: THREE.Object3D,
  raycaster: THREE.Raycaster,
  snap: GumballSnapFn,
): void {
  const { handle } = session

  if (handle.handleType === GumballHandleType.TRANSLATE && session.axisDir && session.startScalar != null) {
    const now = closestAxisParam(raycaster.ray, session.origin, session.axisDir)
    const next = session.startPosition.clone().addScaledVector(session.axisDir, now - session.startScalar)
    mesh.position.set(snap(next.x), snap(next.y), snap(next.z))
    return
  }

  if (handle.handleType === GumballHandleType.SCALE && session.axisDir && session.startScalar != null) {
    const now = closestAxisParam(raycaster.ray, session.origin, session.axisDir)
    const delta = now - session.startScalar
    if (handle.axis === 'uniform') {
      mesh.scale.set(
        Math.max(0.05, session.startScale.x + delta),
        Math.max(0.05, session.startScale.y + delta),
        Math.max(0.05, session.startScale.z + delta),
      )
      return
    }
    const axis = handle.axis as 'x' | 'y' | 'z'
    const weights = scaleProjectionWeights(session.startQuaternion, axis)
    mesh.scale.set(
      Math.max(0.05, session.startScale.x + delta * weights.x),
      Math.max(0.05, session.startScale.y + delta * weights.y),
      Math.max(0.05, session.startScale.z + delta * weights.z),
    )
    return
  }

  if (handle.handleType === GumballHandleType.PLANE && session.planeNormal && session.startHit) {
    const hit = intersectPlane(raycaster.ray, session.origin, session.planeNormal)
    if (!hit) return
    const next = session.startPosition.clone().add(hit.clone().sub(session.startHit))
    mesh.position.set(snap(next.x), snap(next.y), snap(next.z))
    return
  }

  if (
    handle.handleType === GumballHandleType.ROTATE
    && session.rotateAxis
    && session.basisU
    && session.basisV
    && session.startAngle != null
  ) {
    const hit = intersectPlane(raycaster.ray, session.origin, session.rotateAxis)
    if (!hit) return
    const rel = hit.clone().sub(session.origin)
    const deltaAngle = Math.atan2(rel.dot(session.basisV), rel.dot(session.basisU)) - session.startAngle
    const rotQuat = new THREE.Quaternion().setFromAxisAngle(session.rotateAxis, deltaAngle)
    mesh.quaternion.copy(rotQuat).multiply(session.startQuaternion)
    const offset = session.startPosition.clone().sub(session.origin).applyQuaternion(rotQuat)
    mesh.position.copy(session.origin).add(offset)
  }
}

export interface GumballMultiStart {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

/** 把虚拟枢轴上的增量整体应用到多选对象（与 canvas useStageGizmo 同一套）。 */
export function applyGumballMultiDelta(
  session: GumballDragSession,
  virtualPivot: THREE.Object3D,
  starts: ReadonlyMap<string, GumballMultiStart>,
  getMesh: (id: string) => THREE.Object3D | undefined,
): void {
  const pivot = session.origin
  const type = session.handle.handleType
  starts.forEach((start, id) => {
    const mesh = getMesh(id)
    if (!mesh) return
    if (type === GumballHandleType.TRANSLATE || type === GumballHandleType.PLANE) {
      mesh.position.copy(start.position).add(virtualPivot.position.clone().sub(session.startPosition))
      return
    }
    if (type === GumballHandleType.ROTATE) {
      const rot = virtualPivot.quaternion
      mesh.quaternion.copy(rot).multiply(start.quaternion)
      mesh.position.copy(pivot).add(start.position.clone().sub(pivot).applyQuaternion(rot))
      return
    }
    if (type === GumballHandleType.SCALE) {
      const fx = virtualPivot.scale.x
      const fy = virtualPivot.scale.y
      const fz = virtualPivot.scale.z
      mesh.scale.set(start.scale.x * fx, start.scale.y * fy, start.scale.z * fz)
      const off = start.position.clone().sub(pivot)
      off.set(off.x * fx, off.y * fy, off.z * fz)
      mesh.position.copy(pivot).add(off)
    }
  })
}
