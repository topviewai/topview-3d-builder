import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { CameraMotionClip } from '../../contract/types'
import { defaultVideoExportEndFrame } from '../camera/cameraMotionRange'

function clip(nodeId: string, frameStart: number, frameEnd: number): CameraMotionClip {
  return {
    id: `${nodeId}-${frameStart}-${frameEnd}`,
    target: { type: 'camera', nodeId },
    frameStart,
    frameEnd,
    trimStartMs: 0,
    trimEndMs: 1000,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: frameEnd - frameStart },
    motion: {
      id: 'shot',
      version: 1,
      presetId: 'shot',
      label: 'shot',
      timeUnit: 'ms',
      durationMs: 1000,
      curves: [],
    },
  }
}

test('没有运镜时退回时间轴终点', () => {
  assert.equal(defaultVideoExportEndFrame([], 'cam', 3000), 3000)
  assert.equal(defaultVideoExportEndFrame([], null, 3000), 3000)
})

test('指定机位取该机位运镜最后结束帧', () => {
  const clips = [clip('cam', 0, 80), clip('cam', 120, 240), clip('other', 0, 900)]
  assert.equal(defaultVideoExportEndFrame(clips, 'cam', 3000), 240)
})

test('当前视角（未指定机位）取全部运镜的最后结束帧', () => {
  const clips = [clip('a', 0, 80), clip('b', 100, 360)]
  assert.equal(defaultVideoExportEndFrame(clips, null, 3000), 360)
})

test('运镜结束帧不超过时间轴终点', () => {
  const clips = [clip('cam', 0, 4000)]
  assert.equal(defaultVideoExportEndFrame(clips, 'cam', 3000), 3000)
})
