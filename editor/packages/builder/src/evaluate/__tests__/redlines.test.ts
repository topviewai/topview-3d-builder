import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { BakedCurve, CameraMotionClip, DraftNode, PathMotionClip } from '../../contract/types'
import { lookAtFromEulerDeg, lookDistance } from '../camera/cameraAim'
import { FCurveSet } from '../curves/FCurveSet'
import { makeKeyframe } from '../curves/KeyframeTrack'
import { createFrameSnapshot, prepareFrameSnapshot, type SceneContract } from '../FrameSnapshot'
import { evaluateFrame } from '../evaluateFrame'
import { resolveMediaKey } from '../../host/assetKeys'
import { evalAt, loadDraft, loadFcurves, nearly, sceneOf } from './helpers'

function emptyTimeline(fps = 30): SceneContract['timeline'] {
  return {
    version: 1,
    fps,
    frameStart: 0,
    frameEnd: 100,
    usePreviewRange: false,
    animation: {
      fcurves: [],
      cameraMotionClips: [],
      motionTransitions: [],
      motionClips: [],
      pathMotionClips: [],
    },
  }
}

function cameraNode(): DraftNode {
  return {
    id: 'camera_1',
    type: 'camera',
    name: 'cam',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 1.8, z: 5 },
      rotation: { x: -8, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    camera: {
      projection: 'perspective',
      fov: 50,
      fovAxis: 'vertical',
      near: 0.1,
      far: 1000,
      isPrimary: true,
      lookAt: { x: 0, y: 1.2, z: 0 },
    },
  }
}

function axisCurve(id: string, group: BakedCurve['group'], dataPath: string, index: number, a: number, b: number): BakedCurve {
  return {
    id,
    group,
    dataPath,
    arrayIndex: index,
    extrapolation: 'constant',
    keyframes: [
      { id: `${id}:0`, time: 0, value: a, interpolation: 'linear' },
      { id: `${id}:1`, time: 1000, value: b, interpolation: 'linear' },
    ],
  }
}

function motionClip(
  id: string,
  frameStart: number,
  frameEnd: number,
  px0: number,
  px1: number,
): CameraMotionClip {
  return {
    id,
    target: { type: 'node', nodeId: 'camera_1' },
    frameStart,
    frameEnd,
    trimStartMs: 0,
    trimEndMs: 1000,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: frameEnd - frameStart },
    motion: {
      id,
      version: 1,
      presetId: id,
      label: id,
      timeUnit: 'millisecond',
      durationMs: 1000,
      curves: [
        axisCurve(`${id}:px`, 'position', 'camera.position', 0, px0, px1),
        axisCurve(`${id}:py`, 'position', 'camera.position', 1, 1.8, 1.8),
        axisCurve(`${id}:pz`, 'position', 'camera.position', 2, 5, 5),
        axisCurve(`${id}:lx`, 'lookAt', 'camera.lookAt', 0, 0, 0),
        axisCurve(`${id}:ly`, 'lookAt', 'camera.lookAt', 1, 1.2, 1.2),
        axisCurve(`${id}:lz`, 'lookAt', 'camera.lookAt', 2, 0, 0),
        axisCurve(`${id}:fov`, 'lens', 'camera.lens.fov', 0, 50, 50),
      ],
    },
  }
}

test('运镜绝对值：相邻段边界不连续拼接', () => {
  const scene: SceneContract = {
    meta: { fps: 30, frameStart: 0, frameEnd: 20 },
    nodes: [cameraNode()],
    timeline: emptyTimeline(30),
    chainCameraMotion: false,
  }
  scene.timeline.animation.cameraMotionClips = [
    motionClip('clip_a', 0, 10, 0, 10),
    motionClip('clip_b', 10, 20, 100, 200),
  ]
  const out = createFrameSnapshot()
  prepareFrameSnapshot(out, ['camera_1'])
  evaluateFrame(scene, 10, out)
  const x10 = out.camera?.position.x ?? NaN
  evaluateFrame(scene, 11, out)
  const x11 = out.camera?.position.x ?? NaN
  assert.ok(x10 < 20, `frame 10 should stay on clip A, got ${x10}`)
  assert.ok(x11 > 90, `frame 11 should jump to clip B absolute, got ${x11}`)
  assert.ok(Math.abs(x11 - x10) > 50, `boundary must not be chained, Δ=${x11 - x10}`)
})

