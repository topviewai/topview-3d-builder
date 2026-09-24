import assert from 'node:assert/strict'
import { test } from 'vitest'
import { FilmPlaybackController } from '../FilmPlaybackController'

const globalClock = globalThis as typeof globalThis & {
  requestAnimationFrame: (cb: (now: number) => void) => number
  cancelAnimationFrame: (id: number) => void
}
globalClock.requestAnimationFrame = () => 1
globalClock.cancelAnimationFrame = () => undefined

test('成片播放到末帧停止，再播从 0 开始', () => {
  const clock = new FilmPlaybackController()
  clock.setFps(30)
  clock.seekSequence(8, 9)
  assert.equal(clock.getSnapshot().sequenceFrame, 8)
  clock.playSequence(9)
  assert.equal(clock.getSnapshot().mode, 'sequence')
  assert.equal(clock.getSnapshot().sequenceFrame, 0)
  clock.pause()
  assert.equal(clock.getSnapshot().mode, 'idle')
})

test('源预览与成片播放互斥，切到另一路会停当前时钟', () => {
  const clock = new FilmPlaybackController()
  clock.setFps(30)
  clock.seekSource(2, 0, 9)
  clock.playSource(0, 9)
  assert.equal(clock.getSnapshot().mode, 'source')
  clock.playSequence(6)
  assert.equal(clock.getSnapshot().mode, 'sequence')
  clock.seekSource(4, 0, 9)
  assert.equal(clock.getSnapshot().mode, 'idle')
  assert.equal(clock.getSnapshot().sourcePreviewFrame, 4)
})
