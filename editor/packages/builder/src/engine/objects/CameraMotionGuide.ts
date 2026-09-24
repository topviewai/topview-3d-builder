import * as THREE from 'three'
import type { CameraMotionClip, DraftNode, DirectorDocument } from '../../contract/types'
import { evaluateCameraPoseInto, type CamPose } from '../../evaluate/camera/CameraRig'
import { EDITOR_LAYER } from '../core/Layers'

const GUIDE_COLORS = {
  line: { color: 0xffb13b, opacity: 1 },
  direction: { color: 0xffa12b, opacity: 1 },
  pointStart: { color: 0x61d394, opacity: 0.9 },
  pointEnd: { color: 0xff6b6b, opacity: 0.9 },
} as const

const POINT_RADIUS = 0.055
const END_POINT_RADIUS = 0.075
const MIN_STEP_SQ = 1e-8

export interface CameraMotionGuideHost {
  scene: THREE.Scene
  doc: DirectorDocument | null
  invalidate(): void
}

const _pose: CamPose = {
  position: [0, 0, 0],
  lookAt: [0, 0, 0],
  fov: 50,
  clipId: null,
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh
    mesh.geometry?.dispose?.()
    const m = mesh.material
    if (!m) return
    const list = Array.isArray(m) ? m : [m]
    for (const mm of list) mm.dispose?.()
  })
}

function clipsForCamera(doc: DirectorDocument, cameraId: string): CameraMotionClip[] {
  return doc.content.timeline.animation.cameraMotionClips
    .filter((c) => c.target.nodeId === cameraId)
    .slice()
    .sort((a, b) => a.frameStart - b.frameStart || a.frameEnd - b.frameEnd)
}

function sampleGuidePoints(
  node: DraftNode,
  allClips: CameraMotionClip[],
  owned: CameraMotionClip[],
  fps: number,
  chained: boolean,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  for (const clip of owned) {
    const start = Math.round(clip.frameStart)
    const end = Math.round(clip.frameEnd)
    if (end < start) continue
    for (let f = start; f <= end; f++) {
      evaluateCameraPoseInto(node, allClips, f, fps, chained, _pose)
      const next = new THREE.Vector3(_pose.position[0], _pose.position[1], _pose.position[2])
      const prev = points[points.length - 1]
      if (!prev || prev.distanceToSquared(next) > MIN_STEP_SQ) points.push(next)
    }
  }
  return points
}

function buildGuideGroup(points: THREE.Vector3[]): THREE.Group | null {
  if (points.length < 1) return null
  const g = new THREE.Group()
  g.name = '__camera_motion_guide__'

  if (points.length >= 2) {
    const lineMat = new THREE.LineBasicMaterial({
      color: GUIDE_COLORS.line.color,
      transparent: true,
      opacity: GUIDE_COLORS.line.opacity,
      depthTest: false,
    })
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMat)
    line.renderOrder = 18
    g.add(line)

    const coneGeo = new THREE.ConeGeometry(0.055, 0.16, 16)
    const dirMat = new THREE.MeshBasicMaterial({
      color: GUIDE_COLORS.direction.color,
      transparent: true,
      opacity: GUIDE_COLORS.direction.opacity,
      depthTest: false,
    })
    const step = Math.max(1, Math.floor(points.length / 12))
    for (let i = step; i < points.length - 1; i += step) {
      const c = new THREE.Mesh(coneGeo, dirMat)
      c.position.copy(points[i])
      const dir = points[i + 1].clone().sub(points[i])
      if (dir.lengthSq() < MIN_STEP_SQ) continue
      c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
      c.renderOrder = 19
      g.add(c)
    }
  }

  const startMat = new THREE.MeshBasicMaterial({
    color: GUIDE_COLORS.pointStart.color,
    transparent: true,
    opacity: GUIDE_COLORS.pointStart.opacity,
    depthTest: false,
  })
  const endMat = new THREE.MeshBasicMaterial({
    color: GUIDE_COLORS.pointEnd.color,
    transparent: true,
    opacity: GUIDE_COLORS.pointEnd.opacity,
    depthTest: false,
  })
  const start = new THREE.Mesh(new THREE.SphereGeometry(END_POINT_RADIUS, 16, 12), startMat)
  start.position.copy(points[0])
  start.renderOrder = 20
  g.add(start)
  if (points.length > 1) {
    const end = new THREE.Mesh(new THREE.SphereGeometry(END_POINT_RADIUS, 16, 12), endMat)
    end.position.copy(points[points.length - 1])
    end.renderOrder = 20
    g.add(end)
  } else {
    const mid = new THREE.Mesh(new THREE.SphereGeometry(POINT_RADIUS, 16, 12), endMat)
    mid.position.copy(points[0])
    mid.renderOrder = 20
    g.add(mid)
  }

  g.traverse((o) => o.layers.set(EDITOR_LAYER))
  return g
}

function guideSignature(
  cameraId: string,
  owned: CameraMotionClip[],
  chained: boolean,
  node: DraftNode,
): string {
  const t = node.transform.position
  const la = node.camera?.lookAt
  const parts = owned.map((c) => c.id + ':' + c.frameStart + ':' + c.frameEnd + ':' + c.motion.curves.length)
  return [
    cameraId,
    chained ? '1' : '0',
    t.x + ',' + t.y + ',' + t.z,
    la ? la.x + ',' + la.y + ',' + la.z : '',
    String(node.camera?.fov ?? 50),
    parts.join('|'),
  ].join('::')
}

interface GuideState {
  guide: THREE.Group | null
  key: string
}

const guides = new WeakMap<CameraMotionGuideHost, GuideState>()

function guideState(host: CameraMotionGuideHost): GuideState {
  let state = guides.get(host)
  if (!state) {
    state = { guide: null, key: '' }
    guides.set(host, state)
  }
  return state
}

export function clearCameraMotionGuide(host: CameraMotionGuideHost): void {
  const state = guideState(host)
  if (!state.guide) {
    state.key = ''
    return
  }
  disposeObject(state.guide)
  host.scene.remove(state.guide)
  state.guide = null
  state.key = ''
  host.invalidate()
}

/** 选中机位且存在运镜片段时，用运镜求值采样画导轨；多段按 frameStart 串联。 */
export function syncCameraMotionGuide(
  host: CameraMotionGuideHost,
  cameraId: string | null,
  chained = false,
): void {
  const doc = host.doc
  if (!cameraId || !doc) {
    clearCameraMotionGuide(host)
    return
  }
  const node = doc.content.nodes.find((n) => n.id === cameraId && n.type === 'camera')
  if (!node) {
    clearCameraMotionGuide(host)
    return
  }
  const allClips = doc.content.timeline.animation.cameraMotionClips
  const owned = clipsForCamera(doc, cameraId)
  if (owned.length === 0) {
    clearCameraMotionGuide(host)
    return
  }
  const key = guideSignature(cameraId, owned, chained, node)
  const state = guideState(host)
  if (key === state.key && state.guide) return

  clearCameraMotionGuide(host)
  const fps = doc.content.timeline.fps || 30
  const points = sampleGuidePoints(node, allClips, owned, fps, chained)
  const g = buildGuideGroup(points)
  if (!g) return
  host.scene.add(g)
  state.guide = g
  state.key = key
  host.invalidate()
}
