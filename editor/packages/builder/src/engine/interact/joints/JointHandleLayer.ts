import * as THREE from 'three'
import { EDITOR_LAYER } from '../../core/Layers'
import { JOINT_HANDLE_SPECS, resolveHandleBones, type JointHandleSpec } from './jointPosing'
import type { PoseCanonicalKey } from '../../rig/applyPose'

const IDLE = 0xb3b3b3
const HOVER = 0xffffff

export class JointHandleLayer {
  readonly group = new THREE.Group()
  readonly handles: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[]
  private readonly geometry = new THREE.SphereGeometry(0.5, 16, 12)
  private readonly ray = new THREE.Raycaster()

  constructor() {
    this.group.name = 'stage-joint-handles'
    this.group.visible = false
    this.handles = JOINT_HANDLE_SPECS.map((spec) => {
      const material = new THREE.MeshBasicMaterial({
        color: IDLE,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(this.geometry, material)
      mesh.renderOrder = 1000
      mesh.userData.spec = spec
      mesh.layers.set(EDITOR_LAYER)
      this.group.add(mesh)
      return mesh
    })
    this.group.traverse((obj) => obj.layers.set(EDITOR_LAYER))
  }

  attach(scene: THREE.Scene): void {
    if (this.group.parent !== scene) scene.add(this.group)
  }

  hover(specId: string | null): void {
    for (const mesh of this.handles) {
      const spec = mesh.userData.spec as JointHandleSpec
      const on = spec.id === specId
      mesh.material.color.setHex(on ? HOVER : IDLE)
      mesh.material.opacity = on ? 1 : 0.8
    }
  }

  pick(camera: THREE.PerspectiveCamera, ndcX: number, ndcY: number): JointHandleSpec | null {
    if (!this.group.visible) return null
    this.group.updateWorldMatrix(true, true)
    this.ray.layers.set(EDITOR_LAYER)
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
    const hit = this.ray.intersectObjects(this.handles.filter((h) => h.visible), false)[0]
    return hit ? (hit.object.userData.spec as JointHandleSpec) : null
  }

  sync(
    camera: THREE.PerspectiveCamera,
    canvasHeight: number,
    canonical: Partial<Record<PoseCanonicalKey, THREE.Object3D>> | null,
    restPose: Map<string, THREE.Quaternion> | null,
    root: THREE.Object3D | null,
  ): void {
    this.group.visible = Boolean(canonical && restPose && root)
    if (!canonical || !restPose || !root) return
    root.updateWorldMatrix(true, true)
    this.handles.forEach((handle, index) => {
      const bones = resolveHandleBones(JOINT_HANDLE_SPECS[index], canonical, restPose)
      handle.visible = Boolean(bones)
      if (!bones) return
      bones.tip.getWorldPosition(handle.position)
      const height = 2 * camera.position.distanceTo(handle.position) * Math.tan((camera.fov * Math.PI) / 360)
      handle.scale.setScalar((height * 16) / Math.max(1, canvasHeight))
    })
  }

  dispose(): void {
    this.group.removeFromParent()
    this.geometry.dispose()
    for (const handle of this.handles) handle.material.dispose()
  }
}
