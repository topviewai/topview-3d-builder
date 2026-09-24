import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type {
  CameraMotionClip,
  DirectorDocument,
  DraftNode,
  MotionClip,
  PathMotionClip,
} from '../../contract/types'
import { FCurveSet } from '../../evaluate/curves/FCurveSet'
import { makeKeyframe } from '../../evaluate/curves/KeyframeTrack'
import { rederiveWalkPaths } from '../../evaluate/path/deriveWalk'
import { cloneJson } from '../../document'
import { duplicateNodes } from '../duplicateNodes'

function character(id: string, name = id): DraftNode {
  return {
    id,
    type: 'character',
    name,
    visible: true,
    locked: false,
    transform: {
      position: { x: 1, y: 0, z: 2 },
      rotation: { x: 0, y: 10, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    character: {
      placeholder: false,
      gender: 'unknown',
      motionId: null,
      appearance: { color: '#7fb2e0' },
      label: { showLabel: true, scale: 1, yOffset: 0 },
      animation: { mode: 'pose', posePresetId: 'tpose', controlValues: {} },
    },
  }
}

function camera(id: string, lookAtTarget?: string): DraftNode {
  return {
    id,
    type: 'camera',
    name: id,
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 1.6, z: 4 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    camera: {
      projection: 'perspective',
      fov: 50,
      fovAxis: 'vertical',
      near: 0.1,
      far: 2000,
      isPrimary: true,
      lookAt: { x: 0, y: 1.6, z: 0 },
      lookAtTarget: lookAtTarget ? { nodeId: lookAtTarget } : undefined,
    },
  }
}

function pathNode(id: string, source: string): DraftNode {
  return {
    id,
    type: 'path',
    name: id,
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    path: {
      source,
      curve: source === 'draw' ? 'catmullRom' : 'polyline',
      closed: false,
      groundSnap: true,
      parameterization: 'arc-length',
      smoothing: 0.5,
      points: [
        { id: `${id}_p0`, position: { x: 0, y: 0, z: 0 } },
        { id: `${id}_p1`, position: { x: 1, y: 0, z: 0 } },
      ],
    },
  }
}

function motionClip(id: string, nodeId: string): MotionClip {
  return {
    id,
    source: 'library',
    sourceDuration: 2,
    frameStart: 0,
    frameEnd: 30,
    target: { type: 'character', nodeId },
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none' },
    motion: {
      assetId: 'walk',
      name: '走',
      source: 'library',
      sourceRig: 'mixamorig',
      url: '3d-builder/library/motions/walk.fbx',
      inPlace: true,
      loop: false,
      speed: 1,
      time: 0,
    },
  }
}

function userPathClip(id: string, targetId: string, pathNodeId: string): PathMotionClip {
  return {
    id,
    status: 'ready',
    locked: false,
    source: 'draw',
    target: { type: 'character', nodeId: targetId },
    pathNodeId,
    pathName: pathNodeId,
    pathLength: 1,
    pathStartPercent: 0,
    pathEndPercent: 100,
    direction: 'forward',
    facing: 'path-tangent',
    frameStart: 0,
    frameEnd: 20,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: 20 },
  }
}

function derivedPathClip(id: string, targetId: string, pathNodeId: string): PathMotionClip {
  return {
    ...userPathClip(id, targetId, pathNodeId),
    locked: true,
    lockedReason: 'derived-from-keyframes',
  }
}

function cameraClip(id: string, cameraId: string, targetId: string): CameraMotionClip {
  return {
    id,
    target: { type: 'camera', nodeId: cameraId },
    frameStart: 0,
    frameEnd: 30,
    trimStartMs: 0,
    trimEndMs: 1000,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: 30 },
    motion: {
      id: 'orbit',
      version: 1,
      presetId: 'orbit',
      label: '环绕',
      timeUnit: 'millisecond',
      durationMs: 1000,
      metadata: { cameraNodeId: cameraId, targetNodeId: targetId },
      curves: [
        {
          id: 'c-px',
          group: 'position',
          dataPath: 'camera.position',
          arrayIndex: 0,
          extrapolation: 'constant',
          keyframes: [{ id: 'k0', time: 0, value: 0, interpolation: 'linear' }],
        },
        {
          id: 'c-lx',
          group: 'lookAt',
          dataPath: 'camera.lookAt',
          arrayIndex: 0,
          extrapolation: 'constant',
          keyframes: [{ id: 'k1', time: 0, value: 1, interpolation: 'linear' }],
        },
        {
          id: 'c-fov',
          group: 'lens',
          dataPath: 'camera.lens.fov',
          arrayIndex: 0,
          extrapolation: 'constant',
          keyframes: [{ id: 'k2', time: 0, value: 50, interpolation: 'linear' }],
        },
      ],
    },
  }
}

