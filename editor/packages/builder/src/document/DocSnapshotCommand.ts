import { runInAction } from 'mobx'
import type { DirectorDocument } from '../contract/types'
import { FCurveSet, type CompactFCurvesJson } from '../evaluate/curves/FCurveSet'
import type { UserKeys } from '../evaluate/curves/KeyframeTrack'
import { cloneJson } from './commands/snapshotCommand'
import type { Command } from './commands/types'
import type { DirectorDoc } from './DirectorDoc'

/**
 * 一条历史命令覆盖的全部可撤销状态：文档 content + 时间线 userKeys + 官方 fcurves。
 * fcurves 以 compact-v1 JSON 快照（encode/parse 往返无损），避免持有被原地改写的类实例。
 */
export interface DocSnapshotState {
  doc: DirectorDocument
  userKeys: UserKeys
  fcurves: CompactFCurvesJson | null
}

/** 抓取当前完整状态；无文档（未加载）时返回 null。 */
export function snapshotDocState(docModel: DirectorDoc): DocSnapshotState | null {
  const live = docModel.toContract()
  if (!live) return null
  return {
    doc: cloneJson(live),
    userKeys: cloneJson(docModel.userKeys),
    fcurves: docModel.fcurves ? cloneJson(docModel.fcurves.encode()) : null,
  }
}

/**
 * 把状态写回 DirectorDoc。包成单个 runInAction：三个 setter 各自推 revision，
 * 若不合并，DocumentSync 的 reaction 会在「新 content + 旧 fcurves」等中间态上
 * 反复求值，最终运行时停留在中间态（undo/redo 后视口值慢一步）。
 */
export function restoreDocState(docModel: DirectorDoc, state: DocSnapshotState): void {
  runInAction(() => {
    docModel.applyContent(state.doc)
    docModel.setUserKeys(cloneJson(state.userKeys))
    docModel.setFcurves(state.fcurves ? FCurveSet.parse(cloneJson(state.fcurves)) : null)
  })
}

/** content + userKeys + fcurves 三合一快照命令，undo/redo 整体恢复。 */
export class DocSnapshotCommand implements Command {
  readonly mergeKey?: string

  constructor(
    readonly label: string,
    private readonly docModel: DirectorDoc,
    private before: DocSnapshotState,
    private after: DocSnapshotState,
    mergeKey?: string,
  ) {
    this.mergeKey = mergeKey
  }

  execute(): void {
    restoreDocState(this.docModel, this.after)
  }

  undo(): void {
    restoreDocState(this.docModel, this.before)
  }

  absorb(next: Command): void {
    if (next instanceof DocSnapshotCommand) this.after = next.after
  }
}
