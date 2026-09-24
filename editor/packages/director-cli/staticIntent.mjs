import { applyStudioIntent } from '@topview/3d-builder/evaluate'
import { evaluateDocumentFrames } from './evaluate.mjs'

const axes = ['x', 'y', 'z']
function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`INVALID_${label}`)
  return value
}
function vector(value, label, positive = false) {
  if (!value || typeof value !== 'object' || !Object.keys(value).length) throw new Error(`INVALID_${label}`)
  for (const [key, number] of Object.entries(value)) {
    if (!axes.includes(key) || (positive && number <= 0)) throw new Error(`INVALID_${label}`)
    finite(number, label)
  }
  return value
}
function length(a, b) { return Math.hypot(...axes.map(axis => a[axis] - b[axis])) }
function worldToSubject(world, subject, binding) {
  const r = subject.transform.rotation
  const yaw = binding.followRotation ? Math.atan2(Math.sin(r.y * Math.PI / 180), Math.cos(r.x * Math.PI / 180) * Math.cos(r.y * Math.PI / 180)) : 0
  const dx = world.x - subject.transform.position.x, dz = world.z - subject.transform.position.z
  return { x: dx * Math.cos(yaw) - dz * Math.sin(yaw), y: world.y - subject.transform.position.y, z: dx * Math.sin(yaw) + dz * Math.cos(yaw) }
}
function subjectToWorld(local, subject, binding) {
  const r = subject.transform.rotation
  const yaw = binding.followRotation ? Math.atan2(Math.sin(r.y * Math.PI / 180), Math.cos(r.x * Math.PI / 180) * Math.cos(r.y * Math.PI / 180)) : 0
  const p = subject.transform.position
  return { x: p.x + local.x * Math.cos(yaw) + local.z * Math.sin(yaw), y: p.y + local.y, z: p.z - local.x * Math.sin(yaw) + local.z * Math.cos(yaw) }
}
function resolveBoundCamera(document, node) {
  const binding = node.camera?.subject
  if (binding?.follow) {
    const subject = document.content.nodes.find(n => n.id === binding.nodeId && n.type === 'character')
    if (!subject) throw new Error('CAMERA_SUBJECT_MISSING')
    node.transform.position = subjectToWorld(binding.offset, subject, binding)
    node.camera.lookAt = subjectToWorld(binding.lookAtOffset, subject, binding)
  }
  const target = node.camera?.lookAtTarget
  if (target) {
    const subject = document.content.nodes.find(n => n.id === target.nodeId)
    if (!subject) throw new Error('CAMERA_TARGET_MISSING')
    const offset = target.offset || { x: 0, y: 1.2, z: 0 }
    node.camera.lookAt = Object.fromEntries(axes.map(axis => [axis, subject.transform.position[axis] + offset[axis]]))
  }
}
// Same Euler-to-look-at convention used by the Editor camera inspector.
function aim(position, rotation, distance) {
  const [x, y, z] = axes.map(axis => rotation[axis] * Math.PI / 180)
  const ix = -Math.sin(y) * Math.cos(x), iy = Math.sin(x), iz = -Math.cos(y) * Math.cos(x)
  return { x: position.x + (Math.cos(z) * ix - Math.sin(z) * iy) * distance,
    y: position.y + (Math.sin(z) * ix + Math.cos(z) * iy) * distance,
    z: position.z + iz * distance }
}

