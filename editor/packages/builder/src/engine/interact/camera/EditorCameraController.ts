import * as THREE from 'three'
import {
  STAGE_CAMERA_DAMP_LAMBDA,
  STAGE_CAMERA_LOOK_SENSITIVITY,
  STAGE_CAMERA_MOVE_SPEED,
  STAGE_CAMERA_ORBIT_SENSITIVITY,
  STAGE_CAMERA_PAN_SENSITIVITY,
  STAGE_CAMERA_PROXIMITY_DAMP_END,
  STAGE_CAMERA_PROXIMITY_DAMP_START,
  STAGE_CAMERA_PROXIMITY_MIN_FACTOR,
  STAGE_CAMERA_SETTLE_EPS_ANG,
  STAGE_CAMERA_SETTLE_EPS_POS,
  STAGE_CAMERA_WHEEL_PROXIMITY_DAMP_END,
  STAGE_CAMERA_WHEEL_PROXIMITY_DAMP_START,
  STAGE_CAMERA_WHEEL_PROXIMITY_MIN_FACTOR,
  STAGE_CAMERA_ZOOM_SENSITIVITY,
} from './constants'
import {
  computeProximitySpeedFactor,
  computeWheelProximitySpeedFactor,
  measureNearestSurfaceClearance,
} from './cameraProximityDamping'

interface Vec3 {
  x: number
  y: number
  z: number
}

interface CameraPose {
  px: number
  py: number
  pz: number
  pitch: number
  yaw: number
  roll: number
  fov: number
}

interface OrbitSphericalState {
  pivotX: number
  pivotY: number
  pivotZ: number
  theta: number
  phi: number
  radius: number
}

const ORBIT_PHI_EPS = 0.01

function degToRad(value: number): number {
  return (value * Math.PI) / 180
}

function radToDeg(value: number): number {
  return (value * 180) / Math.PI
}

function clampPitch(pitchDeg: number): number {
  return Math.max(-89, Math.min(89, pitchDeg))
}

function unwrapAngleDeg(target: number, reference: number): number {
  let result = target
  while (result - reference > 180) result -= 360
  while (result - reference < -180) result += 360
  return result
}

function lerpAngleDeg(current: number, target: number, alpha: number): number {
  let delta = target - current
  while (delta > 180) delta -= 360
  while (delta < -180) delta += 360
  return current + delta * alpha
}

function angleDeltaDeg(a: number, b: number): number {
  let delta = b - a
  while (delta > 180) delta -= 360
  while (delta < -180) delta += 360
  return Math.abs(delta)
}

function poseFromCamera(camera: THREE.PerspectiveCamera): CameraPose {
  // Recompose from the quaternion. Assigning order alone keeps the old XYZ
  // numbers and Three then rebuilds a Dutch-tilted orientation.
  camera.rotation.setFromQuaternion(camera.quaternion, 'YXZ')
  return {
    px: camera.position.x,
    py: camera.position.y,
    pz: camera.position.z,
    pitch: radToDeg(camera.rotation.x),
    yaw: radToDeg(camera.rotation.y),
    roll: radToDeg(camera.rotation.z),
    fov: camera.fov,
  }
}

function applyPoseToCamera(camera: THREE.PerspectiveCamera, pose: CameraPose): void {
  camera.position.set(pose.px, pose.py, pose.pz)
  camera.rotation.order = 'YXZ'
  camera.rotation.set(degToRad(pose.pitch), degToRad(pose.yaw), degToRad(pose.roll))
  if (Math.abs(camera.fov - pose.fov) > 1e-4) {
    camera.fov = pose.fov
    camera.updateProjectionMatrix()
  }
}

function basisFromAngles(
  pitchDeg: number,
  yawDeg: number,
  rollDeg: number,
): { forward: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 } {
  const euler = new THREE.Euler(degToRad(pitchDeg), degToRad(yawDeg), degToRad(rollDeg), 'YXZ')
  const q = new THREE.Quaternion().setFromEuler(euler)
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize()
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize()
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize()
  return { forward, right, up }
}

