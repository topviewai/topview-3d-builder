import { action, computed, makeObservable, observable } from 'mobx'
import type { Command } from './commands/types'

/** 超限从栈底丢掉最早的历史；redo 入栈不走这条。 */
export const MAX_HISTORY = 50

/** 连续输入合并窗口：同 mergeKey 且距栈顶入栈时间小于该值时被 absorb。 */
export const MERGE_WINDOW_MS = 1000

export class History {
  readonly undoStack: Command[] = []
  readonly redoStack: Command[] = []
  /** 与 undoStack 平行的入栈时间（ms），merge 窗口判定用。 */
  private undoTimes: number[] = []
  private interaction = 0
  private readonly maxHistory: number

  constructor(maxHistory = MAX_HISTORY) {
    this.maxHistory = maxHistory
    makeObservable(this, {
      undoStack: observable.shallow,
      redoStack: observable.shallow,
      canUndo: computed,
      canRedo: computed,
      execute: action.bound,
      pushApplied: action.bound,
      undo: action.bound,
      redo: action.bound,
      clear: action.bound,
      beginInteraction: action.bound,
      endInteraction: action.bound,
    })
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get interactionActive(): boolean {
    return this.interaction > 0
  }

  execute(command: Command): void {
    command.execute()
    this.pushApplied(command)
  }

  pushApplied(command: Command): void {
    if (this.interaction > 0) return
    // 变更已经发生，无论合并还是入栈，redo 都失效。
    this.redoStack.length = 0
    this.pushOrMerge(command)
  }

  undo(): void {
    const command = this.undoStack.pop()
    if (!command) return
    this.undoTimes.pop()
    command.undo()
    this.redoStack.push(command)
  }

  redo(): void {
    const command = this.redoStack.pop()
    if (!command) return
    command.execute()
    this.pushUndo(command, Date.now())
  }

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.undoTimes.length = 0
    this.interaction = 0
  }

  beginInteraction(): void {
    this.interaction += 1
  }

  endInteraction(command?: Command): void {
    this.interaction = Math.max(0, this.interaction - 1)
    if (command && this.interaction === 0) {
      this.redoStack.length = 0
      this.pushOrMerge(command)
    }
  }

  /**
   * 同 mergeKey 且在合并窗口内 → 栈顶 absorb（before 保持最初，after 更新为最新），
   * 否则正常入栈。不同 key、空 key、栈顶不支持 absorb、窗口过期都不合并。
   */
  private pushOrMerge(command: Command): void {
    const now = Date.now()
    const top = this.undoStack[this.undoStack.length - 1]
    if (
      top &&
      command.mergeKey &&
      top.mergeKey === command.mergeKey &&
      typeof top.absorb === 'function' &&
      now - this.undoTimes[this.undoTimes.length - 1] < MERGE_WINDOW_MS
    ) {
      top.absorb(command)
      this.undoTimes[this.undoTimes.length - 1] = now
      return
    }
    this.pushUndo(command, now)
  }

  private pushUndo(command: Command, time: number): void {
    this.undoStack.push(command)
    this.undoTimes.push(time)
    while (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift()
      this.undoTimes.shift()
    }
  }
}