export function applyStaticIntent(body) {
  const intent = { ...body.intent }
  const document = structuredClone(body.document)
  const id = intent.nodeId || intent.cameraNodeId
  const node = document.content.nodes.find(n => n.id === id)
  const requireNode = (nodeId, type) => {
    const target = document.content.nodes.find(n => n.id === nodeId)
    if (!target) throw new Error(`NODE_NOT_FOUND:${nodeId}`)
    if (type && target.type !== type) throw new Error(`NODE_TYPE_REQUIRED:${nodeId}:${type}`)
    return target
  }
  // Validate references and role types before passing an intent to the builder.
  if (intent.cameraNodeId) requireNode(intent.cameraNodeId, 'camera')
  if (intent.subjectNodeId) requireNode(intent.subjectNodeId, 'character')
  if (intent.type === 'add-camera' && node) throw new Error(`NODE_ALREADY_EXISTS:${id}`)
  if (['patch-transform', 'move-node', 'set-distance', 'set-fov'].includes(intent.type)) {
    if (!node) throw new Error(`NODE_NOT_FOUND:${id}`)
    if (node.locked) throw new Error(`NODE_LOCKED:${id}`)
    resolveBoundCamera(document, node)
  }
  if (intent.type === 'move-node') {
    if (Boolean(intent.position) === Boolean(intent.offset)) throw new Error('POSITION_OR_OFFSET_REQUIRED')
    if (intent.offset) {
      vector(intent.offset, 'OFFSET')
      intent.position = Object.fromEntries(axes.map(axis => [axis, node.transform.position[axis] + (intent.offset[axis] ?? 0)]))
    }
    intent.type = 'patch-transform'
  }
  if (intent.type === 'set-fov') {
    finite(intent.fov, 'FOV')
    if (intent.fov < 12 || intent.fov > 120) throw new Error('FOV_OUT_OF_RANGE')
  }
  if (intent.type === 'set-distance') {
    finite(intent.distance, 'DISTANCE')
    if (intent.distance < 0.1 || intent.distance > 200) throw new Error('DISTANCE_OUT_OF_RANGE')
  }
  if (intent.type === 'patch-transform') {
    if (!['position', 'rotation', 'scale', 'name'].some(key => intent[key] !== undefined)) throw new Error('EMPTY_NODE_PATCH')
    for (const key of ['position', 'rotation', 'scale']) if (intent[key] !== undefined) vector(intent[key], key.toUpperCase(), key === 'scale')
    if (intent.name !== undefined && (typeof intent.name !== 'string' || !intent.name.trim() || intent.name.length > 128)) throw new Error('INVALID_NODE_NAME')
  }
  const before = node ? structuredClone(node) : null
  const result = applyStudioIntent({ ...body, document, intent })
  if (intent.type === 'patch-transform') {
    const patched = result.document.content.nodes.find(n => n.id === intent.nodeId)
    if (intent.name !== undefined) patched.name = intent.name.trim()
    if (patched.camera && (intent.position || intent.rotation)) {
      const distance = Math.max(0.1, length(before.transform.position, before.camera.lookAt))
      const pinned = before.camera.lookAtTarget || before.camera.subject?.follow
      patched.camera.lookAt = intent.rotation ? aim(patched.transform.position, patched.transform.rotation, distance)
        : pinned ? { ...before.camera.lookAt }
        : Object.fromEntries(axes.map(axis => [axis, before.camera.lookAt[axis] + patched.transform.position[axis] - before.transform.position[axis]]))
      const target = patched.camera.lookAtTarget
      if (target) {
        const subject = result.document.content.nodes.find(n => n.id === target.nodeId)
        target.offset = Object.fromEntries(axes.map(axis => [axis, patched.camera.lookAt[axis] - subject.transform.position[axis]]))
      }
      const binding = patched.camera.subject
      if (binding) {
        const subject = result.document.content.nodes.find(n => n.id === binding.nodeId)
        binding.offset = worldToSubject(patched.transform.position, subject, binding)
        binding.lookAtOffset = worldToSubject(patched.camera.lookAt, subject, binding)
        binding.distance = length(patched.transform.position, patched.camera.lookAt)
      }
    }
  }
  return result
}

export function evaluateStaticPlan(body) {
  let document = structuredClone(body.document)
  if (!Array.isArray(body.changes) || !body.changes.length || body.changes.length > 64) throw new Error('INVALID_PLAN_CHANGES')
  for (const change of body.changes) {
    const patch = Object.fromEntries(['position', 'rotation', 'scale', 'name'].filter(k => change[k] !== undefined).map(k => [k, change[k]]))
    if (!Object.keys(patch).length && change.fov === undefined && change.distance === undefined) throw new Error('EMPTY_PLAN_CHANGE')
    if (Object.keys(patch).length) document = applyStaticIntent({ document, intent: { type: 'patch-transform', nodeId: change.nodeId, ...patch } }).document
    if (change.fov !== undefined) document = applyStaticIntent({ document, intent: { type: 'set-fov', cameraNodeId: change.nodeId, fov: change.fov } }).document
    if (change.distance !== undefined) document = applyStaticIntent({ document, intent: { type: 'set-distance', cameraNodeId: change.nodeId, distance: change.distance } }).document
  }
  return { ...evaluateDocumentFrames({ ...body, document }), dryRun: true }
}
