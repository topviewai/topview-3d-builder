import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  buildNodeSelection,
  isLookAtPickTarget,
  isPathApplyTarget,
  nodeIdsOf,
  poseEditEligibleId,
  toggleNodeIds,
  unlockedNodeIds,
} from '../../stores/nodeSelection'

test('toggleNodeIds：未选中则加入，已选中则去掉', () => {
  assert.deepEqual(toggleNodeIds(undefined, undefined, 'a'), ['a'])
  assert.deepEqual(toggleNodeIds(['a'], 'a', 'b'), ['a', 'b'])
  assert.deepEqual(toggleNodeIds(['a', 'b'], 'b', 'a'), ['b'])
})

test('buildNodeSelection：主选是数组最后一项，空数组清空', () => {
  assert.equal(buildNodeSelection([]), null)
  assert.deepEqual(buildNodeSelection(['a', 'b']), {
    kind: 'node',
    nodeId: 'b',
    nodeIds: ['a', 'b'],
  })
})

test('unlockedNodeIds：视口框选排除锁定节点并保持顺序去重', () => {
  const nodes = [
    { id: 'free', locked: false },
    { id: 'locked', locked: true },
    { id: 'other', locked: false },
  ]
  assert.deepEqual(unlockedNodeIds(nodes, ['locked', 'free', 'free', 'other']), ['free', 'other'])
})

test('nodeIdsOf：兼容只有 nodeId 的旧选中', () => {
  assert.deepEqual(nodeIdsOf({ kind: 'node', nodeId: 'a' }), ['a'])
  assert.deepEqual(nodeIdsOf({ kind: 'node', nodeId: 'b', nodeIds: ['a', 'b'] }), ['a', 'b'])
  assert.deepEqual(nodeIdsOf({ kind: 'clip', clipType: 'motion', clipId: 'x' }), [])
})

test('isPathApplyTarget：角色/机位/道具/基础形状可绑轨迹', () => {
  assert.equal(isPathApplyTarget({ type: 'character' }), true)
  assert.equal(isPathApplyTarget({ type: 'camera' }), true)
  assert.equal(isPathApplyTarget({ type: 'prop' }), true)
  assert.equal(isPathApplyTarget({ type: 'primitive' }), true)
  assert.equal(isPathApplyTarget({ type: 'path' }), false)
  assert.equal(isPathApplyTarget({ type: 'group' }), false)
})

test('isLookAtPickTarget：角色/道具/图元可绑，相机和自己不行', () => {
  assert.equal(isLookAtPickTarget({ id: 'c1', type: 'character', visible: true }, 'cam'), true)
  assert.equal(isLookAtPickTarget({ id: 'p1', type: 'prop', visible: true }, 'cam'), true)
  assert.equal(isLookAtPickTarget({ id: 'box', type: 'primitive', visible: true }, 'cam'), true)
  assert.equal(isLookAtPickTarget({ id: 'cam', type: 'character', visible: true }, 'cam'), false)
  assert.equal(isLookAtPickTarget({ id: 'cam2', type: 'camera', visible: true }, 'cam'), false)
  assert.equal(isLookAtPickTarget({ id: 'c1', type: 'character', visible: false }, 'cam'), false)
  assert.equal(isLookAtPickTarget({ id: 'c2', type: 'character', visible: true, locked: true }, 'cam'), false)
})

test('poseEditEligibleId：仅单选未锁定角色', () => {
  const nodes = [
    { id: 'c1', type: 'character' as const, visible: true, locked: false },
    { id: 'c2', type: 'character' as const, visible: true, locked: true },
    { id: 'p1', type: 'prop' as const, visible: true, locked: false },
  ]
  assert.equal(poseEditEligibleId(nodes, { kind: 'node', nodeId: 'c1', nodeIds: ['c1'] }), 'c1')
  assert.equal(poseEditEligibleId(nodes, { kind: 'node', nodeId: 'c2', nodeIds: ['c2'] }), null)
  assert.equal(poseEditEligibleId(nodes, { kind: 'node', nodeId: 'p1', nodeIds: ['p1'] }), null)
  assert.equal(poseEditEligibleId(nodes, { kind: 'node', nodeId: 'c1', nodeIds: ['c1', 'p1'] }), null)
})
