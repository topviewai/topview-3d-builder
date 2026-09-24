import { test } from 'vitest'
import assert from 'node:assert/strict'
import { History } from '../History'
import type { Command } from '../commands/types'

function cmd(label: string, log: string[]): Command {
  return {
    label,
    execute: () => {
      log.push(`do:${label}`)
    },
    undo: () => {
      log.push(`undo:${label}`)
    },
  }
}

test('undoStack 超限从栈底丢弃，canUndo / redo 语义不变', () => {
  const log: string[] = []
  const history = new History(3)
  history.execute(cmd('a', log))
  history.execute(cmd('b', log))
  history.execute(cmd('c', log))
  history.execute(cmd('d', log))

  assert.deepEqual(
    history.undoStack.map((c) => c.label),
    ['b', 'c', 'd'],
  )
  assert.equal(history.canUndo, true)
  assert.equal(history.canRedo, false)

  history.undo()
  history.undo()
  history.undo()
  assert.equal(history.canUndo, false)
  assert.equal(history.canRedo, true)
  assert.deepEqual(history.undoStack.map((c) => c.label), [])
  assert.deepEqual(
    history.redoStack.map((c) => c.label),
    ['d', 'c', 'b'],
  )

  history.redo()
  assert.equal(history.canUndo, true)
  assert.deepEqual(history.undoStack.map((c) => c.label), ['b'])
  assert.ok(!log.includes('undo:a'))
})
