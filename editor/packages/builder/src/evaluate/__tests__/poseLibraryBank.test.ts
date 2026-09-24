import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  defaultPoseLibraryPoseId,
  getPoseLibraryPose,
  isPoseLibraryPoseSelected,
  listPoseLibraryPoses,
  listPoseLibraryTags,
  POSE_LIBRARY_TAG_ORDER,
  poseLibraryRootOffset,
  poseRecordFromLibrary,
  applyPoseBones,
  setPoseLibraryBank,
} from '../../data/poseLibraryBank'
import type { PoseLibraryRecord } from '../../data/poseLibraryBank'

const T_POSE: PoseLibraryRecord = {
  id: 't-pose',
  name: 'T-Pose',
  nameZh: 'Tpose',
  tag: 'common',
  tags: ['common'],
  rank: 1,
  hips: [0, 0, 0],
  bones: {},
  bonesLoaded: true,
}

const STAND: PoseLibraryRecord = {
  id: 'stand-arms-down',
  name: 'Arms Down',
  nameZh: '双臂自然下垂',
  tag: 'stand',
  tags: ['stand'],
  rank: 2,
  hips: [0, -0.01, 0],
  bones: { mixamorigHips: [0, 0, 0, 1] },
  bonesLoaded: true,
}

const SIT: PoseLibraryRecord = {
  id: 'sit-arms-resting-on-knees',
  name: 'Sit',
  nameZh: '坐',
  tag: 'sit',
  tags: ['sit'],
  rank: 3,
  hips: [0, -0.8, 0],
  bones: { mixamorigHips: [0, 0, 0, 1] },
  bonesLoaded: true,
}

function installBank(): void {
  setPoseLibraryBank([T_POSE, STAND, SIT])
}

test('姿势表只认注入数据，默认取 rank 最小项', () => {
  setPoseLibraryBank([])
  assert.equal(listPoseLibraryPoses().length, 0)
  assert.equal(defaultPoseLibraryPoseId(), undefined)
  installBank()
  assert.deepEqual([...POSE_LIBRARY_TAG_ORDER], ['stand', 'sit', 'lie', 'move', 'action'])
  assert.equal(defaultPoseLibraryPoseId(), 't-pose')
  assert.ok(getPoseLibraryPose('t-pose'))
  assert.equal(listPoseLibraryPoses('sit').length, 1)
  assert.equal(listPoseLibraryPoses('common').length, 1)
  assert.deepEqual(listPoseLibraryTags(), ['stand', 'sit', 'common'])
})

test('髋骨差分相对默认姿势，未知 id 返回 null', () => {
  installBank()
  assert.deepEqual(poseLibraryRootOffset('t-pose'), { x: 0, y: 0, z: 0 })
  const sit = poseLibraryRootOffset('sit-arms-resting-on-knees')
  assert.ok(sit && sit.y < -0.5)
  assert.equal(poseLibraryRootOffset('stand'), null)
})

test('叠加标签同时出现在对应分类，页签只来自数据', () => {
  setPoseLibraryBank([
    T_POSE,
    { ...STAND, tags: ['stand', 'common'] },
    SIT,
  ])
  assert.deepEqual(
    listPoseLibraryPoses('common').map((pose) => pose.id),
    ['t-pose', 'stand-arms-down'],
  )
  assert.deepEqual(
    listPoseLibraryPoses('stand').map((pose) => pose.id),
    ['stand-arms-down'],
  )
})

test('选中只按精确 id，不做 tpose 别名', () => {
  installBank()
  assert.equal(isPoseLibraryPoseSelected('tpose', 't-pose'), false)
  assert.equal(isPoseLibraryPoseSelected('t-pose', 't-pose'), true)
})

test('目录行可以没有骨骼，点选后再写入 bones', () => {
  assert.equal(poseRecordFromLibrary({ id: '', name: 'bad' }), null)
  const kneeling = poseRecordFromLibrary({ id: 'kneel', name: 'Kneel', tag: 'kneel' })
  assert.equal(kneeling?.tag, 'kneel')
  assert.deepEqual(kneeling?.tags, ['kneel'])
  const catalog = poseRecordFromLibrary({
    id: 'wave',
    name: 'Wave',
    modelUrl: 'https://cdn.example/wave.json',
  })
  assert.equal(catalog?.id, 'wave')
  assert.equal(catalog?.tag, '')
  assert.deepEqual(catalog?.tags, [])
  assert.equal(catalog?.bonesLoaded, false)
  setPoseLibraryBank([catalog!])
  applyPoseBones('wave', [0, 1, 0], {})
  assert.equal(getPoseLibraryPose('wave')?.bonesLoaded, true)
  setPoseLibraryBank([])
  applyPoseBones('sit-only', [0, -0.5, 0], { mixamorigHips: [0, 0, 0, 1] })
  const stub = getPoseLibraryPose('sit-only')
  assert.equal(stub?.bonesLoaded, true)
  assert.equal(stub?.tag, '')
  assert.deepEqual(stub?.tags, [])
  assert.deepEqual(listPoseLibraryTags(), [])
})
