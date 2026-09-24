import { Euler, Quaternion, Vector3 } from 'three'
import type { Bone } from 'three'
import type { JointEuler } from './jointPosing'

export interface LimbSolution {
  root: JointEuler
  middle: JointEuler
}

export function relativeBoneRotation(bone: Bone, rest: Quaternion): JointEuler {
  const delta = rest.clone().invert().multiply(bone.quaternion)
  const euler = new Euler().setFromQuaternion(delta, 'XYZ')
  const degrees = 180 / Math.PI
  return { x: euler.x * degrees, y: euler.y * degrees, z: euler.z * degrees }
}

function aimBone(bone: Bone, from: Vector3, to: Vector3): void {
  const delta = new Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize())
  const world = bone.getWorldQuaternion(new Quaternion()).premultiply(delta)
  const parent = bone.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion()
  bone.quaternion.copy(parent.invert().multiply(world))
  bone.updateWorldMatrix(false, true)
}

export function limbPole(root: Bone, middle: Bone, tip: Bone, fallback: Vector3): Vector3 {
  const origin = root.getWorldPosition(new Vector3())
  const axis = tip.getWorldPosition(new Vector3()).sub(origin).normalize()
  const bend = middle.getWorldPosition(new Vector3()).sub(origin)
  bend.addScaledVector(axis, -bend.dot(axis))
  if (bend.lengthSq() < 1e-8) bend.copy(fallback).addScaledVector(axis, -fallback.dot(axis))
  if (bend.lengthSq() < 1e-8) {
    bend.set(Math.abs(axis.x) < 0.9 ? 1 : 0, Math.abs(axis.x) < 0.9 ? 0 : 1, 0)
    bend.addScaledVector(axis, -bend.dot(axis))
  }
  return bend.normalize()
}

export function solveTwoBoneIk(
  root: Bone,
  middle: Bone,
  tip: Bone,
  target: Vector3,
  pole: Vector3,
  rootRest: Quaternion,
  middleRest: Quaternion,
): LimbSolution | null {
  root.updateWorldMatrix(true, true)
  const a = root.getWorldPosition(new Vector3())
  const b = middle.getWorldPosition(new Vector3())
  const c = tip.getWorldPosition(new Vector3())
  const upper = a.distanceTo(b)
  const lower = b.distanceTo(c)
  if (upper < 1e-6 || lower < 1e-6 || !target.toArray().every(Number.isFinite)) return null
  const direction = target.clone().sub(a)
  if (direction.lengthSq() < 1e-12) direction.copy(c).sub(a)
  if (direction.lengthSq() < 1e-12) return null
  const minimum = Math.sqrt(upper ** 2 + lower ** 2 + 2 * upper * lower * Math.cos((150 * Math.PI) / 180))
  const maximum = Math.sqrt(upper ** 2 + lower ** 2 + 2 * upper * lower * Math.cos((2 * Math.PI) / 180))
  const distance = Math.min(maximum, Math.max(minimum, direction.length()))
  direction.normalize()
  const bend = pole.clone().addScaledVector(direction, -pole.dot(direction))
  if (bend.lengthSq() < 1e-10) return null
  bend.normalize()
  const along = (upper ** 2 - lower ** 2 + distance ** 2) / (2 * distance)
  const height = Math.sqrt(Math.max(0, upper ** 2 - along ** 2))
  const elbow = a.clone().addScaledVector(direction, along).addScaledVector(bend, height)
  const end = a.clone().addScaledVector(direction, distance)
  const rootBefore = root.quaternion.clone()
  const middleBefore = middle.quaternion.clone()
  try {
    aimBone(root, b.clone().sub(a), elbow.clone().sub(a))
    const newMiddle = middle.getWorldPosition(new Vector3())
    const newTip = tip.getWorldPosition(new Vector3())
    aimBone(middle, newTip.sub(newMiddle), end.sub(newMiddle))
    return { root: relativeBoneRotation(root, rootRest), middle: relativeBoneRotation(middle, middleRest) }
  } finally {
    root.quaternion.copy(rootBefore)
    middle.quaternion.copy(middleBefore)
    root.updateWorldMatrix(false, true)
  }
}
