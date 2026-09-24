import assert from 'node:assert/strict'
import { test } from 'vitest'
import { formatTimecode, framesToSeconds, parseTimecode, remapFrame, secondsToFrame } from '../timecode'

test('时码按帧和 fps 派生 HH:MM:SS:FF', () => {
  assert.equal(formatTimecode(0, 30), '00:00:00:00')
  assert.equal(formatTimecode(29, 30), '00:00:00:29')
  assert.equal(formatTimecode(30, 30), '00:00:01:00')
  assert.equal(formatTimecode(90, 30), '00:00:03:00')
  assert.equal(parseTimecode('00:00:03:00', 30), 90)
  assert.equal(parseTimecode('00:00:00:30', 30), null)
})

test('帧与秒按 fps 互换，结束 300 帧 @30 为 10.0s', () => {
  assert.equal(framesToSeconds(0, 30), 0)
  assert.equal(framesToSeconds(300, 30), 10)
  assert.equal(secondsToFrame(10, 30), 300)
  assert.equal(secondsToFrame(10.1, 30), 303)
})

test('改帧率按秒映射帧号，10s 在 30→24 从 300 落到 240', () => {
  assert.equal(remapFrame(300, 30, 24), 240)
  assert.equal(remapFrame(0, 30, 24), 0)
  assert.equal(remapFrame(240, 24, 30), 300)
})
