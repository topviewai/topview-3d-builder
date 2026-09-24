import { test } from 'vitest'
import assert from 'node:assert/strict'
import { EDITOR_LAYER, GRID_LAYER, exportCameraLayerMask } from '../../core/Layers'

test('导出相机层：关掉 EDITOR_LAYER，打开 GRID_LAYER，其它层保持', () => {
  const editor = (1 << 0) | (1 << EDITOR_LAYER)
  const next = exportCameraLayerMask(editor)
  assert.equal((next >> EDITOR_LAYER) & 1, 0)
  assert.equal((next >> GRID_LAYER) & 1, 1)
  assert.equal(next & 1, 1)
})

test('导出相机层：已经是机位层时 mask 不变', () => {
  const sceneCam = (1 << 0) | (1 << GRID_LAYER)
  assert.equal(exportCameraLayerMask(sceneCam), sceneCam)
})
