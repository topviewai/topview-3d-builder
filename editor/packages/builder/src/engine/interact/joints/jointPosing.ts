import { Euler, Plane, Quaternion, Raycaster, Vector3 } from 'three'
import type { Bone, PerspectiveCamera, Vector2 } from 'three'
import type { PoseCanonicalKey } from '../../rig/applyPose'
import { findCanonicalBones } from '../../rig/applyPose'

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

export interface JointHandleSpec {
  id: string
  pivot: PoseCanonicalKey
  tip: PoseCanonicalKey
}

export const JOINT_HANDLE_SPECS: readonly JointHandleSpec[] = [
  { id: 'head', pivot: 'neck', tip: 'head' },
  { id: 'shoulderL', pivot: 'leftShoulder', tip: 'leftUpperArm' },
  { id: 'shoulderR', pivot: 'rightShoulder', tip: 'rightUpperArm' },
  { id: 'elbowL', pivot: 'leftUpperArm', tip: 'leftLowerArm' },
  { id: 'elbowR', pivot: 'rightUpperArm', tip: 'rightLowerArm' },
  { id: 'wristL', pivot: 'leftLowerArm', tip: 'leftHand' },
  { id: 'wristR', pivot: 'rightLowerArm', tip: 'rightHand' },
  { id: 'waist', pivot: 'spine', tip: 'chest' },
  { id: 'kneeL', pivot: 'leftUpperLeg', tip: 'leftLowerLeg' },
  { id: 'kneeR', pivot: 'rightUpperLeg', tip: 'rightLowerLeg' },
  { id: 'ankleL', pivot: 'leftLowerLeg', tip: 'leftFoot' },
  { id: 'ankleR', pivot: 'rightLowerLeg', tip: 'rightFoot' },
]

export const LIMB_ROOTS: Readonly<Record<string, PoseCanonicalKey>> = {
  wristL: 'leftUpperArm',
  wristR: 'rightUpperArm',
  ankleL: 'leftUpperLeg',
  ankleR: 'rightUpperLeg',
}

export interface BoneRestEntry {
  bone: Bone
  restQuat: Quaternion
}

export type BoneRestTable = Map<string, BoneRestEntry>

export interface JointEuler {
  x: number
  y: number
  z: number
}

export type JointPose = Record<string, JointEuler>

export function resolveHandleBones(
  spec: JointHandleSpec,
  canonical: Partial<Record<PoseCanonicalKey, import('three').Object3D>>,
  restPose: Map<string, Quaternion>,
): { pivot: Bone; tip: Bone; restQuat: Quaternion } | null {
  const pivotObj = canonical[spec.pivot]
  const tipObj = canonical[spec.tip]
  if (!pivotObj || !tipObj) return null
  const pivot = pivotObj as Bone
  const tip = tipObj as Bone
  if (!pivot.isBone || !tip.isBone) return null
  const restQuat = restPose.get(pivot.name)
  if (!restQuat) return null
  return { pivot, tip, restQuat }
}

export function buildRestTable(
  root: import('three').Object3D,
  restPose: Map<string, Quaternion>,
): BoneRestTable {
  const table: BoneRestTable = new Map()
  root.traverse((obj) => {
    if (!(obj as Bone).isBone) return
    const restQuat = restPose.get(obj.name)
    if (!restQuat) return
    table.set(obj.name, { bone: obj as Bone, restQuat })
  })
  return table
}

export function relativeToAbsoluteEuler(rest: Quaternion, rot: JointEuler): JointEuler {
  const euler = new Euler(rot.x * DEG2RAD, rot.y * DEG2RAD, rot.z * DEG2RAD, 'XYZ')
  const q = rest.clone().multiply(new Quaternion().setFromEuler(euler))
  const out = new Euler().setFromQuaternion(q, 'XYZ')
  return { x: out.x * RAD2DEG, y: out.y * RAD2DEG, z: out.z * RAD2DEG }
}

export function applyRelativeJoint(bone: Bone, rest: Quaternion, rot: JointEuler): void {
  const euler = new Euler(rot.x * DEG2RAD, rot.y * DEG2RAD, rot.z * DEG2RAD, 'XYZ')
  bone.quaternion.copy(rest).multiply(new Quaternion().setFromEuler(euler))
}

export function findCharacterBones(
  root: import('three').Object3D,
  nameMap?: (mixamorigRawName: string) => string | undefined,
): Partial<Record<PoseCanonicalKey, import('three').Object3D>> {
  return findCanonicalBones(root, nameMap)
}

const _pivotPos = new Vector3()
const _tipPos = new Vector3()
const _camDir = new Vector3()
const _target = new Vector3()
const _v1 = new Vector3()
const _v2 = new Vector3()
const _deltaWorld = new Quaternion()
const _pivotWorldQ = new Quaternion()
const _parentWorldQ = new Quaternion()
const _newLocalQ = new Quaternion()
const _deltaQ = new Quaternion()
const _restInv = new Quaternion()
const _euler = new Euler()
const _plane = new Plane()
const _raycaster = new Raycaster()

export function solveJointAim(params: {
  pivot: Bone
  tip: Bone
  restQuat: Quaternion
  camera: PerspectiveCamera
  ndc: Vector2
  target?: Vector3
}): JointEuler | null {
  const { pivot, tip, restQuat, camera, ndc } = params
  pivot.getWorldPosition(_pivotPos)
  tip.getWorldPosition(_tipPos)
  camera.getWorldDirection(_camDir)
  if (params.target) _target.copy(params.target)
  else {
    _plane.setFromNormalAndCoplanarPoint(_camDir, _tipPos)
    _raycaster.setFromCamera(ndc, camera)
    if (!_raycaster.ray.intersectPlane(_plane, _target)) return null
  }
  _v1.copy(_tipPos).sub(_pivotPos)
  _v2.copy(_target).sub(_pivotPos)
  if (_v1.lengthSq() < 1e-8 || _v2.lengthSq() < 1e-8) return null
  _v1.normalize()
  _v2.normalize()
  _deltaWorld.setFromUnitVectors(_v1, _v2)
  pivot.getWorldQuaternion(_pivotWorldQ)
  _deltaWorld.multiply(_pivotWorldQ)
  if (pivot.parent) pivot.parent.getWorldQuaternion(_parentWorldQ)
  else _parentWorldQ.identity()
  _newLocalQ.copy(_parentWorldQ).invert().multiply(_deltaWorld)
  _restInv.copy(restQuat).invert()
  _deltaQ.copy(_restInv).multiply(_newLocalQ)
  _euler.setFromQuaternion(_deltaQ, 'XYZ')
  return { x: _euler.x * RAD2DEG, y: _euler.y * RAD2DEG, z: _euler.z * RAD2DEG }
}
