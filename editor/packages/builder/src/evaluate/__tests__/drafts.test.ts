import assert from 'node:assert/strict'
import { test } from 'vitest'
import { evaluateFrame } from '../evaluateFrame'
import {
  DRAFT_FILES,
  assertSnapEqual,
  cloneNumbers,
  evalAt,
  loadDraft,
  loadFcurves,
  nearly,
  sceneOf,
} from './helpers'

const CHECK_EPS = 5e-4

test('xiaoyunque 冻结检查点与阶段 4.5 实测一致', () => {
  const doc = loadDraft('xiaoyunque-draft.json')
  const scene = sceneOf(doc, loadFcurves('xiaoyunque-fcurves.json'))
  assert.equal(scene.nodes.length, 27)
  assert.equal(scene.meta.frameStart, 0)
  assert.equal(scene.meta.frameEnd, 1996)
  assert.equal(scene.chainCameraMotion ?? false, false)
  const cam2clips = scene.timeline.animation.cameraMotionClips.filter((c) => c.target.nodeId === 'camera_2')
  assert.equal(cam2clips.length, 22)

  const pos = (frame: number) => evalAt(scene, frame).transforms.get('character_2')!.position
  const p70 = pos(70)
  const p80 = pos(80)
  const p89 = pos(89)
  const p90 = pos(90)
  assert.ok(nearly(p70.x, 0, CHECK_EPS) && nearly(p70.y, 0, CHECK_EPS) && nearly(p70.z, 0, CHECK_EPS), `f70 ${p70.x},${p70.y},${p70.z}`)
  assert.ok(nearly(p80.x, 0.897, CHECK_EPS) && nearly(p80.y, -0.305, CHECK_EPS) && nearly(p80.z, -0.830, CHECK_EPS), `f80 ${p80.x},${p80.y},${p80.z}`)
  assert.ok(nearly(p89.x, 1.781, CHECK_EPS) && nearly(p89.y, -0.606, CHECK_EPS) && nearly(p89.z, -1.647, CHECK_EPS), `f89 ${p89.x},${p89.y},${p89.z}`)
  assert.ok(nearly(p90.x, 1.794, CHECK_EPS) && nearly(p90.y, -0.610, CHECK_EPS) && nearly(p90.z, -1.659, CHECK_EPS), `f90 ${p90.x},${p90.y},${p90.z}`)

  const fov = (frame: number) => evalAt(scene, frame).transforms.get('camera_2')!.fov ?? NaN
  assert.ok(nearly(fov(994), 50, CHECK_EPS), `fov994=${fov(994)}`)
  assert.ok(nearly(fov(1024), 56, CHECK_EPS), `fov1024=${fov(1024)}`)
  assert.ok(nearly(fov(1054), 62, CHECK_EPS), `fov1054=${fov(1054)}`)
  assert.ok(nearly(fov(1055), 50, CHECK_EPS), `fov1055=${fov(1055)}`)
})

test('qa-director-full 冻结结构', () => {
  const scene = sceneOf(
    loadDraft('qa-director-full-draft.json'),
    loadFcurves('qa-director-full-fcurves.json'),
  )
  assert.equal(scene.nodes.length, 43)
  assert.equal(scene.meta.frameStart, 0)
  assert.equal(scene.meta.frameEnd, 1836)
  assert.equal(scene.timeline.animation.cameraMotionClips.length, 31)
  assert.equal(scene.timeline.animation.motionClips.length, 10)
  const countOf = (type: string) => scene.nodes.filter((n) => n.type === type).length
  assert.equal(countOf('camera'), 17)
  assert.equal(countOf('character'), 4)
  assert.equal(countOf('prop'), 15)
  assert.equal(countOf('primitive'), 6)
  assert.equal(countOf('path'), 1)
})

test('冻结草稿逐帧 evaluateFrame 自洽（同帧两次 / 往返）', () => {
  for (const file of DRAFT_FILES) {
    const doc = loadDraft(file.draft)
    const scene = sceneOf(doc, file.fcurves ? loadFcurves(file.fcurves) : null)
    const start = scene.meta.frameStart
    const end = scene.meta.frameEnd
    const a = evalAt(scene, start)
    const xf = a.transforms.get(scene.nodes[0]!.id)
    evaluateFrame(scene, start, a)
    assert.equal(a.transforms.get(scene.nodes[0]!.id), xf, `${file.draft}: transform slot reused`)

    const mid = Math.min(start + 100, end)
    const first = cloneNumbers(evalAt(scene, mid))
    evalAt(scene, mid + 1)
    const back = cloneNumbers(evalAt(scene, mid))
    assertSnapEqual(first, back, `${file.draft} seek ${mid} via ${mid + 1}`)

    const twiceA = cloneNumbers(evalAt(scene, mid))
    const twiceB = cloneNumbers(evalAt(scene, mid))
    assertSnapEqual(twiceA, twiceB, `${file.draft} double eval ${mid}`)

    for (let frame = start; frame <= end; frame += 1) {
      const x = cloneNumbers(evalAt(scene, frame))
      const y = cloneNumbers(evalAt(scene, frame))
      assertSnapEqual(x, y, `${file.draft} frame ${frame}`)
    }
  }
})