function buildOrbitStateFromPose(
  pose: CameraPose,
  pivot: Vec3,
  prevTheta?: number,
): OrbitSphericalState {
  const offset = new THREE.Vector3(pose.px - pivot.x, pose.py - pivot.y, pose.pz - pivot.z)
  const spherical = new THREE.Spherical().setFromVector3(offset)
  let theta = spherical.theta
  if (prevTheta !== undefined) {
    while (theta - prevTheta > Math.PI) theta -= 2 * Math.PI
    while (theta - prevTheta < -Math.PI) theta += 2 * Math.PI
  }
  return {
    pivotX: pivot.x,
    pivotY: pivot.y,
    pivotZ: pivot.z,
    theta,
    phi: Math.max(ORBIT_PHI_EPS, Math.min(Math.PI - ORBIT_PHI_EPS, spherical.phi)),
    radius: Math.max(spherical.radius, 0.001),
  }
}

function applyOrbitTargetFromState(
  orbit: OrbitSphericalState,
  pivot: Vec3,
  tgt: CameraPose,
  refYaw: number,
): void {
  const newOffset = new THREE.Vector3().setFromSpherical(
    new THREE.Spherical(orbit.radius, orbit.phi, orbit.theta),
  )
  const nextX = pivot.x + newOffset.x
  const nextY = pivot.y + newOffset.y
  const nextZ = pivot.z + newOffset.z
  const dir = new THREE.Vector3(pivot.x - nextX, pivot.y - nextY, pivot.z - nextZ).normalize()
  const pitch = clampPitch(radToDeg(Math.asin(Math.max(-1, Math.min(1, dir.y)))))
  const rawYaw = radToDeg(Math.atan2(-dir.x, -dir.z))
  tgt.px = nextX
  tgt.py = nextY
  tgt.pz = nextZ
  tgt.pitch = pitch
  tgt.yaw = unwrapAngleDeg(rawYaw, refYaw)
}

export interface EditorCameraHost {
  invalidate(): void
  getSceneMeshes(): THREE.Object3D[]
  getOrbitPivot(): Vec3
  syncLookTarget(position: THREE.Vector3, target: THREE.Vector3): void
}

