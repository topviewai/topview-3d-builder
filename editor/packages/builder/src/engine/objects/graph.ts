import type * as THREE from 'three'
import type { DirectorDocument, DraftNode } from '../../contract/types'
import type { NodeSnapshot } from '../DirectorEngine'
import type { ResolveMediaUrl } from '../io/mediaRefs'
import type { CamInstance, CharInstance } from './types'
import type { MotionPlayer } from './MotionPlayer'
import type { PoseLibraryBank } from '../../data/poseLibraryBank'

export interface StageGraph {
  readonly scene: THREE.Scene
  readonly motionPlayer: MotionPlayer
  readonly poseBank: PoseLibraryBank
  readonly resolveMediaUrl: ResolveMediaUrl
  doc: DirectorDocument | null
  readonly nodeById: Map<string, DraftNode>
  readonly characters: Map<string, CharInstance>
  readonly cameras: Map<string, CamInstance>
  readonly props: Map<string, THREE.Object3D>
  readonly groups: Map<string, THREE.Group>
  readonly primitives: Map<string, THREE.Mesh>
  readonly pathNodes: Map<string, DraftNode>
  readonly snapshot: Map<string, NodeSnapshot>
  invalidate(): void
  gizmoBusy?(): boolean
  gizmoAttachedNodeId?(): string | null
  gizmoAttachedNodeIds?(): string[]
  poseJointBusy?(): boolean
  poseJointNodeId?(): string | null
}
