import assert from 'node:assert/strict'
import { test } from 'vitest'
import { makeKeyframe } from '../../../evaluate/curves/KeyframeTrack'
import type { UserKeys } from '../../../evaluate/curves/KeyframeTrack'
import type { Selection } from '../../../stores/types'
import {
  bundlePreviewOffset,
  isGroupKeyframeSelected,
  isKeyframeHighlighted,
  keyframePreviewOffset,
  nextKeyframeSelection,
  selectedKeyframeDragItems,
  userKeyRefsAtFrame,
} from '../utils'

const pos = makeKeyframe(10, [1, 0, 0])
const rot = makeKeyframe(10, [0, 90, 0])
const scale = makeKeyframe(10, [1, 1, 1])
const posLater = makeKeyframe(24, [2, 0, 0])

const userKeys: UserKeys = {
  actor: {
    position: [pos, posLater],
    rotation: [rot],
    scale: [scale],
  },
}

const transformSel: Selection = { kind: 'transformKeyframe', nodeId: 'actor', frame: 10 }

test('userKeyRefsAtFrame 收集同帧全部变换子键', () => {
  const refs = userKeyRefsAtFrame(userKeys, 'actor', 10)
  assert.deepEqual(
    refs.map((r) => r.prop).sort(),
    ['position', 'rotation', 'scale'],
  )
  assert.equal(userKeyRefsAtFrame(userKeys, 'actor', 24).length, 1)
  assert.equal(userKeyRefsAtFrame(userKeys, 'missing', 10).length, 0)
})

test('选中变换总关键帧时，同节点同帧的子关键帧全部高亮', () => {
  assert.equal(
    isKeyframeHighlighted(transformSel, { keyId: pos.id, nodeId: 'actor', frame: 10 }),
    true,
  )
  assert.equal(
    isKeyframeHighlighted(transformSel, { keyId: rot.id, nodeId: 'actor', frame: 10 }),
    true,
  )
  assert.equal(
    isKeyframeHighlighted(transformSel, { keyId: scale.id, nodeId: 'actor', frame: 10 }),
    true,
  )
})

test('变换总关键帧不会高亮其它帧或其它节点的子键', () => {
  assert.equal(
    isKeyframeHighlighted(transformSel, { keyId: posLater.id, nodeId: 'actor', frame: 24 }),
    false,
  )
  assert.equal(
    isKeyframeHighlighted(transformSel, { keyId: pos.id, nodeId: 'other', frame: 10 }),
    false,
  )
})

test('显式 keyframe 多选仍按 keyId 高亮', () => {
  const sel: Selection = {
    kind: 'keyframe',
    nodeId: 'actor',
    prop: 'rotation',
    keyId: rot.id,
    keys: [
      { nodeId: 'actor', prop: 'position', keyId: pos.id },
      { nodeId: 'actor', prop: 'rotation', keyId: rot.id },
    ],
  }
  assert.equal(isKeyframeHighlighted(sel, { keyId: pos.id, nodeId: 'actor', frame: 10 }), true)
  assert.equal(isKeyframeHighlighted(sel, { keyId: scale.id, nodeId: 'actor', frame: 10 }), false)
})

test('总关键帧选中或子键全选时，组钻石视为选中', () => {
  const refs = userKeyRefsAtFrame(userKeys, 'actor', 10)
  assert.equal(isGroupKeyframeSelected(transformSel, 'actor', 10, refs), true)
  assert.equal(isGroupKeyframeSelected(transformSel, 'actor', 24, refs), false)
  const boxed: Selection = {
    kind: 'keyframe',
    nodeId: 'actor',
    prop: 'scale',
    keyId: scale.id,
    keys: refs,
  }
  assert.equal(isGroupKeyframeSelected(boxed, 'actor', 10, refs), true)
})

test('点已高亮的子关键帧保持变换总选中，便于整组一起拖', () => {
  const next = nextKeyframeSelection(
    transformSel,
    { nodeId: 'actor', prop: 'position', keyId: pos.id },
    false,
    10,
  )
  assert.deepEqual(next, transformSel)
})

test('点其它帧的子关键帧会改成单键选中', () => {
  const next = nextKeyframeSelection(
    transformSel,
    { nodeId: 'actor', prop: 'position', keyId: posLater.id },
    false,
    24,
  )
  assert.equal(next.kind, 'keyframe')
  if (next.kind !== 'keyframe') return
  assert.equal(next.nodeId, 'actor')
  assert.equal(next.prop, 'position')
  assert.equal(next.keyId, posLater.id)
  assert.equal(next.keys, undefined)
})

test('selectedKeyframeDragItems 从总关键帧展开全部同帧子键', () => {
  const items = selectedKeyframeDragItems(transformSel, userKeys)
  assert.equal(items.length, 3)
  assert.deepEqual(
    items.map((item) => item.prop).sort(),
    ['position', 'rotation', 'scale'],
  )
  assert.ok(items.every((item) => item.origFrame === 10))
})

test('拖拽预览只作用在本次拖动集合里的钻石', () => {
  const dragging = new Set([pos.id, rot.id, scale.id])
  assert.equal(keyframePreviewOffset(4, pos.id, dragging), 4)
  assert.equal(keyframePreviewOffset(4, posLater.id, dragging), 0)
  assert.equal(keyframePreviewOffset(null, pos.id, dragging), 0)
  assert.equal(bundlePreviewOffset(4, [pos.id, rot.id, scale.id], dragging), 4)
  assert.equal(bundlePreviewOffset(4, [pos.id, rot.id, scale.id], new Set([pos.id])), 0)
})
