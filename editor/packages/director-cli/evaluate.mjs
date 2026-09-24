import { Box3, Euler, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import {
  CAMERA_MOTIONS,
  FCurveSet,
  bakeCameraMotionClip,
  createFrameSnapshot,
  evaluateFrame,
  sceneFromDocument,
} from '@topview/3d-builder/evaluate'

export async function validateDirectorDocument(body) {
  const { parseDirectorDocument } = await import('@topview/3d-builder/evaluate')
  parseDirectorDocument(body.document ?? body)
  return { ok: true }
}

export function bakeCameraMotion(body) {
  const preset = CAMERA_MOTIONS.find((item) => item.id === body.presetId)
  if (!preset) throw new Error(`unknown preset ${body.presetId}`)
  const cameraNode = (body.document?.content?.nodes ?? []).find((node) => node.id === body.cameraNodeId)
  if (!cameraNode) throw new Error(`camera ${body.cameraNodeId} not found`)
  return bakeCameraMotionClip(
    preset,
    { cameraNode, doc: body.document },
    body.frameStart ?? 0,
    body.config,
  )
}

function primitiveWorldBox(node, xf) {
  if (node?.type !== 'primitive') return null
  const kind = node.primitive?.kind
  const parameters = node.primitive?.parameters || {}
  let halfX = 0
  let halfY = 0
  let halfZ = 0
  if (kind === 'BoxGeometry') {
    halfX = (parameters.width ?? 0) / 2
    halfY = (parameters.height ?? 0) / 2
    halfZ = (parameters.depth ?? 0) / 2
  } else if (kind === 'SphereGeometry') {
    halfX = halfY = halfZ = parameters.radius ?? 0
  } else if (kind === 'CylinderGeometry') {
    halfX = halfZ = Math.max(parameters.radiusTop ?? 0, parameters.radiusBottom ?? 0)
    halfY = (parameters.height ?? 0) / 2
  } else if (kind === 'ConeGeometry') {
    halfX = halfZ = parameters.radius ?? 0
    halfY = (parameters.height ?? 0) / 2
  } else {
    return null
  }
  const scale = xf.scale || {}
  const box = new Box3(
    new Vector3(-halfX * (scale.x ?? 1), -halfY * (scale.y ?? 1), -halfZ * (scale.z ?? 1)),
    new Vector3(halfX * (scale.x ?? 1), halfY * (scale.y ?? 1), halfZ * (scale.z ?? 1)),
  )
  const rotation = xf.rotation || {}
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(
    (rotation.x ?? 0) * Math.PI / 180,
    (rotation.y ?? 0) * Math.PI / 180,
    (rotation.z ?? 0) * Math.PI / 180,
    'XYZ',
  ))
  matrix.setPosition(xf.position.x, xf.position.y, xf.position.z)
  return box.applyMatrix4(matrix)
}

// Mesh bounds measured in Chromium (`inspect-nodes`), keyed by frame then node id. Posed characters
// are judged by these instead of their origin, which a pose or seat offset can put below the floor.
const MESH_GROUND_TOLERANCE = 0.02

function meshBox(nodeBounds, frame, nodeId) {
  const bounds = nodeBounds?.[String(frame)]?.[nodeId]
  if (!bounds?.min || !bounds?.max) return null
  return new Box3(
    new Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
    new Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
  )
}

function frustumFor(camera, node, aspect) {
  if (!camera) return null
  const view = new PerspectiveCamera(camera.fov, aspect, node?.camera?.near ?? 0.1, node?.camera?.far ?? 2000)
  view.position.set(camera.position.x, camera.position.y, camera.position.z)
  view.lookAt(camera.lookAt.x, camera.lookAt.y, camera.lookAt.z)
  view.rotateZ((node?.transform?.rotation?.z ?? 0) * Math.PI / 180)
  view.updateMatrixWorld(true)
  return new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse))
}

function collectClips(document) {
  const animation = document?.content?.timeline?.animation ?? {}
  const groups = [
    ['cameraMotion', animation.cameraMotionClips ?? []],
    ['motion', animation.motionClips ?? []],
    ['pathMotion', animation.pathMotionClips ?? []],
  ]
  const clips = []
  for (const [clipKind, list] of groups) {
    for (const clip of list) {
      clips.push({
        clipKind,
        id: clip.id,
        nodeId: clip.target?.nodeId,
        frameStart: Number(clip.frameStart ?? 0),
        frameEnd: Number(clip.frameEnd ?? 0),
      })
    }
  }
  return clips
}

function clipOverlaps(clips) {
  const overlaps = []
  for (let i = 0; i < clips.length; i += 1) {
    for (let j = i + 1; j < clips.length; j += 1) {
      const a = clips[i]
      const b = clips[j]
      if (a.nodeId && b.nodeId && a.nodeId !== b.nodeId) continue
      if (a.clipKind !== b.clipKind) continue
      const start = Math.max(a.frameStart, b.frameStart)
      const end = Math.min(a.frameEnd, b.frameEnd)
      if (start < end) {
        overlaps.push({
          a: a.id,
          b: b.id,
          clipKind: a.clipKind,
          frameStart: start,
          frameEnd: end,
        })
      }
    }
  }
  return overlaps
}

function pathEndJumps(document, scene, snapshot) {
  const jumps = []
  for (const clip of document?.content?.timeline?.animation?.pathMotionClips ?? []) {
    const end = Number(clip.frameEnd ?? 0)
    const start = Number(clip.frameStart ?? 0)
    if (end - start < 2) continue
    evaluateFrame(scene, end - 2, snapshot)
    const before = snapshot.transforms.get(clip.target?.nodeId)?.position
    evaluateFrame(scene, end - 1, snapshot)
    const after = snapshot.transforms.get(clip.target?.nodeId)?.position
    if (!before || !after) continue
    const distance = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)
    if (distance > 0.75) {
      jumps.push({ clipId: clip.id, nodeId: clip.target?.nodeId, distance })
    }
  }
  return jumps
}

