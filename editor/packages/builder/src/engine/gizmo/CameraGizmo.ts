import * as THREE from 'three'
import { parseAspectRatio } from '../../contract/aspectRatio'
import {
  buildStageCameraWirePositions,
  STAGE_CAMERA_PICK_SIZE,
  STAGE_CAMERA_WIRE_IDLE,
  STAGE_CAMERA_WIRE_SELECTED,
} from './stageCameraWire'

const SHELL_IDLE = 0x79b9e3
const SHELL_ACTIVE = 0xe9a34c
const TRIM_IDLE = 0x355c78
const TRIM_ACTIVE = 0x9c581e

function addCameraBody(group: THREE.Group, pickTargets: THREE.Object3D[]): {
  shell: THREE.MeshBasicMaterial[]
  trim: THREE.MeshBasicMaterial[]
} {
  const shell: THREE.MeshBasicMaterial[] = []
  const trim: THREE.MeshBasicMaterial[] = []
  const addPart = (
    name: string,
    geometry: THREE.BufferGeometry,
    position: [number, number, number],
    role: 'shell' | 'trim' | 'glass',
    rotationX = 0,
    rotationZ = 0,
  ) => {
    const color = role === 'glass' ? 0x24445e : role === 'shell' ? SHELL_IDLE : TRIM_IDLE
    const material = new THREE.MeshBasicMaterial({ color, toneMapped: false })
    if (role === 'shell') shell.push(material)
    if (role === 'trim') trim.push(material)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.position.set(...position)
    mesh.rotation.set(rotationX, 0, rotationZ)
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 25),
      new THREE.LineBasicMaterial({ color: TRIM_IDLE, toneMapped: false }),
    )
    edges.raycast = () => undefined
    mesh.add(edges)
    group.add(mesh)
    pickTargets.push(mesh)
  }
  addPart('camera-body', new THREE.BoxGeometry(0.26, 0.18, 0.18), [0, 0, 0.23], 'shell')
  addPart('camera-grip', new THREE.BoxGeometry(0.055, 0.15, 0.15), [0.15, -0.005, 0.23], 'trim')
  addPart('camera-back', new THREE.BoxGeometry(0.20, 0.13, 0.035), [0, 0, 0.3375], 'trim')
  addPart('camera-lens-barrel', new THREE.CylinderGeometry(0.062, 0.062, 0.11, 24), [0, 0, 0.085], 'shell', Math.PI / 2)
  addPart('camera-lens-ring', new THREE.CylinderGeometry(0.075, 0.075, 0.03, 24), [0, 0, 0.025], 'trim', Math.PI / 2)
  addPart('camera-lens-glass', new THREE.CylinderGeometry(0.06, 0.06, 0.008, 24), [0, 0, 0.009], 'glass', Math.PI / 2)
  addPart('camera-side-dial', new THREE.CylinderGeometry(0.062, 0.062, 0.015, 24), [-0.1375, 0, 0.23], 'shell', 0, Math.PI / 2)
  addPart('camera-handle-front', new THREE.BoxGeometry(0.035, 0.05, 0.03), [0, 0.115, 0.17], 'trim')
  addPart('camera-handle-back', new THREE.BoxGeometry(0.035, 0.05, 0.03), [0, 0.115, 0.29], 'trim')
  addPart('camera-handle-top', new THREE.BoxGeometry(0.045, 0.025, 0.15), [0, 0.1525, 0.23], 'shell')
  return { shell, trim }
}

export class CameraGizmo {
  readonly group = new THREE.Group()
  readonly pickTargets: THREE.Object3D[] = []

  private aspect = parseAspectRatio(undefined)
  private fov = 50
  private readonly wireGeo = new THREE.BufferGeometry()
  private readonly wireMat = new THREE.LineBasicMaterial({
    color: STAGE_CAMERA_WIRE_IDLE,
    toneMapped: false,
  })
  private readonly shellMats: THREE.MeshBasicMaterial[]
  private readonly trimMats: THREE.MeshBasicMaterial[]
  private readonly trimLines: THREE.LineBasicMaterial[] = []

  constructor() {
    this.group.userData.isStageCamera = true
    const body = addCameraBody(this.group, this.pickTargets)
    this.shellMats = body.shell
    this.trimMats = body.trim
    this.group.traverse((child) => {
      const line = child as THREE.LineSegments
      if (line.isLineSegments && line.material instanceof THREE.LineBasicMaterial && line.material !== this.wireMat) {
        this.trimLines.push(line.material)
      }
    })
    this.wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(
      buildStageCameraWirePositions(this.fov, this.aspect),
      3,
    ))
    const wire = new THREE.LineSegments(this.wireGeo, this.wireMat)
    wire.frustumCulled = false
    wire.raycast = () => undefined
    this.group.add(wire)

    const pick = new THREE.Mesh(
      new THREE.BoxGeometry(STAGE_CAMERA_PICK_SIZE, STAGE_CAMERA_PICK_SIZE, STAGE_CAMERA_PICK_SIZE),
      new THREE.MeshBasicMaterial({ visible: false }),
    )
    this.group.add(pick)
    this.pickTargets.push(pick)
    this.setActive(false)
  }

  setAspect(aspect: number): void {
    if (!(aspect > 0) || Math.abs(this.aspect - aspect) < 1e-4) return
    this.aspect = aspect
    this.rebuildWire()
  }

  setFov(fov: number): void {
    if (!(fov > 0) || Math.abs(this.fov - fov) < 1e-3) return
    this.fov = fov
    this.rebuildWire()
  }

  setActive(active: boolean): void {
    this.wireMat.color.setHex(active ? STAGE_CAMERA_WIRE_SELECTED : STAGE_CAMERA_WIRE_IDLE)
    const shell = active ? SHELL_ACTIVE : SHELL_IDLE
    const trim = active ? TRIM_ACTIVE : TRIM_IDLE
    for (const mat of this.shellMats) mat.color.setHex(shell)
    for (const mat of this.trimMats) mat.color.setHex(trim)
    for (const mat of this.trimLines) mat.color.setHex(trim)
  }

  sync(cam: THREE.PerspectiveCamera): void {
    this.setFov(cam.fov)
    this.group.position.copy(cam.position)
    this.group.quaternion.copy(cam.quaternion)
  }

  private rebuildWire(): void {
    this.wireGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(buildStageCameraWirePositions(this.fov, this.aspect), 3),
    )
    this.wireGeo.computeBoundingSphere()
  }
}
