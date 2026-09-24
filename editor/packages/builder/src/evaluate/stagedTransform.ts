import type { Vec3 } from '../contract/types'
import type { FCurveSet } from '../evaluate/curves/FCurveSet'
import type { UserKeys } from '../evaluate/curves/KeyframeTrack'
import type { TransformValue } from '../evaluate/FrameSnapshot'

export type StagedTransform = {
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  lookAt?: Vec3
  fov?: number
}

const ANIM_PROPS = ['position', 'rotation', 'scale', 'lookAt', 'fov'] as const
const ANIM_PATHS = [
  'transform.position',
  'transform.rotation',
  'transform.scale',
  'camera.lookAt',
  'camera.fov',
] as const

/** 该节点是否有会盖住静态 transform 的动画（userKeys / fcurves）。有则拖动应暂存，不应自动改关键帧。 */
export function nodeHasAnimatedTransform(
  userKeys: UserKeys | undefined,
  fcurves: FCurveSet | null | undefined,
  nodeId: string,
): boolean {
  const uk = userKeys?.[nodeId]
  if (uk) {
    for (const prop of ANIM_PROPS) {
      if (uk[prop]?.length) return true
    }
  }
  if (fcurves) {
    for (const path of ANIM_PATHS) {
      if (fcurves.hasTrack(nodeId, path)) return true
    }
  }
  return false
}

export function mergeStagedTransform(
  prev: StagedTransform | undefined,
  patch: StagedTransform,
): StagedTransform {
  return {
    position: patch.position ?? prev?.position,
    rotation: patch.rotation ?? prev?.rotation,
    scale: patch.scale ?? prev?.scale,
    lookAt: patch.lookAt ?? prev?.lookAt,
    fov: patch.fov ?? prev?.fov,
  }
}

export function overlayStagedTransform(xf: TransformValue, staged: StagedTransform): void {
  if (staged.position) {
    xf.position.x = staged.position.x
    xf.position.y = staged.position.y
    xf.position.z = staged.position.z
  }
  if (staged.rotation) {
    xf.rotation.x = staged.rotation.x
    xf.rotation.y = staged.rotation.y
    xf.rotation.z = staged.rotation.z
    xf.useEuler = true
  }
  if (staged.scale) {
    xf.scale.x = staged.scale.x
    xf.scale.y = staged.scale.y
    xf.scale.z = staged.scale.z
  }
  if (staged.lookAt) {
    if (!xf.lookAt) xf.lookAt = { x: 0, y: 0, z: 0 }
    xf.lookAt.x = staged.lookAt.x
    xf.lookAt.y = staged.lookAt.y
    xf.lookAt.z = staged.lookAt.z
  }
  if (staged.fov !== undefined) xf.fov = staged.fov
}