test('resolveMediaKey 认库素材与用户私有 key，其余不猜测', () => {
  assert.equal(
    resolveMediaKey({ kind: 'prop', sourceUrl: '3d-builder/library/props/a3d_prop_x-1234.glb' }),
    '3d-builder/library/props/a3d_prop_x-1234.glb',
  )
  assert.equal(resolveMediaKey({ kind: 'prop', sourceUrl: 'canvas/user/a.glb' }), 'canvas/user/a.glb')
  assert.throws(() => resolveMediaKey({ kind: 'prop', sourceUrl: 'props/box.glb' }))
  assert.throws(() => resolveMediaKey({ kind: 'prop', sourceUrl: '3d-builder/public/props/box.glb' }))
})

test('character 的 sourcePath 是 assetSource 枚举，不得当 key 兜底', () => {
  // characterMediaRef 把 metadata.assetSource 填进 sourcePath，缺 modelUrl 时若拿它兜底，
  // 会抛出「收到: user」这种指向错误的报错，并让 SceneLoader 整批角色加载失败。
  assert.equal(resolveMediaKey({ kind: 'character', sourcePath: 'user', assetId: 'a1' }), '')
  assert.equal(resolveMediaKey({ kind: 'character', sourcePath: 'base' }), '')
  assert.equal(
    resolveMediaKey({
      kind: 'character',
      sourcePath: 'user',
      sourceUrl: '3d-builder/library/characters/a3d_char_x-1234.glb',
    }),
    '3d-builder/library/characters/a3d_char_x-1234.glb',
  )
})

test('FCurveSet.encode 往返 compact-v1，persist 优先官方曲线', () => {
  const raw = {
    version: 1 as const,
    encoding: 'compact-v1' as const,
    fcurves: [
      {
        id: 'fc_node_character_1_transform_position_0',
        t: ['node', 'character_1'],
        p: 'transform.position',
        i: 0,
        k: [
          [0, 0, 'bezier', 'a'],
          [10, 10, 'bezier', 'b'],
        ],
      },
    ],
  }
  const parsed = FCurveSet.parse(raw)
  const encoded = parsed.encode()
  assert.equal(encoded.encoding, 'compact-v1')
  assert.equal(encoded.fcurves.length, 1)
  const again = FCurveSet.parse(encoded)
  assert.ok(nearly(again.evalScalar('character_1', 'transform.position', 0, 5) ?? NaN, 5))
  const persisted = FCurveSet.persist(parsed, {})
  assert.equal((persisted.fcurves[0] as { id: string }).id, 'fc_node_character_1_transform_position_0')
  const empty = FCurveSet.persist(null, {})
  assert.deepEqual(empty, { version: 1, encoding: 'compact-v1', fcurves: [] })
})

test('FCurveSet.persist 官方曲线旁路挂 userKeys sidecar，加载可还原位移旋转缩放', () => {
  const raw = {
    version: 1 as const,
    encoding: 'compact-v1' as const,
    fcurves: [
      {
        id: 'fc_node_character_1_transform_position_0',
        t: ['node', 'character_1'],
        p: 'transform.position',
        i: 0,
        k: [
          [0, 0, 'bezier', 'a'],
          [10, 10, 'bezier', 'b'],
        ],
      },
    ],
  }
  const parsed = FCurveSet.parse(raw)
  const userKeys = {
    character_1: {
      position: [makeKeyframe(3, [1, 2, 3])],
      rotation: [makeKeyframe(3, [0, 45, 0])],
      scale: [makeKeyframe(3, [1, 1, 1])],
    },
  }
  const persisted = FCurveSet.persist(parsed, userKeys)
  assert.equal(persisted.fcurves.length, 1)
  assert.equal((persisted.fcurves[0] as { id: string }).id, 'fc_node_character_1_transform_position_0')
  const restored = FCurveSet.parseUserKeys(persisted)
  assert.equal(restored.character_1?.position?.length, 1)
  assert.deepEqual(restored.character_1?.position?.[0].value, [1, 2, 3])
  assert.equal(restored.character_1?.rotation?.[0].value[1], 45)
  assert.deepEqual(restored.character_1?.scale?.[0].value, [1, 1, 1])
  assert.equal(FCurveSet.parse(persisted).curveCount, 1)
  assert.equal('userKeys' in FCurveSet.persist(parsed, {}), false)

  const onlyUser = FCurveSet.persist(null, userKeys)
  assert.deepEqual(onlyUser.fcurves, [])
  assert.equal(FCurveSet.parseUserKeys(onlyUser).character_1?.position?.length, 1)
  assert.deepEqual(FCurveSet.parseUserKeys({ encoding: 'compact-v1', fcurves: [] }), {})
})