function draft(nodes: DraftNode[]): DirectorDocument {
  const doc = makeEmptyDraft('dup-test', 30, 120)
  doc.content.nodes.push(...nodes)
  return doc
}

test('duplicateNodes 不修改输入，并给 userKeys / 静态变换套增量', () => {
  const doc = draft([character('actor', 'Hero')])
  const userKeys = {
    actor: {
      position: [makeKeyframe(0, [1, 0, 2])],
      rotation: [makeKeyframe(0, [0, 10, 0])],
      scale: [makeKeyframe(0, [1, 1, 1])],
    },
  }
  const beforeDoc = JSON.stringify(doc)
  const beforeKeys = JSON.stringify(userKeys)
  const result = duplicateNodes({
    document: doc,
    userKeys,
    selectedIds: ['actor'],
    delta: { position: [0.5, 0, 0], rotation: [0, 5, 0], scale: [2, 1, 1] },
  })
  assert.equal(JSON.stringify(doc), beforeDoc)
  assert.equal(JSON.stringify(userKeys), beforeKeys)
  const clone = result.document.content.nodes.find((node) => node.id !== 'actor')
  assert.ok(clone)
  assert.equal(clone!.transform.position.x, 1.5)
  assert.equal(clone!.transform.rotation.y, 15)
  assert.equal(clone!.transform.scale.x, 2)
  const cloneKeys = result.userKeys[clone!.id]
  assert.deepEqual(cloneKeys?.position?.[0].value, [1.5, 0, 2])
  assert.deepEqual(cloneKeys?.rotation?.[0].value, [0, 15, 0])
  assert.deepEqual(cloneKeys?.scale?.[0].value, [2, 1, 1])
  assert.notEqual(cloneKeys?.position?.[0].id, userKeys.actor.position[0].id)
  assert.equal(result.fcurveCopies.length, 1)
})

test('动作片段跟随复制，派生路径跳过，rederive 后副本有自己的派生路径', () => {
  const doc = draft([
    character('actor'),
    pathNode('user-path', 'draw'),
    pathNode('derived-path', 'transform-keyframes'),
  ])
  doc.content.timeline.animation.motionClips.push(motionClip('mc1', 'actor'))
  doc.content.timeline.animation.pathMotionClips.push(
    userPathClip('pc-user', 'actor', 'user-path'),
    derivedPathClip('pc-derived', 'actor', 'derived-path'),
  )
  const result = duplicateNodes({
    document: doc,
    userKeys: { actor: { position: [makeKeyframe(0, [0, 0, 0]), makeKeyframe(10, [2, 0, 0])] } },
    selectedIds: ['actor'],
    delta: { position: [1, 0, 0] },
  })
  const cloneId = result.idMap.get('actor')!
  const pathCloneId = result.idMap.get('user-path')
  assert.ok(pathCloneId)
  assert.equal(result.idMap.has('derived-path'), false)
  const motion = result.document.content.timeline.animation.motionClips.filter((clip) => clip.target.nodeId === cloneId)
  assert.equal(motion.length, 1)
  assert.notEqual(motion[0].id, 'mc1')
  const paths = result.document.content.timeline.animation.pathMotionClips.filter((clip) => clip.target.nodeId === cloneId)
  assert.equal(paths.length, 1)
  assert.equal(paths[0].pathNodeId, pathCloneId)
  const fc = FCurveSet.empty()
  rederiveWalkPaths(result.document, cloneId, fc, result.userKeys)
  const derived = result.document.content.timeline.animation.pathMotionClips.filter(
    (clip) => clip.target.nodeId === cloneId && clip.lockedReason === 'derived-from-keyframes',
  )
  assert.equal(derived.length, 1)
  assert.notEqual(derived[0].pathNodeId, pathCloneId)
})