export class EditorCameraController {
  looking = false
  private enabled = true
  private readonly keys = new Set<string>()
  private shift = false
  private target: CameraPose | null = null
  private cur: CameraPose | null = null
  private driving = false
  private orbitState: OrbitSphericalState | null = null
  private raf = 0
  private last = 0

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly host: EditorCameraHost,
  ) {}

  start(): void {
    if (this.raf) return
    this.last = performance.now()
    const tick = (now: number) => {
      this.step(now)
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.keys.clear()
    this.driving = false
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.keys.clear()
  }

  setKey(key: string, down: boolean): void {
    if (down) this.keys.add(key)
    else this.keys.delete(key)
  }

  setShift(down: boolean): void {
    this.shift = down
  }

  snapFromCamera(): void {
    const pose = poseFromCamera(this.camera)
    this.target = { ...pose }
    this.cur = { ...pose }
    this.driving = false
    this.orbitState = null
  }

  /** 每次右键按下都重新取画面中心做支点，不要沿用上一次拖动留下的支点。 */
  beginOrbitGesture(): void {
    this.orbitState = null
  }

  applyLookDelta(dx: number, dy: number): void {
    if (!this.enabled || !this.looking) return
    this.orbitState = null
    const tgt = this.ensureTarget()
    tgt.yaw -= dx * STAGE_CAMERA_LOOK_SENSITIVITY * 180
    tgt.pitch = clampPitch(tgt.pitch - dy * STAGE_CAMERA_LOOK_SENSITIVITY * 180)
    this.driving = true
  }

  applyZoomDelta(dy: number): void {
    if (!this.enabled || dy === 0) return
    this.orbitState = null
    const tgt = this.ensureTarget()
    const { forward } = basisFromAngles(tgt.pitch, tgt.yaw, tgt.roll)
    let distance = dy * STAGE_CAMERA_ZOOM_SENSITIVITY
    const meshes = this.host.getSceneMeshes()
    const zoomIn = distance < 0
    const clearance = measureNearestSurfaceClearance({ x: tgt.px, y: tgt.py, z: tgt.pz }, meshes)
    distance *= computeWheelProximitySpeedFactor(
      clearance,
      zoomIn,
      STAGE_CAMERA_WHEEL_PROXIMITY_DAMP_START,
      STAGE_CAMERA_WHEEL_PROXIMITY_DAMP_END,
      STAGE_CAMERA_WHEEL_PROXIMITY_MIN_FACTOR,
    )
    tgt.px -= forward.x * distance
    tgt.py -= forward.y * distance
    tgt.pz -= forward.z * distance
    this.driving = true
  }

  applyOrbitDelta(dx: number, dy: number): void {
    if (!this.enabled || (dx === 0 && dy === 0)) return
    const tgt = this.ensureTarget()
    const cur = this.cur

    let orbit = this.orbitState
    if (!orbit) {
      const basePose = cur ?? tgt
      const pivot = this.resolveOrbitPivot()
      orbit = buildOrbitStateFromPose(basePose, pivot)
      this.orbitState = orbit
      applyOrbitTargetFromState(orbit, pivot, tgt, basePose.yaw)
      if (cur) this.snapCurToTarget(cur, tgt)
    }

    orbit = this.orbitState
    if (!orbit) return
    orbit.theta -= dx * STAGE_CAMERA_ORBIT_SENSITIVITY
    orbit.phi = Math.max(
      ORBIT_PHI_EPS,
      Math.min(Math.PI - ORBIT_PHI_EPS, orbit.phi - dy * STAGE_CAMERA_ORBIT_SENSITIVITY),
    )
    applyOrbitTargetFromState(orbit, { x: orbit.pivotX, y: orbit.pivotY, z: orbit.pivotZ }, tgt, this.cur?.yaw ?? tgt.yaw)
    this.driving = true
  }

  applyPanDelta(dx: number, dy: number): void {
    if (!this.enabled) return
    this.orbitState = null
    const tgt = this.ensureTarget()
    const { right, up } = basisFromAngles(tgt.pitch, tgt.yaw, tgt.roll)
    const deltaX = -right.x * dx * STAGE_CAMERA_PAN_SENSITIVITY + up.x * dy * STAGE_CAMERA_PAN_SENSITIVITY
    const deltaY = -right.y * dx * STAGE_CAMERA_PAN_SENSITIVITY + up.y * dy * STAGE_CAMERA_PAN_SENSITIVITY
    const deltaZ = -right.z * dx * STAGE_CAMERA_PAN_SENSITIVITY + up.z * dy * STAGE_CAMERA_PAN_SENSITIVITY
    tgt.px += deltaX
    tgt.py += deltaY
    tgt.pz += deltaZ
    const cur = this.cur
    if (cur) {
      cur.px += deltaX
      cur.py += deltaY
      cur.pz += deltaZ
    }
    this.driving = true
  }

  private ensureTarget(): CameraPose {
    if (!this.target) {
      const pose = poseFromCamera(this.camera)
      this.target = { ...pose }
      if (!this.cur) this.cur = { ...pose }
    }
    return this.target
  }

  /**
   * 支点由宿主按当前画面中心算，本身就跟着相机走，所以这里不再叠加平移补偿——
   * 叠加会让支点离开画面中心，转起来像混了一段平移。
   */
  private resolveOrbitPivot(): Vec3 {
    return this.host.getOrbitPivot()
  }

  private snapCurToTarget(cur: CameraPose, tgt: CameraPose): void {
    cur.px = tgt.px
    cur.py = tgt.py
    cur.pz = tgt.pz
    cur.pitch = tgt.pitch
    cur.yaw = tgt.yaw
    cur.roll = tgt.roll
    cur.fov = tgt.fov
  }

  private step(now: number): void {
    const dt = Math.min((now - this.last) / 1000, 0.05)
    this.last = now
    if (!this.cur || !this.target) {
      const pose = poseFromCamera(this.camera)
      this.cur = { ...pose }
      this.target = { ...pose }
    }
    const cur = this.cur
    const tgt = this.target

    if (this.enabled && this.keys.size > 0) {
      this.driving = true
      const speed = STAGE_CAMERA_MOVE_SPEED * (this.shift ? 2 : 1) * dt
      const { forward } = basisFromAngles(tgt.pitch, tgt.yaw, tgt.roll)
      const worldUp = new THREE.Vector3(0, 1, 0)
      const right = new THREE.Vector3().crossVectors(forward, worldUp)
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
      else right.normalize()
      const up = new THREE.Vector3().crossVectors(right, forward).normalize()
      const delta = new THREE.Vector3()
      if (this.keys.has('w')) delta.add(forward)
      if (this.keys.has('s')) delta.sub(forward)
      if (this.keys.has('d')) delta.add(right)
      if (this.keys.has('a')) delta.sub(right)
      if (this.keys.has('e')) delta.add(up)
      if (this.keys.has('q')) delta.sub(up)
      if (delta.lengthSq() > 0) {
        delta.normalize()
        const forwardDot = delta.dot(forward)
        if (forwardDot > 0 && !this.shift) {
          const factor = computeProximitySpeedFactor(
            measureNearestSurfaceClearance({ x: tgt.px, y: tgt.py, z: tgt.pz }, this.host.getSceneMeshes()),
            STAGE_CAMERA_PROXIMITY_DAMP_START,
            STAGE_CAMERA_PROXIMITY_DAMP_END,
            STAGE_CAMERA_PROXIMITY_MIN_FACTOR,
          )
          const orth = delta.clone().sub(forward.clone().multiplyScalar(forwardDot))
          delta.copy(forward).multiplyScalar(forwardDot * factor).add(orth)
        }
        delta.multiplyScalar(speed)
        tgt.px += delta.x
        tgt.py += delta.y
        tgt.pz += delta.z
        this.orbitState = null
      }
    }

    if (!this.driving) return

    const alpha = 1 - Math.exp(-STAGE_CAMERA_DAMP_LAMBDA * dt)
    cur.px += (tgt.px - cur.px) * alpha
    cur.py += (tgt.py - cur.py) * alpha
    cur.pz += (tgt.pz - cur.pz) * alpha
    cur.pitch = lerpAngleDeg(cur.pitch, tgt.pitch, alpha)
    cur.yaw = lerpAngleDeg(cur.yaw, tgt.yaw, alpha)
    cur.roll += (tgt.roll - cur.roll) * alpha
    cur.fov += (tgt.fov - cur.fov) * alpha

    const posSettled =
      Math.abs(tgt.px - cur.px) < STAGE_CAMERA_SETTLE_EPS_POS
      && Math.abs(tgt.py - cur.py) < STAGE_CAMERA_SETTLE_EPS_POS
      && Math.abs(tgt.pz - cur.pz) < STAGE_CAMERA_SETTLE_EPS_POS
    const angSettled =
      angleDeltaDeg(cur.pitch, tgt.pitch) < STAGE_CAMERA_SETTLE_EPS_ANG
      && angleDeltaDeg(cur.yaw, tgt.yaw) < STAGE_CAMERA_SETTLE_EPS_ANG
      && Math.abs(tgt.roll - cur.roll) < STAGE_CAMERA_SETTLE_EPS_ANG
      && Math.abs(tgt.fov - cur.fov) < STAGE_CAMERA_SETTLE_EPS_ANG

    if (posSettled && angSettled && this.keys.size === 0) {
      this.snapCurToTarget(cur, tgt)
      this.driving = false
    }
    applyPoseToCamera(this.camera, cur)
    const { forward } = basisFromAngles(cur.pitch, cur.yaw, cur.roll)
    const look = new THREE.Vector3(cur.px, cur.py, cur.pz).addScaledVector(forward, 4)
    this.host.syncLookTarget(this.camera.position, look)
    this.host.invalidate()
  }
}
