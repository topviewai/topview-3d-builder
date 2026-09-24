import { test } from 'vitest'
import assert from 'node:assert/strict'
import { History, MERGE_WINDOW_MS } from '../History'
import { StateSnapshotCommand } from '../commands/snapshotCommand'

const realNow = Date.now
let now = 0

function useFakeTime(t = 1000): void {
  now = t
  Date.now = () => now
}

function restoreTime(): void {
  Date.now = realNow
}

/** 以 box.v 为状态的快照命令；before 取构造时的 box.v。 */
function stateCmd(label: string, box: { v: number }, next: number, mergeKey?: string) {
  return new StateSnapshotCommand<number>(
    label,
    box.v,
    next,
    (s) => {
      box.v = s
    },
    mergeKey,
  )
}

test('同 mergeKey 且在合并窗口内：压成一条历史，before=最初，after=最新', () => {
  useFakeTime()
  try {
    const box = { v: 0 }
    const h = new History()
    h.execute(stateCmd('调参', box, 1, 'slider'))
    now += 100
    h.execute(stateCmd('调参', box, 2, 'slider'))
    now += 100
    h.execute(stateCmd('调参', box, 3, 'slider'))

    assert.equal(h.undoStack.length, 1)
    assert.equal(box.v, 3)

    h.undo()
    assert.equal(box.v, 0)
    assert.equal(h.canUndo, false)
    h.redo()
    assert.equal(box.v, 3)
    assert.equal(h.undoStack.length, 1)
  } finally {
    restoreTime()
  }
})

test('不同 mergeKey 不合并；无 mergeKey 不合并', () => {
  useFakeTime()
  try {
    const box = { v: 0 }
    const h = new History()
    h.execute(stateCmd('a', box, 1, 'k1'))
    h.execute(stateCmd('b', box, 2, 'k2'))
    assert.equal(h.undoStack.length, 2)

    const h2 = new History()
    h2.execute(stateCmd('a', box, 3))
    h2.execute(stateCmd('b', box, 4))
    assert.equal(h2.undoStack.length, 2)
  } finally {
    restoreTime()
  }
})

test('超出合并窗口的同键操作不合并', () => {
  useFakeTime()
  try {
    const box = { v: 0 }
    const h = new History()
    h.execute(stateCmd('调参', box, 1, 'slider'))
    now += MERGE_WINDOW_MS
    h.execute(stateCmd('调参', box, 2, 'slider'))
    assert.equal(h.undoStack.length, 2)
    h.undo()
    assert.equal(box.v, 1)
    h.undo()
    assert.equal(box.v, 0)
  } finally {
    restoreTime()
  }
})

test('合并（absorb）同样清空 redo 栈', () => {
  useFakeTime()
  try {
    const box = { v: 0 }
    const h = new History()
    h.execute(stateCmd('a', box, 1, 'k'))
    h.execute(stateCmd('b', box, 2, 'other'))
    h.undo()
    assert.equal(h.canRedo, true)
    // 栈顶是同键命令且窗口内 → absorb；redo 必须失效
    h.execute(stateCmd('a', box, 3, 'k'))
    assert.equal(h.canRedo, false)
    assert.equal(h.undoStack.length, 1)
    h.undo()
    assert.equal(box.v, 0)
  } finally {
    restoreTime()
  }
})

test('endInteraction 提交的命令也走合并逻辑', () => {
  useFakeTime()
  try {
    const box = { v: 0 }
    const h = new History()
    h.beginInteraction()
    const c1 = stateCmd('拖拽', box, 1, 'drag')
    box.v = 1
    h.endInteraction(c1)
    h.beginInteraction()
    const c2 = stateCmd('拖拽', box, 2, 'drag')
    box.v = 2
    h.endInteraction(c2)
    assert.equal(h.undoStack.length, 1)
    h.undo()
    assert.equal(box.v, 0)
    h.redo()
    assert.equal(box.v, 2)
  } finally {
    restoreTime()
  }
})

test('interaction 期间 pushApplied 仍被丢弃，不参与合并', () => {
  useFakeTime()
  try {
    const box = { v: 0 }
    const h = new History()
    h.beginInteraction()
    h.pushApplied(stateCmd('a', box, 1, 'k'))
    assert.equal(h.undoStack.length, 0)
    h.endInteraction()
    assert.equal(h.undoStack.length, 0)
  } finally {
    restoreTime()
  }
})
