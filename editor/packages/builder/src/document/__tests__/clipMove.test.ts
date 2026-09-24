import { test } from 'vitest'
import assert from 'node:assert/strict'
import { previewClipMove, type ClipRange } from '../clipMove'

const c = (id: string, frameStart: number, frameEnd: number): ClipRange => ({ id, frameStart, frameEnd })
const screenshotTrack = [c('失败者', 0, 97), c('死亡', 97, 229), c('鲤鱼打挺', 437, 498), c('舞蹈', 498, 613)]
const layout = (clips: ClipRange[], id: string, frame: number, snap = 0) => previewClipMove(clips, id, frame, 0, snap)!
const ranges = (r: ReturnType<typeof layout>) => Object.entries(r.positions)
  .sort((a, b) => a[1].frameStart - b[1].frameStart)
  .map(([id, p]) => [id, p.frameStart, p.frameEnd])

function assertNoOverlap(r: ReturnType<typeof layout>) {
  const sorted = Object.values(r.positions).sort((a, b) => a.frameStart - b.frameStart)
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].frameStart >= sorted[i - 1].frameEnd, JSON.stringify(r))
}

test('截图：向左的前沿到死亡中点时立即插入，短片段不用等中心越过', () => {
  assert.deepEqual(ranges(layout(screenshotTrack, '鲤鱼打挺', 164)).slice(0, 3), [
    ['失败者', 0, 97], ['死亡', 97, 229], ['鲤鱼打挺', 229, 290],
  ])
  assert.deepEqual(ranges(layout(screenshotTrack, '鲤鱼打挺', 163)).slice(0, 3), [
    ['失败者', 0, 97], ['鲤鱼打挺', 97, 158], ['死亡', 158, 290],
  ])
})

test('插入后非拖动片段固定排布，反向拖回不积累位置变化', () => {
  const before = JSON.stringify(screenshotTrack)
  const expected = layout(screenshotTrack, '鲤鱼打挺', 163).positions
  for (const frame of [150, 125, 162, 163]) assert.deepEqual(layout(screenshotTrack, '鲤鱼打挺', frame).positions, expected)
  assert.deepEqual(layout(screenshotTrack, '鲤鱼打挺', 437).positions['鲤鱼打挺'], { frameStart: 437, frameEnd: 498 })
  assert.equal(JSON.stringify(screenshotTrack), before)
})

test('连续轨道向前跨过多个片段始终紧密排列', () => {
  const track = [c('A', 0, 100), c('B', 100, 200), c('C', 200, 260)]
  assert.deepEqual(ranges(layout(track, 'C', 151)), [['A', 0, 100], ['B', 100, 200], ['C', 200, 260]])
  assert.deepEqual(ranges(layout(track, 'C', 150)), [['A', 0, 100], ['C', 100, 160], ['B', 160, 260]])
  assert.deepEqual(ranges(layout(track, 'C', 50)), [['C', 0, 60], ['A', 60, 160], ['B', 160, 260]])
})

test('向后拖超过目标中点后插入目标后面，之后不回弹', () => {
  const track = [c('A', 0, 60), c('B', 60, 160), c('C', 160, 260)]
  assert.deepEqual(ranges(layout(track, 'A', 50)), [['A', 0, 60], ['B', 60, 160], ['C', 160, 260]])
  const expected = [['B', 0, 100], ['A', 100, 160], ['C', 160, 260]]
  for (const frame of [51, 90, 100, 109]) assert.deepEqual(ranges(layout(track, 'A', frame)), expected)
})

test('向后拖进入目标 Clip 时按三段重叠阈值预览', () => {
  const track = [c('A', 0, 100), c('B', 100, 200), c('C', 200, 260)]
  // 重叠 30%，B 让位到 A 后面，A 保持指针位置。
  assert.deepEqual(ranges(layout(track, 'A', 30)).slice(0, 3), [
    ['A', 30, 130], ['B', 130, 230], ['C', 230, 290],
  ])
  // 重叠超过 1/3 后，A 插入删除预览中 B 当前所在的槽位。
  assert.deepEqual(ranges(layout(track, 'A', 40)).slice(0, 3), [
    ['A', 0, 100], ['B', 100, 200], ['C', 200, 260],
  ])
  // 超过 1/2 后，A 插入 B 后面。
  assert.deepEqual(ranges(layout(track, 'A', 51)).slice(0, 3), [
    ['B', 0, 100], ['A', 100, 200], ['C', 200, 260],
  ])
})

test('空白处可放置，左右两端吸附到最近的合法边界', () => {
  assert.deepEqual(layout(screenshotTrack, '鲤鱼打挺', 300).positions['鲤鱼打挺'], { frameStart: 300, frameEnd: 361 })
  assert.equal(layout(screenshotTrack, '鲤鱼打挺', 231, 4).pointerFrame, 229)
  assert.equal(layout(screenshotTrack, '鲤鱼打挺', 435, 4).pointerFrame, 437)
  assert.equal(layout(screenshotTrack, '鲤鱼打挺', -50).pointerFrame, 0)
})

test('逐帧扫描连续/非连续/不等长轨道：无重叠、时长不变、重复求解一致', () => {
  for (const track of [screenshotTrack, [c('A', 20, 200), c('B', 200, 220), c('C', 220, 250)], [c('A', 0, 10), c('B', 100, 300), c('C', 400, 450)]]) {
    for (const dragged of track) {
      for (let frame = -20; frame <= 720; frame++) {
        const r = layout(track, dragged.id, frame, 4)
        assertNoOverlap(r)
        for (const clip of track) assert.equal(r.positions[clip.id].frameEnd - r.positions[clip.id].frameStart, clip.frameEnd - clip.frameStart)
        assert.deepEqual(r, layout(track, dragged.id, frame, 4))
      }
    }
  }
})

test('拖入空白处也先删除：源位置相连后续前移，下一组的间隔保留', () => {
  const track = [c('A', 0, 50), c('B', 50, 150), c('C', 150, 200), c('D', 250, 300)]
  assert.deepEqual(ranges(layout(track, 'A', 400)), [
    ['B', 0, 100], ['C', 100, 150], ['D', 250, 300], ['A', 400, 450],
  ])
})

test('源片段前方有空隙时，后续片段不会因删除预览提前前移', () => {
  const track = [c('腾空单脚', 70, 115), c('猫步', 115, 152)]
  for (let frame = 71; frame <= 110; frame++) {
    const r = layout(track, '腾空单脚', frame)
    assert.ok(r.positions['猫步'].frameStart >= 115, JSON.stringify(r))
    assert.equal(r.positions['猫步'].frameEnd - r.positions['猫步'].frameStart, 37)
  }
})

test('路径片段重叠时只平移，不缩短后续片段', () => {
  const track = [c('路径一', 40, 80), c('路径二', 80, 125)]
  const r = layout(track, '路径一', 65)
  assert.equal(r.positions['路径二'].frameEnd - r.positions['路径二'].frameStart, 45)
  assertNoOverlap(r)
})
