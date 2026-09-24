import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { BakedCurve, CameraMotionClip, DraftNode, PathMotionClip } from '../../contract/types'
import { makeKeyframe } from '../curves/KeyframeTrack'
import { FCurveSet } from '../curves/FCurveSet'
import { sceneFromDocument } from '../sceneFromDocument'
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

function posCurve(from: number, to: number): BakedCurve {
  return {
    id: 'pos-x',
    group: 'position',
    dataPath: 'camera.position',
    arrayIndex: 0,
    extrapolation: 'constant',
    keyframes: [
      { id: 'a', time: 0, value: from, interpolation: 'linear' },
      { id: 'b', time: 1000, value: to, interpolation: 'linear' },
    ],
  }
}

function motionClip(): CameraMotionClip {
  return {
    id: 'm1',
    target: { type: 'camera', nodeId: 'cam' },
    frameStart: 0,
    frameEnd: 30,
    trimStartMs: 0,
    trimEndMs: 1000,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: 30 },
    motion: {
      id: 'dolly',
      version: 1,
      presetId: 'dolly',
      label: 'dolly',
      timeUnit: 'ms',
      durationMs: 1000,
      curves: [posCurve(0, 10)],
    },
  }
}

/** 直线走位轨迹：x 从 100 走到 200，y/z 与机位静态值一致，便于逐帧对数 */
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
        { id: 'p0', position: { x: 100, y: 1.6, z: 4 }, timeRatio: 0 },
        { id: 'p1', position: { x: 200, y: 1.6, z: 4 }, timeRatio: 1 },
      ],
    },
  }
}

/** 走位片段 [20, 60]，与 [0, 30] 的运镜片段在 [20, 30] 重叠 */
function pathClip(lockedReason?: string): PathMotionClip {
  return {
    id: 'p-clip',
    status: 'ready',
    locked: false,
    lockedReason,
    source: 'draw',
    target: { type: 'camera', nodeId: 'cam' },
    pathNodeId: 'path1',
    pathName: '走位',
    pathLength: 100,
    pathStartPercent: 0,
    pathEndPercent: 100,
    direction: 'forward',
    facing: 'none',
    frameStart: 20,
    frameEnd: 60,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: 40 },
  }
}

function arbiterScene(lockedReason?: string) {
  const doc = makeEmptyDraft('cam-motion-path-arbiter', 30, 120)
  doc.content.nodes.push(camNode(), pathNode())
  doc.content.timeline.animation.cameraMotionClips.push(motionClip())
  doc.content.timeline.animation.pathMotionClips.push(pathClip(lockedReason))
  const fcurves = FCurveSet.empty()
  // 关键帧全程想把 x 拉到 50 / 99，任何时段都不该出现
  fcurves.upsertKey('cam', 'transform.position', 0, 0, 50)
  fcurves.upsertKey('cam', 'transform.position', 0, 120, 50)
  return sceneFromDocument(doc, {
    fcurves,
    userKeys: {
      cam: { position: [makeKeyframe(0, [99, 1.6, 4]), makeKeyframe(120, [99, 1.6, 4])] },
    },
    userKeysEnabled: true,
    chainCameraMotion: false,
  })
}

test('分时仲裁：重叠时段运镜独占，遮蔽路径走位', () => {
  const scene = arbiterScene()
  const xf = evalAt(scene, 25).transforms.get('cam')!
  // 运镜在 frame 25 的值 = 10 * (25/30)；路径此刻会给 112.5
  assert.ok(Math.abs(xf.position.x - 10 * (25 / 30)) < 1e-6, `got ${xf.position.x}`)
  assert.equal(xf.position.z, 4)
})

test('分时仲裁：运镜片段之外路径走位接管驱动机位', () => {
  const scene = arbiterScene()
  // frame 45：路径进度 (45-20)/40 = 0.625 → x = 100 + 62.5
  const xf = evalAt(scene, 45).transforms.get('cam')!
  assert.ok(Math.abs(xf.position.x - 162.5) < 1e-6, `got ${xf.position.x}`)
  assert.equal(xf.position.y, 1.6)
  assert.equal(xf.position.z, 4)
})

test('分时仲裁：三条轨都不在场的帧仍回落静态（关键帧持续失效）', () => {
  const scene = arbiterScene()
  const xf = evalAt(scene, 90).transforms.get('cam')!
  assert.deepEqual([xf.position.x, xf.position.y, xf.position.z], [0, 1.6, 4])
})

test('分时仲裁：关键帧派生的轨迹随关键帧一起挂起，不从侧门接管', () => {
  const scene = arbiterScene('derived-from-keyframes')
  const xf = evalAt(scene, 45).transforms.get('cam')!
  assert.deepEqual([xf.position.x, xf.position.y, xf.position.z], [0, 1.6, 4])
})