test('非角色节点带位移键时，副本同样进入 rederive 名单', () => {
  const cube: DraftNode = { ...character('cube'), type: 'primitive', character: undefined }
  const doc = draft([cube])
  const result = duplicateNodes({
    document: doc,
    userKeys: { cube: { position: [makeKeyframe(0, [0, 0, 0]), makeKeyframe(10, [2, 0, 0])] } },
    selectedIds: ['cube'],
    delta: { position: [0.5, 0, 0] },
  })
  const cloneId = result.idMap.get('cube')!
  assert.deepEqual(result.rederiveIds, [cloneId])
  rederiveWalkPaths(result.document, cloneId, FCurveSet.empty(), result.userKeys)
  const derived = result.document.content.timeline.animation.pathMotionClips.filter(
    (clip) => clip.target.nodeId === cloneId && clip.lockedReason === 'derived-from-keyframes',
  )
  assert.equal(derived.length, 1)
})

test('组和子孙 parentId / children 双向一致', () => {
  const group: DraftNode = {
    ...character('group'),
    type: 'group',
    children: ['child'],
  }
  delete (group as { character?: unknown }).character
  const child = { ...character('child'), parentId: 'group' }
  const doc = draft([group, child])
  const result = duplicateNodes({ document: doc, userKeys: {}, selectedIds: ['group'] })
  const groupClone = result.document.content.nodes.find((node) => node.id === result.idMap.get('group'))!
  const childClone = result.document.content.nodes.find((node) => node.id === result.idMap.get('child'))!
  assert.deepEqual(groupClone.children, [childClone.id])
  assert.equal(childClone.parentId, groupClone.id)
  const original = result.document.content.nodes.find((node) => node.id === 'group')!
  assert.deepEqual(original.children, ['child'])
})

test('相机复制：lookAtTarget 在复制内外、运镜 metadata 重映射、曲线平移、isPrimary=false', () => {
  const doc = draft([character('actor'), camera('cam', 'actor'), camera('free')])
  doc.content.activeShotCameraNodeId = 'cam'
  doc.content.timeline.animation.cameraMotionClips.push(cameraClip('cc1', 'cam', 'actor'))
  const result = duplicateNodes({
    document: doc,
    userKeys: {},
    selectedIds: ['cam', 'actor', 'free'],
    delta: { position: [3, 0, 0] },
  })
  const camClone = result.document.content.nodes.find((node) => node.id === result.idMap.get('cam'))!
  const freeClone = result.document.content.nodes.find((node) => node.id === result.idMap.get('free'))!
  const actorCloneId = result.idMap.get('actor')!
  assert.equal(camClone.camera?.isPrimary, false)
  assert.equal(camClone.camera?.lookAtTarget?.nodeId, actorCloneId)
  assert.equal(freeClone.camera?.lookAt.x, 3)
  assert.equal(result.document.content.activeShotCameraNodeId, 'cam')
  const copied = result.document.content.timeline.animation.cameraMotionClips.find((clip) => clip.id !== 'cc1')!
  assert.equal(copied.target.nodeId, camClone.id)
  assert.equal(copied.motion.metadata.cameraNodeId, camClone.id)
  assert.equal(copied.motion.metadata.targetNodeId, actorCloneId)
  assert.equal(copied.motion.curves.find((curve) => curve.group === 'position')?.keyframes[0].value, 3)
  assert.equal(copied.motion.curves.find((curve) => curve.group === 'lookAt')?.keyframes[0].value, 4)
  assert.equal(copied.motion.curves.find((curve) => curve.group === 'lens')?.keyframes[0].value, 50)
})

test('FCurveSet.copyNode 生成新曲线 id 和新 key id，不改源', () => {
  const fc = FCurveSet.empty()
  fc.upsertKey('actor', 'transform.position', 0, 0, 1)
  const before = cloneJson(fc.encode())
  fc.copyNode('actor', 'actor_copy', (key, curve) => {
    if (curve.propPath === 'transform.position') key.value += 2
    return key
  })
  const dest = fc.tracksForNode('actor_copy')
  assert.equal(dest.length, 1)
  assert.equal(dest[0].id, 'fc_node_actor_copy_transform_position_0')
  assert.equal(dest[0].keys[0].value, 3)
  assert.notEqual(dest[0].keys[0].id, fc.tracksForNode('actor')[0].keys[0].id)
  assert.deepEqual(fc.encode().fcurves.filter((raw) => (raw as { t: [string, string] }).t[1] === 'actor'), before.fcurves)
})