test('fcurve 两端缺 handle：整条等于 smoothstep t²(3-2t)', () => {
  const fcurves = FCurveSet.parse({
    version: 1,
    encoding: 'compact-v1',
    fcurves: [
      {
        id: 'fc_node_character_1_transform_position_0',
        t: ['node', 'character_1'],
        p: 'transform.position',
        i: 0,
        k: [
          [0, 0, 'bezier', 'a'],
          [10, 10, 'bezier', 'b'],
        ],
      },
    ],
  })
  const mid = fcurves.evalScalar('character_1', 'transform.position', 0, 5)
  assert.ok(mid !== null && nearly(mid, 5), `t=0.5 should be 5, got ${mid}`)
  for (let frame = 0; frame <= 10; frame++) {
    const t = frame / 10
    const expected = 10 * t * t * (3 - 2 * t)
    const got = fcurves.evalScalar('character_1', 'transform.position', 0, frame)
    assert.ok(got !== null && nearly(got, expected, 1e-6), `frame ${frame}: ${got} vs ${expected}`)
  }
})

test('路径 clip 区间 [frameStart, frameEnd)：末帧不生效', () => {
  const character: DraftNode = {
    id: 'character_1',
    type: 'character',
    name: 'c',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    character: {
      placeholder: true,
      gender: 'unknown',
      motionId: null,
      appearance: { color: '#fff' },
      label: { showLabel: false, scale: 1, yOffset: 0 },
      animation: { mode: 'pose', controlValues: {} },
    },
  }
  const path: DraftNode = {
    id: 'path_1',
    type: 'path',
    name: 'p',
    visible: false,
    locked: true,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    path: {
      source: 'manual',
      curve: 'polyline',
      closed: false,
      groundSnap: false,
      parameterization: 'time-ratio',
      smoothing: 0,
      points: [
        { id: 'p0', position: { x: 0, y: 0, z: 0 }, timeRatio: 0 },
        { id: 'p1', position: { x: 10, y: 0, z: 0 }, timeRatio: 1 },
      ],
    },
  }
  const clip: PathMotionClip = {
    id: 'path_clip_1',
    status: 'active',
    locked: true,
    lockedReason: 'derived-from-keyframes',
    source: 'transform-keyframes',
    target: { type: 'node', nodeId: 'character_1' },
    pathNodeId: 'path_1',
    pathName: 'p',
    pathLength: 10,
    pathStartPercent: 0,
    pathEndPercent: 100,
    direction: 'forward',
    facing: 'none',
    frameStart: 70,
    frameEnd: 90,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: 20 },
  }
  const scene: SceneContract = {
    meta: { fps: 30, frameStart: 0, frameEnd: 100 },
    nodes: [character, path],
    timeline: emptyTimeline(30),
  }
  scene.timeline.animation.pathMotionClips = [clip]
  const out = createFrameSnapshot()
  prepareFrameSnapshot(out, ['character_1', 'path_1'])
  evaluateFrame(scene, 89, out)
  const at89 = out.transforms.get('character_1')!.position.x
  evaluateFrame(scene, 90, out)
  const at90 = out.transforms.get('character_1')!.position.x
  assert.ok(at89 > 9, `frameEnd-1 should be on path, got ${at89}`)
  assert.ok(nearly(at90, 0), `frameEnd should fall back to static, got ${at90}`)
})

