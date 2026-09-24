import type * as THREE from 'three'
import type { DraftNode } from '../../contract/types'
import type { CameraGizmo } from '../gizmo/CameraGizmo'
import type { CharacterAnimator } from './MotionPlayer'
import type { Ual1Retargeter } from '../rig/applyRetarget'

export interface CharInstance {
  node: DraftNode
  root: THREE.Group
  inner: THREE.Object3D
  rig: 'mixamorig' | 'ual1'
  animator: CharacterAnimator
  retargeter: Ual1Retargeter | null
  restPose: Map<string, THREE.Quaternion>
  restPos: Map<string, THREE.Vector3>
  /** rest 腿长（root 局部系，米），缩放姿势库根下沉；测不到为 null。 */
  legLength: number | null
}

export interface CamInstance {
  node: DraftNode
  camera: THREE.PerspectiveCamera
  gizmo: CameraGizmo
  lookAt: THREE.Vector3
}
