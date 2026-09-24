export interface Command {
  readonly label: string
  /**
   * 连续输入合并键：非空且与撤销栈顶相同、距栈顶入栈时间在合并窗口内时，
   * 新命令被栈顶 absorb 而不是单独入栈（一次拖拽 / 连续调参 = 一条历史）。
   */
  readonly mergeKey?: string
  execute(): void
  undo(): void
  /** 吸收后续同键命令：更新自己的 after，保留最初的 before。 */
  absorb?(next: Command): void
}