test('用户轨迹驱动 primitive：静态复位之后仍走路径', () => {
  const prim: DraftNode = {
    id: 'prim_1',
    type: 'primitive',
    name: 'sphere',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    primitive: { kind: 'SphereGeometry', parameters: { radius: 0.6 } },
  }
  const path: DraftNode = {
    id: 'path_1',
    type: 'path',
    name: 'p',
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
      groundSnap: true,
      parameterization: 'time-ratio',
      smoothing: 0,
      points: [
        { id: 'p0', position: { x: 0, y: 0, z: 0 }, timeRatio: 0 },
        { id: 'p1', position: { x: 10, y: 0, z: 0 }, timeRatio: 1 },
      ],
    },
  }
  const clip: PathMotionClip = {
    id: 'path_clip_prim',
    status: 'active',
    locked: false,
    source: 'semantic',
    target: { type: 'node', nodeId: 'prim_1' },
    pathNodeId: 'path_1',
    pathName: 'p',
    pathLength: 10,
    pathStartPercent: 0,
    pathEndPercent: 100,
    direction: 'forward',
    facing: 'path-tangent',
    frameStart: 0,
    frameEnd: 20,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: 20 },
  }
  const scene: SceneContract = {
    meta: { fps: 30, frameStart: 0, frameEnd: 40 },
    nodes: [prim, path],
    timeline: emptyTimeline(30),
  }
  scene.timeline.animation.pathMotionClips = [clip]
  const out = createFrameSnapshot()
  prepareFrameSnapshot(out, ['prim_1', 'path_1'])
  evaluateFrame(scene, 10, out)
  const mid = out.transforms.get('prim_1')!.position.x
  assert.ok(mid > 4 && mid < 6, `primitive should follow path, got x=${mid}`)
  evaluateFrame(scene, 30, out)
  assert.ok(nearly(out.transforms.get('prim_1')!.position.x, 0), 'outside clip falls back to static')
})

test('两份 snapshot 的 motionPlayback 不共享 command 对象', () => {
  const scene = sceneOf(loadDraft('xiaoyunque-draft.json'), loadFcurves('xiaoyunque-fcurves.json'))
  const a = createFrameSnapshot()
  const b = createFrameSnapshot()
  evalAt(scene, 80, a)
  assert.ok(a.motionPlayback.length > 0, 'frame 80 should emit motionPlayback')
  const recorded = {
    clipId: a.motionPlayback[0].clipId,
    timeSeconds: a.motionPlayback[0].timeSeconds,
  }
  evalAt(scene, 400, b)
  assert.ok(b.motionPlayback.length > 0, 'frame 400 should emit motionPlayback')
  const sameObject = a.motionPlayback[0] === b.motionPlayback[0]
  const polluted =
    a.motionPlayback[0].clipId !== recorded.clipId ||
    a.motionPlayback[0].timeSeconds !== recorded.timeSeconds
  assert.equal(sameObject, false, `A/B motionPlayback[0] 是同一对象: ${sameObject}`)
  assert.equal(polluted, false, `被 B 污染: ${polluted}`)
})

