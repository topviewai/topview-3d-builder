import assert from 'node:assert/strict'
import { test } from 'vitest'
import { makeEmptyDraft } from '../../../contract/emptyDraft'
import type { CameraMotionClip, DraftNode, MotionClip, PathMotionClip } from '../../../contract/types'
import { buildTree } from '../utils'

const t = (key: string): string => key

function sphere(): DraftNode {
  return {
    id: 'sphere_1',
    type: 'primitive',
    name: '球体',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    primitive: { kind: 'SphereGeometry', parameters: { radius: 0.6 } },
  }
}

function walkClip(): PathMotionClip {
  return {
    id: 'walk',
    status: 'active',
    locked: false,
    source: 'semantic',
    target: { type: 'node', nodeId: 'sphere_1' },
    pathNodeId: 'path_1',
    pathName: '轨迹1',
    pathLength: 2,
    pathStartPercent: 0,
    pathEndPercent: 100,
    direction: 'forward',
    facing: 'path-tangent',
    frameStart: 0,
    frameEnd: 30,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'once', baseDurationFrames: 30 },
  }
}

test('基础形状有走位 clip 时进入时间轴并带轨迹轨', () => {
  const doc = makeEmptyDraft('tree', 30, 120)
  doc.content.nodes.push(sphere())
  doc.content.timeline.animation.pathMotionClips = [walkClip()]
  const rows = buildTree(doc, t)
  const root = rows.find((r) => r.key === 'sphere_1')
  assert.ok(root)
  assert.equal(root?.children?.some((c) => c.kind === 'clips-path'), true)
})

test('没有关键帧也没有走位的基础形状不占时间轴', () => {
  const doc = makeEmptyDraft('tree', 30, 120)
  doc.content.nodes.push(sphere())
  const rows = buildTree(doc, t)
  assert.equal(rows.some((r) => r.key === 'sphere_1'), false)
})

test('选中的基础形状即使没关键帧也入轨，带变换组', () => {
  const doc = makeEmptyDraft('tree', 30, 120)
  doc.content.nodes.push(sphere())
  const rows = buildTree(doc, t, ['sphere_1'])
  const root = rows.find((r) => r.key === 'sphere_1')
  assert.ok(root)
  assert.equal(root?.children?.some((c) => c.kind === 'group'), true)
  const xform = root?.children?.find((c) => c.kind === 'group')
  assert.deepEqual(xform?.addTransformKeys, ['position', 'rotation', 'scale'])
})

test('未选中且无关键帧的道具不入轨；打过关键帧后常驻', () => {
  const doc = makeEmptyDraft('tree', 30, 120)
  doc.content.nodes.push({
    id: 'prop_1',
    type: 'prop',
    name: '椅子',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    prop: { category: 'furniture' },
  })
  assert.equal(buildTree(doc, t).some((r) => r.key === 'prop_1'), false)
  const keyed = buildTree(doc, t, null, {
    prop_1: { position: [{ id: 'k1', frame: 0, value: [0, 0, 0], interpolation: 'linear' }] },
  })
  assert.ok(keyed.find((r) => r.key === 'prop_1'))
})

function actor(id: string, name: string): DraftNode {
  return {
    id,
    type: 'character',
    name,
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    character: {
      placeholder: false,
      gender: 'female',
      motionId: null,
      appearance: { color: '#fff' },
      label: { showLabel: true, scale: 1, yOffset: 0 },
      animation: { mode: 'pose', posePresetId: 'tpose', controlValues: {} },
    },
  }
}

test('多选人物时所有人物均常驻全局可见，不因选中而被收起过滤', () => {
  const doc = makeEmptyDraft('tree', 30, 120)
  doc.content.nodes.push(actor('a', '甲'), actor('b', '乙'), actor('c', '丙'))
  const rows = buildTree(doc, t, ['a', 'b'])
  const ids = rows.filter((r) => r.kind === 'node').map((r) => r.key)
  assert.deepEqual(ids, ['a', 'b', 'c'])
})

test('单选仍保持所有人物常驻全局可见（兼容传字符串）', () => {
  const doc = makeEmptyDraft('tree', 30, 120)
  doc.content.nodes.push(actor('a', '甲'), actor('b', '乙'))
  const rows = buildTree(doc, t, 'b')
  assert.deepEqual(rows.filter((r) => r.kind === 'node').map((r) => r.key), ['a', 'b'])
})

test('选中角色时相机与所有角色均常驻全局可见，顺序稳定保持相机在前', () => {
  const doc = makeEmptyDraft('tree', 30, 120, {
    fov: 50,
    position: { x: 0, y: 1, z: 5 },
    rotation: { x: 0, y: 0, z: 0 },
    lookAt: { x: 0, y: 0, z: 0 },
  })
  doc.content.nodes.push(actor('a', '甲'), actor('b', '乙'))
  const rows = buildTree(doc, t, 'a')
  const ids = rows.filter((r) => r.kind === 'node').map((r) => r.key)
  assert.deepEqual(ids, ['camera_1', 'a', 'b'])
})

const cameraPose = {
  fov: 50,
  position: { x: 0, y: 1, z: 5 },
  rotation: { x: 0, y: 0, z: 0 },
  lookAt: { x: 0, y: 0, z: 0 },
}

function childKinds(doc: ReturnType<typeof makeEmptyDraft>, nodeId: string): string[] {
  return buildTree(doc, t).find((r) => r.key === nodeId)?.children?.map((c) => c.kind) ?? []
}

test('没加运镜、动作、轨迹时不占时间轴行', () => {
  const doc = makeEmptyDraft('tree', 30, 120, cameraPose)
  doc.content.nodes.push(actor('a', '甲'))
  assert.deepEqual(childKinds(doc, 'camera_1'), ['group'])
  assert.deepEqual(childKinds(doc, 'a'), ['group'])
})

test('加过运镜、动作、用户轨迹后才显示对应行', () => {
  const doc = makeEmptyDraft('tree', 30, 120, cameraPose)
  doc.content.nodes.push(actor('a', '甲'))
  doc.content.timeline.animation.cameraMotionClips = [
    { id: 'orbit', target: { type: 'node', nodeId: 'camera_1' } } as CameraMotionClip,
  ]
  doc.content.timeline.animation.motionClips = [
    { id: 'walk', target: { type: 'node', nodeId: 'a' } } as MotionClip,
  ]
  doc.content.timeline.animation.pathMotionClips = [
    { ...walkClip(), id: 'user-path', target: { type: 'node', nodeId: 'a' } },
  ]
  assert.ok(childKinds(doc, 'camera_1').includes('clips-camera'))
  assert.ok(childKinds(doc, 'a').includes('clips-motion'))
  assert.ok(childKinds(doc, 'a').includes('clips-path'))
})

test('位移关键帧派生的走位不占轨迹行', () => {
  const doc = makeEmptyDraft('tree', 30, 120)
  doc.content.nodes.push(actor('a', '甲'))
  doc.content.timeline.animation.pathMotionClips = [
    {
      ...walkClip(),
      id: 'derived',
      target: { type: 'node', nodeId: 'a' },
      lockedReason: 'derived-from-keyframes',
    },
  ]
  assert.equal(childKinds(doc, 'a').includes('clips-path'), false)
})
