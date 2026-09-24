import type { Command } from './types'

export class SnapshotCommand implements Command {
  constructor(
    readonly label: string,
    private readonly apply: () => void,
    private readonly revert: () => void,
  ) {}

  execute(): void {
    this.apply()
  }

  undo(): void {
    this.revert()
  }
}

/**
 * 持有 before/after 状态的快照命令：execute 写 after、undo 写 before；
 * absorb 用后续同键命令的 after 覆盖自己的 after（before 保持最初值），
 * 配合 History 的 mergeKey 合并窗口把连续输入压成一条历史。
 */
export class StateSnapshotCommand<T> implements Command {
  readonly mergeKey?: string

  constructor(
    readonly label: string,
    private before: T,
    private after: T,
    private readonly applyState: (state: T) => void,
    mergeKey?: string,
  ) {
    this.mergeKey = mergeKey
  }

  execute(): void {
    this.applyState(this.after)
  }

  undo(): void {
    this.applyState(this.before)
  }

  absorb(next: Command): void {
    if (next instanceof StateSnapshotCommand) {
      this.after = (next as StateSnapshotCommand<T>).after
    }
  }
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
