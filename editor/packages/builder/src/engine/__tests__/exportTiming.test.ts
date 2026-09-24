import assert from 'node:assert/strict'
import { test } from 'vitest'
import { evenExportSize, exportBitrate, exportFps } from '../io/exportTiming'

test('导出宽高向下取偶数，至少 2', () => {
  assert.equal(evenExportSize(2520), 2520)
  assert.equal(evenExportSize(1080), 1080)
  assert.equal(evenExportSize(2521), 2520)
  assert.equal(evenExportSize(1), 2)
  assert.equal(evenExportSize(0), 2)
})

test('fps 至少为 1，四舍五入', () => {
  assert.equal(exportFps(30), 30)
  assert.equal(exportFps(29.6), 30)
  assert.equal(exportFps(0), 1)
  assert.equal(exportFps(-12), 1)
})

test('码率按像素估算并夹在 4–20 Mbps', () => {
  assert.equal(exportBitrate(2520, 1080, 30), 9_797_760)
  assert.equal(exportBitrate(320, 180, 30), 4_000_000)
  assert.equal(exportBitrate(3840, 2160, 60), 20_000_000)
})
