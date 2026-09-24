import assert from 'node:assert/strict'
import { test } from 'vitest'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import { bakeCameraMotionPoses } from '../camera/bakeMotion'
import { PREVIEW_FRONT, previewCameraMotionPoses } from '../camera/previewLibraryPoses'
import { CAMERA_MOTIONS, CAMERA_PRESETS, type CameraMotionPreset, type CameraPreset } from '../../data/cameraLibrary'

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function requirePreset(id: string): CameraPreset {
  const found = CAMERA_PRESETS.find((item) => item.id === id)
  if (!found) throw new Error(`missing preset ${id}`)
  return found
}

function requireMotion(id: string): CameraMotionPreset {
  const found = CAMERA_MOTIONS.find((item) => item.id === id)
  if (!found) throw new Error(`missing motion ${id}`)
  return found
}

test('机位图标用真实坐标：远近高低左右和库数据一致', () => {
  const close = requirePreset('front-close')
  const medium = requirePreset('front-medium')
  const wide = requirePreset('front-wide')
  assert.ok(dist(close.position, close.lookAt) < dist(medium.position, medium.lookAt))
  assert.ok(dist(medium.position, medium.lookAt) < dist(wide.position, wide.lookAt))
  assert.ok(requirePreset('bird-eye').position.y > requirePreset('top-wide').position.y)
  assert.ok(requirePreset('top-wide').position.y > medium.position.y)
  assert.ok(medium.position.y > requirePreset('low-angle').position.y)
  assert.ok(requirePreset('over-shoulder').position.x < 0)
  assert.ok(requirePreset('over-shoulder-right').position.x > 0)
  assert.ok(requirePreset('dutch').rotation.z !== 0)
})

test('运镜图标用同一套烘焙器：位移和摇镜方向与 recipe 一致', () => {
  const dolly = previewCameraMotionPoses(requireMotion('dolly_in'))
  const tilt = previewCameraMotionPoses(requireMotion('tilt_up'))
  const truck = previewCameraMotionPoses(requireMotion('truck_left'))
  if (!dolly || !tilt || !truck) throw new Error('preview bake failed')
  const dollyStart = dolly[0]
  const dollyEnd = dolly[dolly.length - 1]
  const tiltStart = tilt[0]
  const tiltEnd = tilt[tilt.length - 1]
  const truckStart = truck[0]
  const truckEnd = truck[truck.length - 1]
  if (!dollyStart || !dollyEnd || !tiltStart || !tiltEnd || !truckStart || !truckEnd) {
    throw new Error('empty preview poses')
  }
  assert.ok(dist(dollyEnd.position, dollyStart.lookAt) < dist(dollyStart.position, dollyStart.lookAt))
  assert.ok(tiltEnd.lookAt.y > tiltStart.lookAt.y)
  assert.ok(truckEnd.position.x < truckStart.position.x)
})

test('摇镜和环绕忽略 config.angleDeg，走 recipe 全路径', () => {
  if (!PREVIEW_FRONT) throw new Error('missing front-medium')
  const bake = (id: string, angleDeg?: number) => {
    const preset = requireMotion(id)
    const doc = makeEmptyDraft('angle-ignore', 30, 90, PREVIEW_FRONT)
    const cameraNode = doc.content.nodes[0]
    if (!cameraNode) throw new Error('missing camera')
    const result = bakeCameraMotionPoses(preset, { cameraNode, targetNode: null, doc }, 0, angleDeg == null ? undefined : { angleDeg })
    if (!result.ok || !result.poses) throw new Error(result.reason ?? 'bake failed')
    return result.poses
  }
  const panA = bake('pan_left')
  const panB = bake('pan_left', 90)
  const panEndA = panA[panA.length - 1]
  const panEndB = panB[panB.length - 1]
  if (!panEndA || !panEndB) throw new Error('empty pan poses')
  assert.deepEqual(panEndA.lookAt, panEndB.lookAt)
  const orbitA = bake('orbit_180')
  const orbitB = bake('orbit_180', 90)
  const orbitEndA = orbitA[orbitA.length - 1]
  const orbitEndB = orbitB[orbitB.length - 1]
  if (!orbitEndA || !orbitEndB) throw new Error('empty orbit poses')
  assert.deepEqual(orbitEndA.position, orbitEndB.position)
})
