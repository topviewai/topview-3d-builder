import { reaction, type IReactionDisposer } from 'mobx'
import { FCurveSet } from '../evaluate/curves/FCurveSet'
import type { StudioSession } from './StudioSession'

export class DocumentSync {
  private readonly disposers: IReactionDisposer[] = []
  private readonly nodeSyncGeneration = new Map<string, number>()
  private readonly nodeSyncTasks = new Map<string, Promise<void>>()
  private disposed = false

  constructor(private readonly session: StudioSession) {
    const { docModel, editor, engine } = session

    this.disposers.push(
      reaction(
        () => [
          docModel.revision,
          docModel.userKeys,
          editor.userKeysEnabled,
          editor.chainCameraMotion,
          editor.activeCameraId,
        ],
        () => {
          engine.setEvalContext({
            userKeys: docModel.userKeys,
            userKeysEnabled: editor.userKeysEnabled,
            chainCameraMotion: editor.chainCameraMotion,
            activeCameraId: editor.activeCameraId,
          })
        },
      ),
    )

    this.disposers.push(
      reaction(
        () => docModel.fcurves,
        (fcurves) => {
          engine.setFcurves(fcurves)
        },
      ),
    )

    this.disposers.push(
      reaction(
        () => [docModel.revision, docModel.userKeys, docModel.fcurves] as const,
        () => {
          if (session.history.interactionActive) return
          const doc = docModel.snapshot
          if (session.hydrating) return
          if (session.writeLocked) return
          if (!doc || typeof session.adapter.onDocumentChange !== 'function') return
          session.adapter.onDocumentChange(
            session.draftId,
            doc,
            FCurveSet.persist(docModel.fcurves, docModel.userKeys),
          )
        },
      ),
    )

    this.disposers.push(
      reaction(
        () => editor.playing,
        (playing) => {
          if (session.editor.workspaceMode !== 'scene') {
            engine.pause()
            return
          }
          if (playing) engine.play()
          else engine.pause()
        },
      ),
    )

    this.disposers.push(
      reaction(
        () => {
          const sel = editor.selection
          return [
            sel?.kind,
            sel && 'nodeId' in sel ? sel.nodeId : '',
            sel && 'clipId' in sel ? sel.clipId : '',
            sel && 'clipType' in sel ? sel.clipType : '',
            editor.gizmoMode,
            editor.followMode,
            editor.pathDrawMode,
            editor.pathEditingId,
            editor.pathEditPointIndex,
            docModel.revision,
          ]
        },
        () => session.syncGizmoState(),
      ),
    )

    this.disposers.push(
      reaction(
        () => (docModel.snapshot?.content.nodes ?? []).map((n) => n.id).join('\0'),
        async (joined, prevJoined) => {
          if (session.hydrating) return
          if (!docModel.snapshot || !engine.ready) return
          const ids = joined ? joined.split('\0') : []
          const prev = prevJoined ? prevJoined.split('\0') : []
          for (const id of prev) {
            if (id && !ids.includes(id)) {
              this.bumpNodeGeneration(id)
              engine.removeNode(id)
            }
          }
          for (const id of ids) {
            if (!id || prev.includes(id) || engine.hasNode(id)) continue
            const node = docModel.snapshot.content.nodes.find((n) => n.id === id)
            if (!node) continue
            const generation = this.bumpNodeGeneration(id)
            await this.enqueueNodeSync(id, async () => {
              const stillPresent = docModel.snapshot?.content.nodes.some((item) => item.id === id) ?? false
              if (this.disposed || this.nodeSyncGeneration.get(id) !== generation || !stillPresent) return
              if (engine.hasNode(id)) return
              await engine.addRuntimeNode(node)
              // 同一 id 的加载必须串行：旧加载清理完成后，重加任务才能创建新实例，
              // 否则旧任务的 removeNode 会误删后完成的新实例。
              const remainsPresent = docModel.snapshot?.content.nodes.some((item) => item.id === id) ?? false
              if (this.disposed || this.nodeSyncGeneration.get(id) !== generation || !remainsPresent) {
                engine.removeNode(id)
              }
            })
          }
        },
      ),
    )
  }

  dispose(): void {
    this.disposed = true
    for (const stop of this.disposers) stop()
    this.disposers.length = 0
  }

  private bumpNodeGeneration(id: string): number {
    const next = (this.nodeSyncGeneration.get(id) ?? 0) + 1
    this.nodeSyncGeneration.set(id, next)
    return next
  }

  private enqueueNodeSync(id: string, run: () => Promise<void>): Promise<void> {
    const previous = this.nodeSyncTasks.get(id) ?? Promise.resolve()
    const pending = previous
      .catch(() => undefined)
      .then(run)
      .catch((error) => {
        console.warn(`[DocumentSync] 节点同步失败: ${id}`, error)
      })
    this.nodeSyncTasks.set(id, pending)
    const clear = () => {
      if (this.nodeSyncTasks.get(id) === pending) this.nodeSyncTasks.delete(id)
    }
    void pending.then(clear, clear)
    return pending
  }
}