test('lookAtFromEulerDeg：默认朝向是本地 -Z', () => {
  const la = lookAtFromEulerDeg({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 5)
  assert.ok(nearly(la.x, 0, 1e-6) && nearly(la.y, 0, 1e-6) && nearly(la.z, -5, 1e-6), JSON.stringify(la))
})

test('lookAtFromEulerDeg：Y=90° 看向 -X', () => {
  const la = lookAtFromEulerDeg({ x: 0, y: 0, z: 0 }, { x: 0, y: 90, z: 0 }, 2)
  assert.ok(nearly(la.x, -2, 1e-6) && nearly(la.y, 0, 1e-6) && nearly(la.z, 0, 1e-6), JSON.stringify(la))
})

test('用户旋转关键帧按欧拉上机并重算 lookAt', () => {
  const node = cameraNode()
  const scene: SceneContract = {
    meta: { fps: 30, frameStart: 0, frameEnd: 20 },
    nodes: [node],
    timeline: emptyTimeline(30),
    userKeysEnabled: true,
    userKeys: {
      camera_1: {
        rotation: [makeKeyframe(0, [0, 90, 0])],
      },
    },
  }
  const out = createFrameSnapshot()
  prepareFrameSnapshot(out, ['camera_1'])
  evaluateFrame(scene, 0, out)
  const xf = out.transforms.get('camera_1')
  assert.ok(nearly(xf!.rotation.y, 90), `rotation.y=${xf?.rotation.y}`)
  const expected = lookAtFromEulerDeg(
    xf!.position,
    xf!.rotation,
    lookDistance(node.transform.position, node.camera!.lookAt),
  )
  assert.ok(nearly(xf!.lookAt!.x, expected.x, 1e-6), `lookAt.x ${xf!.lookAt!.x} vs ${expected.x}`)
  assert.ok(nearly(xf!.lookAt!.z, expected.z, 1e-6), `lookAt.z ${xf!.lookAt!.z} vs ${expected.z}`)
})

test('lookAtTarget 把看点钉到人物胸口并随人物平移', () => {
  const cam = cameraNode()
  cam.camera!.lookAtTarget = { nodeId: 'character_1', offset: { x: 0.1, y: 1.2, z: -0.2 } }
  const character: DraftNode = {
    id: 'character_1',
    type: 'character',
    name: 'c',
    visible: true,
    locked: false,
    transform: {
      position: { x: 2, y: 0, z: 4 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    character: {
      placeholder: true,
      gender: 'unknown',
      motionId: null,
      appearance: { color: '#fff' },
      label: { showLabel: false, scale: 1, yOffset: 0 },
      animation: { mode: 'pose', controlValues: {} },
    },
  }
  const scene: SceneContract = {
    meta: { fps: 30, frameStart: 0, frameEnd: 20 },
    nodes: [cam, character],
    timeline: emptyTimeline(30),
  }
  const out = createFrameSnapshot()
  prepareFrameSnapshot(out, ['camera_1', 'character_1'])
  evaluateFrame(scene, 0, out)
  const xf = out.transforms.get('camera_1')
  assert.ok(nearly(xf!.lookAt!.x, 2.1, 1e-6), `lookAt.x=${xf?.lookAt?.x}`)
  assert.ok(nearly(xf!.lookAt!.y, 1.2, 1e-6), `lookAt.y=${xf?.lookAt?.y}`)
  assert.ok(nearly(xf!.lookAt!.z, 3.8, 1e-6), `lookAt.z=${xf?.lookAt?.z}`)
})

test('primitive 吃 fcurves，userKeys 再覆写位移', () => {
  const prim: DraftNode = {
    id: 'prim_1',
    type: 'primitive',
    name: 'box',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    primitive: { kind: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 } },
  }
  const fcurves = FCurveSet.empty()
  fcurves.upsertKey('prim_1', 'transform.position', 0, 0, 3)
  fcurves.upsertKey('prim_1', 'transform.rotation', 1, 0, 45)
  fcurves.upsertKey('prim_1', 'transform.scale', 0, 0, 2)
  const scene: SceneContract = {
    meta: { fps: 30, frameStart: 0, frameEnd: 20 },
    nodes: [prim],
    timeline: emptyTimeline(30),
    fcurves,
    userKeysEnabled: true,
    userKeys: {
      prim_1: {
        position: [makeKeyframe(0, [7, 0, 0])],
      },
    },
  }
  const out = createFrameSnapshot()
  prepareFrameSnapshot(out, ['prim_1'])
  evaluateFrame(scene, 0, out)
  const xf = out.transforms.get('prim_1')
  assert.ok(nearly(xf!.position.x, 7), `position.x=${xf?.position.x}`)
  assert.ok(nearly(xf!.rotation.y, 45), `rotation.y=${xf?.rotation.y}`)
  assert.ok(nearly(xf!.scale.x, 2), `scale.x=${xf?.scale.x}`)
})
