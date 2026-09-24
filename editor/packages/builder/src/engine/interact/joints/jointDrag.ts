import { Plane, Quaternion, Raycaster, Vector3 } from 'three'
import type { PerspectiveCamera, Vector2 } from 'three'
import type { PoseCanonicalKey } from '../../rig/applyPose'
import {
  LIMB_ROOTS,
  resolveHandleBones,
  solveJointAim,
  type JointHandleSpec,
  type JointPose,
} from './jointPosing'
import { limbPole, solveTwoBoneIk } from './twoBoneIk'

export interface JointDrag {
  objectId: string
  spec: JointHandleSpec
  plane: Plane
  offset: Vector3
  pole: Vector3
  latestPose: JointPose
}

function rootEntry(
  spec: JointHandleSpec,
  canonical: Partial<Record<PoseCanonicalKey, import('three').Object3D>>,
  restPose: Map<string, Quaternion>,
) {
  const key = LIMB_ROOTS[spec.id]
  if (!key) return undefined
  const bone = canonical[key] as import('three').Bone | undefined
  if (!bone?.isBone) return undefined
  const restQuat = restPose.get(bone.name)
  return restQuat ? { bone, restQuat, name: bone.name } : undefined
}

export function beginJointDrag(
  objectId: string,
  spec: JointHandleSpec,
  canonical: Partial<Record<PoseCanonicalKey, import('three').Object3D>>,
  restPose: Map<string, Quaternion>,
  camera: PerspectiveCamera,
  ndc: Vector2,
  forward: Vector3,
): JointDrag | null {
  const bones = resolveHandleBones(spec, canonical, restPose)
  if (!bones) return null
  const tip = bones.tip.getWorldPosition(new Vector3())
  const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()), tip)
  const ray = new Raycaster()
  ray.setFromCamera(ndc, camera)
  const hit = ray.ray.intersectPlane(plane, new Vector3())
  if (!hit) return null
  const root = rootEntry(spec, canonical, restPose)
  const pole = root ? limbPole(root.bone, bones.pivot, bones.tip, forward) : forward
  return { objectId, spec, plane, pole, offset: tip.sub(hit), latestPose: {} }
}

export function updateJointDrag(
  drag: JointDrag,
  canonical: Partial<Record<PoseCanonicalKey, import('three').Object3D>>,
  restPose: Map<string, Quaternion>,
  camera: PerspectiveCamera,
  ndc: Vector2,
): JointPose | null {
  const bones = resolveHandleBones(drag.spec, canonical, restPose)
  if (!bones) return null
  const ray = new Raycaster()
  ray.setFromCamera(ndc, camera)
  const target = ray.ray.intersectPlane(drag.plane, new Vector3())?.add(drag.offset)
  if (!target) return null
  const root = rootEntry(drag.spec, canonical, restPose)
  if (root) {
    const solved = solveTwoBoneIk(
      root.bone,
      bones.pivot,
      bones.tip,
      target,
      drag.pole,
      root.restQuat,
      bones.restQuat,
    )
    return solved
      ? { ...drag.latestPose, [root.name]: solved.root, [bones.pivot.name]: solved.middle }
      : null
  }
  const rotation = solveJointAim({ ...bones, camera, ndc, target })
  return rotation ? { ...drag.latestPose, [bones.pivot.name]: rotation } : null
}
