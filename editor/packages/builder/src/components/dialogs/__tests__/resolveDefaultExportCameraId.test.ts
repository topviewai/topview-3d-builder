import assert from 'node:assert/strict'
import { test } from 'vitest'
import { resolveDefaultExportCameraId } from '../utils'

const cameras = [{ id: 'cam_front' }, { id: 'cam_side' }]

test('默认导出机位用预览当前选中的机位', () => {
  assert.equal(resolveDefaultExportCameraId(cameras, 'cam_side', '__editor__'), 'cam_side')
})

test('选中机位不在文档里时退回第一台相机', () => {
  assert.equal(resolveDefaultExportCameraId(cameras, 'gone', '__editor__'), 'cam_front')
  assert.equal(resolveDefaultExportCameraId(cameras, null, '__editor__'), 'cam_front')
})

test('没有场景相机时才用编辑器当前视角', () => {
  assert.equal(resolveDefaultExportCameraId([], 'cam_side', '__editor__'), '__editor__')
})
