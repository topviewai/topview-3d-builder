// 相机移动时的朝向：注视点是世界坐标，位置一动却把它钉在原地，相机就会绕着它转
// ——这就是「移动时朝向乱漂」。除了看点被显式驱动（lookAtTarget / 看点曲线 / 看点
// 关键帧），任何只驱动位置的通道都必须让注视点等量位移，视线方向逐帧不变。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DraftNode, PathMotionClip } from '../../contract/types'
import { makeKeyframe } from '../curves/KeyframeTrack'
import { FCurveSet } from '../curves/FCurveSet'
import { sceneFromDocument } from '../sceneFromDocument'
import type { SceneContract, TransformValue } from '../FrameSnapshot'
import { evalAt } from './helpers'

function camNode(): DraftNode {
  return {
    id: 'cam',
    type: 'camera',
    name: '机位',
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
      lookAt: { x: 0, y: 1.2, z: 0 },
    },
  }
}

function propNode(): DraftNode {
  return {
    id: 'prop1',
    type: 'prop',
    name: '道具',
    visible: true,
    locked: false,
    transform: {
      position: { x: 5, y: 0, z: -3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }
}

/** 斜向折线轨迹：三轴都在动，任何一轴漏掉都会露出来 */
function pathNode(): DraftNode {
  return {
    id: 'path1',
    type: 'path',
    name: '走位',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    path: {
      source: 'draw',
      curve: 'polyline',
      closed: false,
      groundSnap: false,
      parameterization: 'time-ratio',
      smoothing: 0,
      points: [
        { id: 'p0', position: { x: 0, y: 1.6, z: 4 }, timeRatio: 0 },
        { id: 'p1', position: { x: 6, y: 3.2, z: -2 }, timeRatio: 1 },
      ],
    },
  }
}

function pathClip(): PathMotionClip {
  return {
    id: 'p-clip',
    status: 'ready',
    locked: false,
    source: 'draw',
    target: { type: 'camera', nodeId: 'cam' },
    pathNodeId: 'path1',
    pathName: '走位',
    pathLength: 10,
    pathStartPercent: 0,
    pathEndPercent: 100,
    direction: 'forward',
    facing: 'none',
    frameStart: 0,
    frameEnd: 60,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: 60 },
  }
}

/** 视线方向：注视点 - 位置。朝向不变 ⇔ 该向量逐帧不变 */
function aimOf(xf: TransformValue): [number, number, number] {
  const look = xf.lookAt!
  return [look.x - xf.position.x, look.y - xf.position.y, look.z - xf.position.z]
}

function camAt(scene: SceneContract, frame: number): TransformValue {
  return evalAt(scene, frame).transforms.get('cam')!
}

function assertAimHeld(scene: SceneContract, frames: number[], moved = true): void {
  const base = camAt(scene, frames[0])
  const aim = aimOf(base)
  // 静态朝向：机位 (0,1.6,4) 看 (0,1.2,0)
  assert.deepEqual(aim.map((v) => Number(v.toFixed(6))), [0, -0.4, -4])
  for (const frame of frames.slice(1)) {
    const xf = camAt(scene, frame)
    const next = aimOf(xf)
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(next[i] - aim[i]) < 1e-9, `frame ${frame} 轴 ${i} 朝向漂了：${next[i]} ≠ ${aim[i]}`)
    }
    if (moved) {
      assert.ok(
        Math.abs(xf.position.x - base.position.x) > 1e-6,
        `frame ${frame} 相机没动，这条断言没验到东西`,
      )
    }
  }
}

test('走位驱动机位：位置变、朝向不变', () => {
  const doc = makeEmptyDraft('cam-aim-path', 30, 120)
  doc.content.nodes.push(camNode(), pathNode())
  doc.content.timeline.animation.pathMotionClips.push(pathClip())
  const scene = sceneFromDocument(doc, { fcurves: null, chainCameraMotion: false })
  assertAimHeld(scene, [0, 15, 30, 45, 60])
})

test('位置关键帧驱动机位：位置变、朝向不变', () => {
  const doc = makeEmptyDraft('cam-aim-uk', 30, 120)
  doc.content.nodes.push(camNode())
  const scene = sceneFromDocument(doc, {
    fcurves: null,
    userKeys: {
      cam: { position: [makeKeyframe(0, [0, 1.6, 4]), makeKeyframe(60, [6, 3.2, -2])] },
    },
    userKeysEnabled: true,
    chainCameraMotion: false,
  })
  assertAimHeld(scene, [0, 20, 40, 60])
})

test('位置 fcurve 驱动机位：没有看点曲线时朝向不变', () => {
  const doc = makeEmptyDraft('cam-aim-fc', 30, 120)
  doc.content.nodes.push(camNode())
  const fcurves = FCurveSet.empty()
  fcurves.upsertKey('cam', 'transform.position', 0, 0, 0)
  fcurves.upsertKey('cam', 'transform.position', 0, 60, 6)
  fcurves.upsertKey('cam', 'transform.position', 1, 0, 1.6)
  fcurves.upsertKey('cam', 'transform.position', 1, 60, 3.2)
  const scene = sceneFromDocument(doc, { fcurves, chainCameraMotion: false })
  assertAimHeld(scene, [0, 20, 40, 60])
})

test('看点曲线存在时该轴仍归曲线，不被位移覆盖', () => {
  const doc = makeEmptyDraft('cam-aim-fc-look', 30, 120)
  doc.content.nodes.push(camNode())
  const fcurves = FCurveSet.empty()
  fcurves.upsertKey('cam', 'transform.position', 0, 0, 0)
  fcurves.upsertKey('cam', 'transform.position', 0, 60, 6)
  fcurves.upsertKey('cam', 'camera.lookAt', 0, 0, 2)
  fcurves.upsertKey('cam', 'camera.lookAt', 0, 60, 2)
  const scene = sceneFromDocument(doc, { fcurves, chainCameraMotion: false })
  for (const frame of [0, 30, 60]) {
    assert.equal(camAt(scene, frame).lookAt!.x, 2, `frame ${frame} 看点曲线被位移盖掉了`)
  }
})

test('钉了看点目标：移动时朝向跟着目标转（唯一允许改朝向的情况）', () => {
  const doc = makeEmptyDraft('cam-aim-target', 30, 120)
  const cam = camNode()
  cam.camera!.lookAtTarget = { nodeId: 'prop1' }
  doc.content.nodes.push(cam, propNode(), pathNode())
  doc.content.timeline.animation.pathMotionClips.push(pathClip())
  const scene = sceneFromDocument(doc, { fcurves: null, chainCameraMotion: false })
  const start = aimOf(camAt(scene, 0))
  const end = aimOf(camAt(scene, 60))
  assert.ok(
    Math.abs(start[0] - end[0]) > 1e-3 || Math.abs(start[2] - end[2]) > 1e-3,
    '钉了看点目标却没改朝向',
  )
  // 注视点始终落在目标上（characterLookAtPoint 默认抬到胸口高度）
  for (const frame of [0, 30, 60]) {
    const look = camAt(scene, frame).lookAt!
    assert.equal(look.x, 5)
    assert.equal(look.z, -3)
  }
})