/** 无运镜：只有走位片段 [20,60] 与一条贯穿全程的位置关键帧轨（x = frame） */
function handoffScene() {
  const doc = makeEmptyDraft('cam-path-keyframe-handoff', 30, 120)
  doc.content.nodes.push(camNode(), pathNode())
  doc.content.timeline.animation.pathMotionClips.push(pathClip())
  return sceneFromDocument(doc, {
    fcurves: null,
    userKeys: {
      cam: { position: [makeKeyframe(0, [0, 1.6, 4]), makeKeyframe(120, [120, 1.6, 4])] },
    },
    userKeysEnabled: true,
    chainCameraMotion: false,
  })
}

test('无运镜：走位片段内由轨迹独占驱动，盖过同帧关键帧', () => {
  const xf = evalAt(handoffScene(), 45).transforms.get('cam')!
  // 关键帧此刻是 45，轨迹是 100 + 0.625 * 100
  assert.ok(Math.abs(xf.position.x - 162.5) < 1e-6, `got ${xf.position.x}`)
  assert.equal(xf.position.y, 1.6)
})

test('无运镜：走位片段之前由关键帧驱动', () => {
  const xf = evalAt(handoffScene(), 10).transforms.get('cam')!
  assert.ok(Math.abs(xf.position.x - 10) < 1e-6, `got ${xf.position.x}`)
})

test('无运镜：走位片段之后关键帧接力驱动', () => {
  const xf = evalAt(handoffScene(), 90).transforms.get('cam')!
  assert.ok(Math.abs(xf.position.x - 90) < 1e-6, `got ${xf.position.x}`)
})

test('无运镜：派生轨迹让位给关键帧本身，不重复算两遍', () => {
  const doc = makeEmptyDraft('cam-derived-vs-keys', 30, 120)
  doc.content.nodes.push(camNode(), pathNode())
  doc.content.timeline.animation.pathMotionClips.push(pathClip('derived-from-keyframes'))
  const scene = sceneFromDocument(doc, {
    fcurves: null,
    userKeys: {
      cam: { position: [makeKeyframe(0, [0, 1.6, 4]), makeKeyframe(120, [120, 1.6, 4])] },
    },
    userKeysEnabled: true,
    chainCameraMotion: false,
  })
  const xf = evalAt(scene, 45).transforms.get('cam')!
  assert.ok(Math.abs(xf.position.x - 45) < 1e-6, `got ${xf.position.x}`)
})

test('运镜优先：片段内不叠 userKeys / fcurves', () => {
  const doc = makeEmptyDraft('cam-motion-pri', 30, 120)
  doc.content.nodes.push(camNode())
  doc.content.timeline.animation.cameraMotionClips.push(motionClip())
  const fcurves = FCurveSet.empty()
  // 若未短路，fcurves 会把 x 拉到 50
  fcurves.upsertKey('cam', 'transform.position', 0, 0, 50)
  fcurves.upsertKey('cam', 'transform.position', 0, 30, 50)
  const scene = sceneFromDocument(doc, {
    fcurves,
    userKeys: {
      cam: {
        position: [makeKeyframe(0, [99, 1.6, 4]), makeKeyframe(30, [99, 1.6, 4])],
        fov: [makeKeyframe(0, [12]), makeKeyframe(30, [12])],
      },
    },
    userKeysEnabled: true,
    chainCameraMotion: false,
  })
  const xf = evalAt(scene, 15).transforms.get('cam')!
  assert.ok(Math.abs(xf.position.x - 5) < 1e-6, `expected motion mid x=5, got ${xf.position.x}`)
  assert.equal(xf.position.y, 1.6)
  assert.equal(xf.position.z, 4)
  assert.equal(xf.fov, 50)
})

test('运镜优先：片段外也不叠关键帧（回落静态，非 hold）', () => {
  const doc = makeEmptyDraft('cam-motion-pri-out', 30, 120)
  doc.content.nodes.push(camNode())
  doc.content.timeline.animation.cameraMotionClips.push(motionClip())
  const fcurves = FCurveSet.empty()
  fcurves.upsertKey('cam', 'transform.position', 0, 0, 50)
  fcurves.upsertKey('cam', 'transform.position', 0, 60, 50)
  const scene = sceneFromDocument(doc, {
    fcurves,
    userKeys: {
      cam: { position: [makeKeyframe(0, [99, 1.6, 4]), makeKeyframe(60, [99, 1.6, 4])] },
    },
    userKeysEnabled: true,
    chainCameraMotion: false,
  })
  const xf = evalAt(scene, 45).transforms.get('cam')!
  assert.deepEqual([xf.position.x, xf.position.y, xf.position.z], [0, 1.6, 4])
})

test('无运镜时 userKeys 仍驱动机位', () => {
  const doc = makeEmptyDraft('cam-uk-only', 30, 120)
  doc.content.nodes.push(camNode())
  const scene = sceneFromDocument(doc, {
    fcurves: null,
    userKeys: {
      cam: { position: [makeKeyframe(0, [0, 1.6, 4]), makeKeyframe(40, [8, 1.6, 4])] },
    },
    userKeysEnabled: true,
    chainCameraMotion: false,
  })
  const xf = evalAt(scene, 20).transforms.get('cam')!
  assert.deepEqual([xf.position.x, xf.position.y, xf.position.z], [4, 1.6, 4])
})
