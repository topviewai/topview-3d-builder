import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  collectPoseLibraryPages,
  POSE_LIBRARY_PAGE_SIZE,
} from '../../data/collectPoseLibrary'

function pose(id: string): { id: string; name: string } {
  return { id, name: id }
}

test('姿势库按 total 翻页，不在第一页截断', async () => {
  const first = Array.from({ length: POSE_LIBRARY_PAGE_SIZE }, (_, index) => pose(`a${index}`))
  const total = POSE_LIBRARY_PAGE_SIZE + 1
  const seen: number[] = []
  const records = await collectPoseLibraryPages(async (pageNo) => {
    seen.push(pageNo)
    if (pageNo === 1) return { items: first, total, pageNo, pageSize: POSE_LIBRARY_PAGE_SIZE }
    return { items: [pose('c')], total, pageNo, pageSize: POSE_LIBRARY_PAGE_SIZE }
  })
  assert.deepEqual(seen, [1, 2])
  assert.equal(records.length, total)
  assert.equal(records.at(-1)?.id, 'c')
})

test('没有 total 时满页继续翻，短页停止', async () => {
  const full = Array.from({ length: POSE_LIBRARY_PAGE_SIZE }, (_, index) => pose(`p${index}`))
  const records = await collectPoseLibraryPages(async (pageNo) => {
    if (pageNo === 1) return { items: full, pageNo, pageSize: POSE_LIBRARY_PAGE_SIZE }
    return { items: [pose('last')], pageNo, pageSize: POSE_LIBRARY_PAGE_SIZE }
  })
  assert.equal(records.length, POSE_LIBRARY_PAGE_SIZE + 1)
  assert.equal(records.at(-1)?.id, 'last')
})
