import { action, makeObservable, observable } from 'mobx'
import type { DirectorDocument } from '../contract/types'
import type { FCurveSet } from '../evaluate/curves/FCurveSet'
import type { UserKeys } from '../evaluate/curves/KeyframeTrack'
import { cloneJson } from './commands/snapshotCommand'

export class DirectorDoc {
  snapshot: DirectorDocument | null = null
  userKeys: UserKeys = {}
  fcurves: FCurveSet | null = null
  revision = 0
  /** Stage.load 持有的同一份文档；undo/redo 只换 content，不换这个引用 */
  private bound: DirectorDocument | null = null

  constructor() {
    makeObservable(this, {
      snapshot: observable.ref,
      userKeys: observable.ref,
      fcurves: observable.ref,
      revision: observable,
      replace: action.bound,
      setUserKeys: action.bound,
      setFcurves: action.bound,
      touch: action.bound,
      applyContent: action.bound,
    })
  }

  replace(doc: DirectorDocument | null): void {
    this.bound = doc
    this.snapshot = doc
    this.userKeys = {}
    this.fcurves = null
    this.revision += 1
  }

  setUserKeys(userKeys: UserKeys): void {
    this.userKeys = userKeys
    this.revision += 1
  }

  setFcurves(fcurves: FCurveSet | null): void {
    this.fcurves = fcurves
    this.revision += 1
  }

  applyContent(source: DirectorDocument): void {
    if (!this.bound) return
    this.bound.content = cloneJson(source.content)
    this.notify()
  }

  touch(): void {
    this.notify()
  }

  toContract(): DirectorDocument | null {
    return this.bound
  }

  private notify(): void {
    this.revision += 1
    if (this.bound) this.snapshot = { ...this.bound }
  }
}