function targetVisible(frustum, mesh, target) {
  if (!frustum) return false
  return mesh ? frustum.intersectsBox(mesh) : frustum.containsPoint(new Vector3(target.position.x, target.position.y, target.position.z))
}

export function evaluateDocumentFrames(body) {
  const overlays = body.fcurves ? { fcurves: FCurveSet.parse(body.fcurves) } : {}
  const scene = sceneFromDocument(body.document, overlays)
  const snapshot = createFrameSnapshot()
  const ground = body.document?.content?.environment?.display?.groundHeight ?? 0
  const clips = collectClips(body.document)
  const frames = []
  const issues = []
  const nodes = body.document.content.nodes
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const cameraId = body.cameraNodeId || body.document.content.activeShotCameraNodeId || nodes.find(n => n.type === 'camera')?.id
  const cameraNode = nodeById.get(cameraId)
  if (!cameraNode || cameraNode.type !== 'camera') throw new Error('DIRECTOR_CAMERA_REQUIRED')
  const parts = String(body.document.content.aspectRatio || '16:9').split(':').map(Number)
  const aspect = body.width && body.height ? body.width / body.height : (parts.length === 2 && parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : 16 / 9)
  const animatedIds = new Set(clips.map(clip => clip.nodeId))
  for (const curve of body.fcurves?.fcurves ?? []) {
    const nodeId = Array.isArray(curve.t) ? curve.t[1] : (curve.t ?? curve.nodeId)
    if (nodeId) animatedIds.add(String(nodeId))
  }
  for (const frame of body.frames ?? []) {
    evaluateFrame(scene, frame, snapshot)
    const selected = snapshot.transforms.get(cameraId)
    const camera = selected?.lookAt ? { position: selected.position, lookAt: selected.lookAt, fov: selected.fov ?? cameraNode.camera.fov } : snapshot.camera
    const frustum = frustumFor(camera, cameraNode, aspect)
    const targetId = cameraNode.camera.lookAtTarget?.nodeId || cameraNode.camera.subject?.nodeId
    const target = targetId ? snapshot.transforms.get(targetId) : null
    const metrics = []
    for (const [nodeId, xf] of snapshot.transforms.entries()) {
      const node = nodeById.get(nodeId)
      const finite = ['position', 'rotation', 'scale'].every(key => Object.values(xf[key] || {}).every(Number.isFinite))
      const positiveScale = Object.values(xf.scale || {}).every(value => value > 0)
      const origin = new Vector3(xf.position.x, xf.position.y, xf.position.z)
      const mesh = meshBox(body.nodeBounds, frame, nodeId)
      const box = mesh ?? primitiveWorldBox(node, xf)
      const groundPenetration = node?.type !== 'camera' && (
        mesh ? mesh.min.y < ground - MESH_GROUND_TOLERANCE
          : box ? box.max.y < ground - 0.001 : xf.position.y < ground - 0.001
      )
      const visible = node?.visible !== false
      const inFrustum = Boolean(frustum && (
        (!mesh && frustum.containsPoint(origin)) || (box && frustum.intersectsBox(box))
      ))
      if (!finite || !positiveScale) issues.push({ severity: 'error', frame, nodeId, code: !finite ? 'NON_FINITE_TRANSFORM' : 'NON_POSITIVE_SCALE' })
      if (visible && groundPenetration) issues.push({ severity: 'warning', frame, nodeId, code: mesh ? 'MESH_BELOW_GROUND' : 'ORIGIN_BELOW_GROUND' })
      if (visible && node?.type !== 'camera' && !inFrustum) issues.push({ severity: 'warning', frame, nodeId, code: mesh ? 'MESH_OUTSIDE_FRUSTUM' : 'ORIGIN_OUTSIDE_FRUSTUM' })
      const distance = camera
        ? Math.hypot(
            xf.position.x - camera.position.x,
            xf.position.y - camera.position.y,
            xf.position.z - camera.position.z,
          )
        : null
      metrics.push({
        nodeId,
        position: { ...xf.position },
        type: node?.type, finite, positiveScale, visible, animated: animatedIds.has(nodeId), inFrustum,
        cameraDistance: distance,
        groundPenetration,
        basis: mesh ? 'mesh' : (box ? 'primitive' : 'origin'),
      })
    }
    frames.push({
      frame,
      camera: camera
        ? {
            position: { ...camera.position },
            lookAt: { ...camera.lookAt },
            fov: camera.fov,
          }
        : null,
      cameraTargetDistance: camera && target
        ? Math.hypot(
            target.position.x - camera.position.x,
            target.position.y - camera.position.y,
            target.position.z - camera.position.z,
          )
        : null,
      cameraNodeId: cameraId,
      targetNodeId: targetId ?? null,
      targetInFrustum: target ? targetVisible(frustum, meshBox(body.nodeBounds, frame, targetId), target) : null,
      nodes: metrics,
    })
  }
  return {
    ok: !issues.some(issue => issue.severity === 'error'), issues,
    measurement: body.nodeBounds
      ? 'mesh bounds for measured nodes, primitive boxes and origins otherwise; render for occlusion'
      : 'primitive boxes and node origins (characters by origin); inspect views measures character meshes',
    frames,
    clipOverlaps: clipOverlaps(clips),
    pathEndJumps: pathEndJumps(body.document, scene, snapshot),
  }
}
