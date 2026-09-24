import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DraftNode } from '../../contract/types'
import { makeKeyframe } from '../curves/KeyframeTrack'
import { FCurveSet } from '../curves/FCurveSet'
import { isDerivedTransformPath, rederiveWalkPaths } from '../path/deriveWalk'
import { sceneFromDocument } from '../sceneFromDocument'
import { overlayStagedTransform } from '../stagedTransform'
import { evalAt } from './helpers'

function charNode(id: string): DraftNode {
  return {
    id,
    type: 'character',
    name: id,
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    character: {
      placeholder: false,
      gender: 'unknown',
      motionId: null,
      appearance: { color: '#fff' },
      label: { showLabel: true, scale: 1, yOffset: 0 },
      animation: { mode: 'pose', posePresetId: 'tpose', controlValues: {} },
    },
  }
}

test('userKeys：两键之间线性插值，末键之后钉住最后一键', () => {
  const doc = makeEmptyDraft('uk-eval', 30, 120)
  doc.content.nodes.push(charNode('actor'))
  const scene = sceneFromDocument(doc, {
    fcurves: null,
    userKeys: { actor: { position: [makeKeyframe(0, [0, 0, 0]), makeKeyframe(40, [4, 0, 8])] } },
    userKeysEnabled: true,
    chainCameraMotion: false,
  })
  const posX = (f: number) => evalAt(scene, f).transforms.get('actor')!.position
  assert.deepEqual([posX(0).x, posX(0).z], [0, 0])
  assert.deepEqual([posX(20).x, posX(20).z], [2, 4])
  assert.deepEqual([posX(40).x, posX(40).z], [4, 8])
  assert.deepEqual([posX(60).x, posX(60).z], [4, 8])
})

test('userKeys 单键：所在帧之前回退静态，之后钉住该键', () => {
  const doc = makeEmptyDraft('uk-eval-single', 30, 120)
  doc.content.nodes.push(charNode('actor'))
  const scene = sceneFromDocument(doc, {
    fcurves: null,
    userKeys: { actor: { position: [makeKeyframe(10, [1, 2, 3])] } },
    userKeysEnabled: true,
    chainCameraMotion: false,
  })
  const pos = (f: number) => evalAt(scene, f).transforms.get('actor')!.position
  assert.deepEqual([pos(10).x, pos(10).y, pos(10).z], [1, 2, 3])
  assert.deepEqual([pos(0).x, pos(0).y, pos(0).z], [0, 0, 0])
  assert.deepEqual([pos(20).x, pos(20).y, pos(20).z], [1, 2, 3])
})

test('派生轨迹覆盖帧：角色朝向跟随路径方向，旋转用户键让路', () => {
  const doc = makeEmptyDraft('uk-facing', 30, 120)
  doc.content.nodes.push(charNode('actor'))
  const position = [makeKeyframe(0, [0, 0, 0]), makeKeyframe(40, [4, 0, 0])]
  const rotation = [makeKeyframe(0, [0, 45, 0]), makeKeyframe(40, [0, 45, 0])]
  rederiveWalkPaths(doc, 'actor', FCurveSet.empty(), { actor: { position } })

  const scene = sceneFromDocument(doc, {
    fcurves: null,
    userKeys: { actor: { position, rotation } },
    userKeysEnabled: true,
    chainCameraMotion: false,
  })
  const yawAt = (f: number) => evalAt(scene, f).transforms.get('actor')!.rotation.y

  // 参照：无旋转键时纯路径朝向
  const sceneNoRot = sceneFromDocument(doc, {
    fcurves: null,
    userKeys: { actor: { position } },
    userKeysEnabled: true,
    chainCameraMotion: false,
  })
  const pathYaw = evalAt(sceneNoRot, 20).transforms.get('actor')!.rotation.y

  assert.ok(pathYaw !== 45) // 路径朝向 ≠ 旋转键值
  assert.equal(yawAt(20), pathYaw) // 派生轨迹覆盖帧：朝向跟随路径，旋转键让路
  // 派生区间 [0,40) 之外但在关键帧范围内（末帧 40）：旋转键生效
  assert.equal(yawAt(40), 45)
})

test('关键帧派生轨迹带 transform-keyframes 标记，不能当独立对象选中', () => {
  const doc = makeEmptyDraft('uk-derived-flag', 30, 120)
  doc.content.nodes.push(charNode('actor'))
  rederiveWalkPaths(doc, 'actor', FCurveSet.empty(), {
    actor: { position: [makeKeyframe(0, [0, 0, 0]), makeKeyframe(10, [2, 0, 0])] },
  })
  const path = doc.content.nodes.find((n) => n.type === 'path')
  assert.equal(isDerivedTransformPath(path), true)
  assert.equal(isDerivedTransformPath(doc.content.nodes.find((n) => n.id === 'actor')), false)
})

test('staged overlay 盖住已求值的 userKeys，其它节点 touch 后 live 位姿不会弹回旧键', () => {
  const doc = makeEmptyDraft('uk-staged-overlay', 30, 120)
  doc.content.nodes.push(charNode('actor'))
  const scene = sceneFromDocument(doc, {
    fcurves: null,
    userKeys: { actor: { position: [makeKeyframe(10, [0, 0, 0])] } },
    userKeysEnabled: true,
    chainCameraMotion: false,
  })
  const xf = evalAt(scene, 10).transforms.get('actor')!
  assert.deepEqual([xf.position.x, xf.position.y, xf.position.z], [0, 0, 0])
  overlayStagedTransform(xf, { position: { x: 4, y: 0, z: 1 } })
  assert.deepEqual([xf.position.x, xf.position.y, xf.position.z], [4, 0, 1])
})

test('userKeys Constant Hold after last wins over underlying fcurves (no drift)', () => {
  const doc = makeEmptyDraft('uk-hold-over-fcurves', 30, 120)
  doc.content.nodes.push(charNode('actor'))
  const fcurves = FCurveSet.empty()
  // Underlying fcurve keeps moving past frame 40 — without hold, scrubbing to 60 would drift.
  fcurves.upsertKey('actor', 'transform.position', 0, 0, 0)
  fcurves.upsertKey('actor', 'transform.position', 0, 80, 10)
  const scene = sceneFromDocument(doc, {
    fcurves,
    userKeys: { actor: { position: [makeKeyframe(0, [0, 0, 0]), makeKeyframe(40, [4, 0, 8])] } },
    userKeysEnabled: true,
    chainCameraMotion: false,
  })
  const pos = (f: number) => evalAt(scene, f).transforms.get('actor')!.position
  assert.deepEqual([pos(40).x, pos(40).z], [4, 8])
  assert.deepEqual([pos(60).x, pos(60).z], [4, 8])
  assert.deepEqual([pos(80).x, pos(80).z], [4, 8])
})
