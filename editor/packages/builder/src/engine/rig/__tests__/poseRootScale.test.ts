import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import type { FrameSnapshot } from '../../../evaluate/evaluateFrame'
import type { StageGraph } from '../../objects/graph'
import type { CharInstance } from '../../objects/types'
import { applyMotionAndPose } from '../../objects/applySnapshot'
import { measureLegLength, POSE_LIBRARY_LEG_LENGTH, poseRootOffsetScale } from '../poseRootScale'

function bone(name: string, parent: THREE.Object3D, y: number): THREE.Bone {
  const b = new THREE.Bone()
  b.name = name
  b.position.set(0, y, 0)
  parent.add(b)
  return b
}

/** Mixamo-style chain with the hip joint at `hipHeight` and the ankle 0.08 m above the ground. */
function character(hipHeight: number, innerScale = 1) {
  const root = new THREE.Group()
  const inner = new THREE.Group()
  inner.scale.setScalar(innerScale)
  root.add(inner)
  const s = 1 / innerScale
  const hips = bone('mixamorigHips', inner, (hipHeight + 0.05) * s)
  const upLeg = bone('mixamorigLeftUpLeg', hips, -0.05 * s)
  const leg = bone('mixamorigLeftLeg', upLeg, (-(hipHeight - 0.08) / 2) * s)
  bone('mixamorigLeftFoot', leg, (-(hipHeight - 0.08) / 2) * s)
  return { root, inner, legLength: hipHeight - 0.08 }
}

test('leg length is measured hip joint to ankle in root space, whatever the skeleton unit scale', () => {
  const metric = character(0.5)
  assert.ok(Math.abs(measureLegLength(metric.root, metric.inner)! - metric.legLength) < 1e-9)
  const centimetre = character(0.9, 0.01)
  centimetre.root.scale.setScalar(2)
  centimetre.root.position.set(3, 0, -1)
  assert.ok(Math.abs(measureLegLength(centimetre.root, centimetre.inner)! - centimetre.legLength) < 1e-9)
  assert.equal(measureLegLength(new THREE.Group(), new THREE.Group()), null)
})

test('root offset scale follows leg length and falls back to 1', () => {
  assert.equal(poseRootOffsetScale(POSE_LIBRARY_LEG_LENGTH), 1)
  assert.ok(Math.abs(poseRootOffsetScale(0.4) - 0.4 / POSE_LIBRARY_LEG_LENGTH) < 1e-12)
  assert.equal(poseRootOffsetScale(null), 1)
  assert.equal(poseRootOffsetScale(Number.NaN), 1)
  assert.equal(poseRootOffsetScale(0.01), 0.2)
  assert.equal(poseRootOffsetScale(10), 2)
})

function graphWith(ch: CharInstance): StageGraph {
  return {
    characters: new Map([[ch.node.id, ch]]),
    poseBank: { get: () => undefined },
  } as unknown as StageGraph
}

function posed(posePresetId: string, legLength: number | null): CharInstance {
  const { root, inner } = character(0.5)
  return {
    node: {
      id: 'kid', type: 'character',
      character: { animation: { mode: 'pose', posePresetId, controlValues: {},
                                rootPositionOffset: { x: 0.02, y: -0.9, z: 0.01 } } },
    },
    root, inner, rig: 'mixamorig', animator: { stopAll() {} }, retargeter: null,
    restPose: new Map(), restPos: new Map(), legLength,
  } as unknown as CharInstance
}

const noMotion = { motionPlayback: [] } as unknown as FrameSnapshot

test('library pose root drop is scaled by the character leg length (kneeling child stays above ground)', () => {
  const kid = posed('crouch-on-knees-arms-up', 0.4)
  applyMotionAndPose(graphWith(kid), noMotion)
  const scale = 0.4 / POSE_LIBRARY_LEG_LENGTH
  assert.ok(Math.abs(kid.inner.position.y - -0.9 * scale) < 1e-12)
  assert.ok(Math.abs(kid.inner.position.x - 0.02 * scale) < 1e-12)
  assert.ok(kid.inner.position.y > -0.4, 'the root must not sink further than the leg is long')
})

test('legacy knob presets and unmeasured skeletons keep the stored offset', () => {
  const preset = posed('sit', 0.4)
  applyMotionAndPose(graphWith(preset), noMotion)
  assert.equal(preset.inner.position.y, -0.9)
  const unknown = posed('crouch-on-knees-arms-up', null)
  applyMotionAndPose(graphWith(unknown), noMotion)
  assert.equal(unknown.inner.position.y, -0.9)
})
