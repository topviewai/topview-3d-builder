import { snapshotDocState, type DirectorDoc, type DocSnapshotState } from '../document'
import type { DirectorDocument, EditSequenceClip } from '../contract/types'
import { nodesOfType } from '../contract/parser'
import {
  activateSequence,
  createSequence,
  defaultInsertRange,
  deleteEditClip,
  deleteSequence,
  duplicateEditClip,
  duplicateSequence,
  findEditClip,
  getActiveEditSequence,
  insertEditClip,
  moveEditClip,
  playbackIssues,
  renameSequence,
  updateEditClip,
} from '../evaluate/editSequenceOps'
import {
  getClipDurationFrames,
  getEditSequence,
  getEditSequenceDurationFrames,
  getEditorial,
  resolveEditSequenceFrame,
} from '../evaluate/editSequence'
import type { FilmPlaybackController } from '../engine/FilmPlaybackController'
import type { DirectorEngine } from '../engine/DirectorEngine'
import type { History } from '../document/History'
import type { EditorStore } from '../stores/EditorStore'
import type { FilmAddDraft, FilmDragKind, FilmDragPreview, FilmSelection, WorkspaceMode } from '../stores/types'

export interface FilmHost {
  engine: DirectorEngine
  docModel: DirectorDoc
  editor: EditorStore
  history: History
  playback: FilmPlaybackController
  pushDocSnapshot(label: string, before: DocSnapshotState): void
  setSceneFrame(frame: number): void
  syncGizmoState(): void
}

export class FilmWorkspace {
  private dragBefore: DirectorDocument | null = null
  private dragRevision = 0

  constructor(private readonly host: FilmHost) {}

  get locked(): boolean {
    return this.host.editor.exporting || this.host.editor.filmDragPreview != null
  }

  setWorkspaceMode(mode: WorkspaceMode): void {
    if (this.host.editor.filmDragPreview || this.host.editor.exporting) return
    if (this.host.editor.workspaceMode === mode) return
    this.pauseAll()
    if (mode === 'film') this.enterFilm()
    else this.exitFilm()
  }

  setFilmSelection(selection: FilmSelection | null): void {
    // 选中已有片段等于放弃正在新建的草稿；否则编辑卡会继续停在「新分镜」上，
    // 用户点轨道看不到任何反应。
    if (selection && this.host.editor.filmAddDraft) this.host.editor.setFilmAddDraft(null)
    this.host.editor.setFilmSelection(selection)
    // 机位面板跟着选中的分镜走
    const clip = this.currentClip()
    if (clip) this.host.editor.setFilmBrowseCameraId(clip.cameraNodeId)
    if (selection) this.previewActiveClip()
    else this.previewBrowseCamera()
  }

  /**
   * 机位面板的切换器带主语：选中分镜时改的是那条分镜的机位（换角度），
   * 未选中时只是换看哪台机位的素材，不动任何分镜。
   */
  setFilmBrowseCamera(cameraNodeId: string): void {
    if (this.host.editor.exporting) return
    this.host.editor.setFilmBrowseCameraId(cameraNodeId)
    const draft = this.host.editor.filmAddDraft
    if (draft) {
      this.updateFilmAddDraft({ cameraNodeId })
      return
    }
    const selected = this.host.editor.filmSelection
    if (selected && !this.locked) {
      this.updateFilmClip(selected.clipId, { cameraNodeId })
      return
    }
    // 纯浏览：画面换到这台机位，播放头停在原处
    this.host.engine.previewProgramFrame(this.host.playback.getSnapshot().sourcePreviewFrame, cameraNodeId)
  }


  /**
   * 立刻插入一条默认分镜并选中它。
   * afterClipId 有值＝插到那条后面；null＝追加到末尾；省略＝跟当前选中走。
   */
  beginFilmAddDraft(afterClipId?: string | null): void {
    if (this.locked) return
    this.pauseAll()
    const doc = this.host.docModel.snapshot
    if (!doc) return
    if (afterClipId === null) this.host.editor.setFilmSelection(null)
    else if (afterClipId) this.host.editor.setFilmSelection({ kind: 'edit-clip', clipId: afterClipId })
    this.host.editor.setFilmAddDraft(null)
    const draft = this.defaultDraft(doc)
    if (!draft) return
    this.insertDraftClip(doc, draft)
  }

  updateFilmAddDraft(patch: Partial<FilmAddDraft>): void {
    const current = this.host.editor.filmAddDraft
    if (!current || this.host.editor.exporting) return
    const next = { ...current, ...patch }
    this.host.editor.setFilmAddDraft(next)
    this.host.playback.seekSource(next.sourceFrameStart, next.sourceFrameStart, next.sourceFrameEnd)
    this.host.engine.previewProgramFrame(next.sourceFrameStart, next.cameraNodeId)
  }

  commitFilmAddDraft(): void {
    const draft = this.host.editor.filmAddDraft
    const doc = this.host.docModel.snapshot
    if (!draft || !doc) return
    this.insertDraftClip(doc, draft)
  }

  cancelFilmAddDraft(): void {
    this.host.editor.setFilmAddDraft(null)
    this.previewActiveClip()
  }

  beginFilmDrag(kind: FilmDragKind, clipId: string): void {
    if (this.locked && !this.host.editor.filmDragPreview) return
    const doc = this.host.docModel.snapshot
    if (!doc) return
    const found = findEditClip(getEditorial(doc), clipId)
    if (!found) return
    this.pauseAll()
    this.dragBefore = doc
    this.dragRevision = this.host.docModel.revision
    const clip = found.sequence.clips[found.clipIndex]
    this.host.editor.setFilmDragPreview({
      kind,
      clipId,
      cameraNodeId: clip.cameraNodeId,
      sourceFrameStart: clip.sourceFrameStart,
      sourceFrameEnd: clip.sourceFrameEnd,
      toIndex: found.clipIndex,
    })
    this.host.editor.setFilmSelection({ kind: 'edit-clip', clipId })
  }

  previewFilmDrag(preview: FilmDragPreview): void {
    if (!this.host.editor.filmDragPreview) return
    if (this.host.docModel.revision !== this.dragRevision) {
      this.cancelFilmDrag()
      return
    }
    this.host.editor.setFilmDragPreview(preview)
    this.host.engine.previewProgramFrame(preview.sourceFrameStart, preview.cameraNodeId)
  }

  commitFilmDrag(): void {
    const preview = this.host.editor.filmDragPreview
    const before = this.dragBefore
    const doc = this.host.docModel.snapshot
    if (!preview || !before || !doc || this.host.docModel.revision !== this.dragRevision) {
      this.cancelFilmDrag()
      return
    }
    const moved = preview.kind === 'sequence-reorder'
      ? moveEditClip(doc, preview.clipId, preview.toIndex ?? 0)
      : updateEditClip(doc, preview.clipId, {
          sourceFrameStart: preview.sourceFrameStart,
          sourceFrameEnd: preview.sourceFrameEnd,
        })
    this.dragBefore = null
    this.host.editor.setFilmDragPreview(null)
    if (moved.ok) this.commitEditorial(dragLabel(preview.kind), moved)
    this.previewActiveClip()
  }

  cancelFilmDrag(): void {
    this.dragBefore = null
    this.host.editor.setFilmDragPreview(null)
    this.previewActiveClip()
  }

  createFilmSequence(name?: string): void {
    if (this.locked) return
    const doc = this.host.docModel.snapshot
    if (!doc) return
    const result = createSequence(doc, { name, activate: true })
    if (this.commitEditorial('新建成片版本', result) && result.ok) {
      this.host.editor.setFilmSelection(null)
      this.previewSequenceHead()
    }
  }

  renameFilmSequence(sequenceId: string, name: string | null): void {
    if (this.locked) return
    const doc = this.host.docModel.snapshot
    if (!doc) return
    this.commitEditorial('重命名成片版本', renameSequence(doc, sequenceId, name))
  }

  duplicateFilmSequence(sequenceId: string): void {
    if (this.locked) return
    const doc = this.host.docModel.snapshot
    if (!doc) return
    const result = duplicateSequence(doc, sequenceId)
    if (this.commitEditorial('复制成片版本', result) && result.ok) {
      this.host.editor.setFilmSelection(null)
      this.previewSequenceHead()
    }
  }

  deleteFilmSequence(sequenceId: string): void {
    if (this.locked) return
    const doc = this.host.docModel.snapshot
    if (!doc) return
    const result = deleteSequence(doc, sequenceId)
    if (this.commitEditorial('删除成片版本', result)) {
      this.host.editor.setFilmSelection(null)
      this.previewSequenceHead()
    }
  }

  activateFilmSequence(sequenceId: string): void {
    if (this.locked) return
    const doc = this.host.docModel.snapshot
    if (!doc) return
    const result = activateSequence(doc, sequenceId)
    if (this.commitEditorial('切换成片版本', result)) {
      this.host.editor.setFilmSelection(null)
      this.previewSequenceHead()
    }
  }

  duplicateFilmClip(clipId: string): void {
    if (this.locked) return
    const doc = this.host.docModel.snapshot
    if (!doc) return
    const result = duplicateEditClip(doc, clipId)
    if (this.commitEditorial('复制分镜', result) && result.ok && result.createdId) {
      this.host.editor.setFilmSelection({ kind: 'edit-clip', clipId: result.createdId })
      this.previewActiveClip()
    }
  }

  deleteFilmClip(clipId: string): void {
    if (this.locked) return
    const doc = this.host.docModel.snapshot
    if (!doc) return
    const result = deleteEditClip(doc, clipId)
    if (this.commitEditorial('删除分镜', result)) {
      this.host.editor.setFilmSelection(null)
    }
  }

  updateFilmClip(
    clipId: string,
    patch: Partial<Pick<EditSequenceClip, 'cameraNodeId' | 'sourceFrameStart' | 'sourceFrameEnd'>>,
  ): void {
    if (this.locked) return
    const doc = this.host.docModel.snapshot
    if (!doc) return
    if (this.commitEditorial('编辑分镜', updateEditClip(doc, clipId, patch))) {
      this.previewActiveClip()
    }
  }

  seekFilmSequence(frame: number): void {
    if (this.host.editor.exporting) return
    this.pauseAll()
    const doc = this.host.docModel.snapshot
    if (!doc) return
    const sequence = getActiveEditSequence(doc)
    if (!sequence) return
    const duration = getEditSequenceDurationFrames(sequence.clips)
    this.host.playback.setFps(doc.content.timeline.fps)
    this.host.playback.seekSequence(frame, duration)
    this.applyResolved(doc, sequence.id, this.host.playback.getSnapshot().sequenceFrame)
  }

  seekFilmSource(frame: number): void {
    if (this.host.editor.exporting) return
    this.pauseAll()
    const doc = this.host.docModel.snapshot
    if (!doc) return
    const cameraId = this.currentClip()?.cameraNodeId ?? this.resolveBrowseCamera(doc)
    if (!cameraId) return
    // 源条是整条素材的时间轴：拖播放头要能走出入出点去找画面，
    // 只有「预览选段」才被选区框住（playSource 自己会重设播放区间）。
    const tl = doc.content.timeline
    this.host.playback.seekSource(frame, tl.frameStart, tl.frameEnd)
    this.host.engine.previewProgramFrame(this.host.playback.getSnapshot().sourcePreviewFrame, cameraId)
  }

  playFilmSequence(): void {
    if (this.host.editor.exporting || this.host.editor.filmAddDraft) return
    const doc = this.host.docModel.snapshot
    if (!doc) return
    const sequence = getActiveEditSequence(doc)
    if (!sequence || playbackIssues(doc, sequence.id).length > 0) return
    const duration = getEditSequenceDurationFrames(sequence.clips)
    if (duration <= 0) return
    this.host.editor.setPlaying(false)
    this.host.engine.pause()
    this.host.playback.setFps(doc.content.timeline.fps)
    this.host.playback.playSequence(duration)
    this.host.editor.setFilmClock('sequence')
  }

  playFilmSource(): void {
    if (this.host.editor.exporting) return
    const clip = this.currentClip()
    const doc = this.host.docModel.snapshot
    if (!clip || !doc) return
    this.host.editor.setPlaying(false)
    this.host.engine.pause()
    this.host.playback.setFps(doc.content.timeline.fps)
    this.host.playback.playSource(clip.sourceFrameStart, clip.sourceFrameEnd)
    this.host.editor.setFilmClock('source')
  }

  pauseFilm(): void {
    this.host.playback.pause()
    this.host.editor.setFilmClock('idle')
  }

  togglePlay(): void {
    if (this.host.editor.workspaceMode !== 'film') return
    if (this.host.playback.getSnapshot().mode !== 'idle') {
      this.pauseFilm()
      return
    }
    if (this.host.editor.filmAddDraft) this.playFilmSource()
    else this.playFilmSequence()
  }

  stepFrame(delta: number): void {
    if (this.host.editor.workspaceMode !== 'film') return
    const snap = this.host.playback.getSnapshot()
    if (this.host.editor.filmAddDraft || snap.mode === 'source') {
      this.seekFilmSource(snap.sourcePreviewFrame + delta)
      return
    }
    this.seekFilmSequence(snap.sequenceFrame + delta)
  }

  syncPlayback(snapshot: ReturnType<FilmPlaybackController['getSnapshot']>): void {
    this.host.editor.setFilmClock(snapshot.mode)
    const doc = this.host.docModel.snapshot
    if (!doc || this.host.editor.workspaceMode !== 'film') return
    if (snapshot.mode === 'source' || this.host.editor.filmAddDraft) {
      const cameraId = this.host.editor.filmAddDraft?.cameraNodeId
        ?? this.currentClip()?.cameraNodeId
        ?? this.resolveBrowseCamera(doc)
      if (cameraId) this.host.engine.previewProgramFrame(snapshot.sourcePreviewFrame, cameraId)
      return
    }
    const sequence = getActiveEditSequence(doc)
    if (sequence) this.applyResolved(doc, sequence.id, snapshot.sequenceFrame)
  }

  handleDocumentChange(): void {
    if (this.host.editor.workspaceMode !== 'film') return
    const doc = this.host.docModel.snapshot
    if (!doc) return
    const editorial = getEditorial(doc)
    const selected = this.host.editor.filmSelection
    if (selected && !findEditClip(editorial, selected.clipId)) {
      this.host.editor.setFilmSelection(null)
    }
    this.previewActiveClip()
  }

  private enterFilm(): void {
    const editor = this.host.editor
    editor.setSceneResume({
      frame: this.host.engine.currentFrame,
      cameraId: editor.activeCameraId,
      selection: editor.selection,
      followMode: editor.followMode,
      libraryOpen: editor.libraryOpen,
      inspectorOpen: editor.inspectorOpen,
    })
    editor.setPlaying(false)
    this.host.engine.pause()
    editor.setWorkspaceModeFlag('film')
    // 面板常驻，进来就得有机位可看
    editor.setFilmBrowseCameraId(this.currentClip()?.cameraNodeId ?? editor.activeCameraId ?? null)
    editor.setPanelsOpen(false, false)
    editor.setFollowModeFlag(false)
    this.host.engine.setOrbitEnabled(false)
    this.host.engine.beginProgramPreview()
    this.host.syncGizmoState()
    this.previewActiveClip()
  }

  private exitFilm(): void {
    this.pauseAll()
    this.host.editor.setFilmAddDraft(null)
    this.host.editor.setFilmDragPreview(null)
    this.host.editor.setFilmExportOpen(false)
    this.host.engine.endProgramPreview()
    const resume = this.host.editor.sceneResume
    this.host.editor.setWorkspaceModeFlag('scene')
    this.host.editor.setSceneResume(null)
    this.host.engine.setOrbitEnabled(true)
    if (resume) {
      this.host.editor.setPanelsOpen(resume.libraryOpen, resume.inspectorOpen)
      this.host.editor.select(resume.selection)
      if (resume.cameraId) this.host.editor.setActiveCamera(resume.cameraId)
      this.host.editor.setFollowModeFlag(resume.followMode)
      if (resume.followMode) this.host.engine.beginFollow()
      this.host.setSceneFrame(resume.frame)
    }
    this.host.syncGizmoState()
  }

  private pauseAll(): void {
    this.host.editor.setPlaying(false)
    this.host.engine.pause()
    this.pauseFilm()
  }

  /**
   * 新建草稿优先于选中片段：编辑卡此时显示的就是草稿，
   * 预览 / 播放必须跟着草稿的入出点走，否则「预览选段」会播到别的片段上去。
   */
  private currentClip(): EditSequenceClip | null {
    const draft = this.host.editor.filmAddDraft
    if (draft) return { id: 'draft', ...draft }
    const doc = this.host.docModel.snapshot
    const selected = this.host.editor.filmSelection
    if (!doc || !selected) return null
    const found = findEditClip(getEditorial(doc), selected.clipId)
    return found ? found.sequence.clips[found.clipIndex] : null
  }

  private previewActiveClip(): void {
    const doc = this.host.docModel.snapshot
    if (!doc || this.host.editor.workspaceMode !== 'film') return
    const clip = this.currentClip()
    if (clip) {
      this.host.playback.seekSource(clip.sourceFrameStart, clip.sourceFrameStart, clip.sourceFrameEnd)
      this.host.engine.previewProgramFrame(clip.sourceFrameStart, clip.cameraNodeId)
      return
    }
    this.previewBrowseCamera()
  }

  /** 未选分镜时只看浏览机位，不要跳回视频轨道片头（那是另一台机位的画面）。 */
  private previewBrowseCamera(): void {
    const doc = this.host.docModel.snapshot
    if (!doc || this.host.editor.workspaceMode !== 'film') return
    const cameraId = this.resolveBrowseCamera(doc)
    if (!cameraId) {
      this.previewSequenceHead()
      return
    }
    const tl = doc.content.timeline
    const frame = this.host.playback.getSnapshot().sourcePreviewFrame
    this.host.playback.setFps(tl.fps)
    this.host.playback.seekSource(frame, tl.frameStart, tl.frameEnd)
    this.host.engine.previewProgramFrame(this.host.playback.getSnapshot().sourcePreviewFrame, cameraId)
  }

  private previewSequenceHead(): void {
    const doc = this.host.docModel.snapshot
    if (!doc) return
    const sequence = getActiveEditSequence(doc)
    if (!sequence) return
    const duration = getEditSequenceDurationFrames(sequence.clips)
    this.host.playback.setFps(doc.content.timeline.fps)
    this.host.playback.seekSequence(0, duration)
    if (duration > 0) this.applyResolved(doc, sequence.id, 0)
  }

  private applyResolved(doc: DirectorDocument, sequenceId: string, sequenceFrame: number): void {
    const resolved = resolveEditSequenceFrame(getEditSequence(doc, sequenceId)?.clips ?? [], sequenceFrame)
    if (!resolved) return
    this.host.engine.previewProgramFrame(resolved.sourceFrame, resolved.cameraNodeId)
  }

  /** 新分镜会插在谁后面：选中的那条，否则是序列末尾那条。与 commitFilmAddDraft 的插入下标同源。 */
  private clipBeforeInsert(doc: DirectorDocument): EditSequenceClip | null {
    const sequence = getActiveEditSequence(doc)
    if (!sequence || sequence.clips.length === 0) return null
    const selected = this.host.editor.filmSelection
    const found = selected ? findEditClip(getEditorial(doc), selected.clipId) : null
    if (found && found.sequence.id === sequence.id) return found.sequence.clips[found.clipIndex]
    return sequence.clips[sequence.clips.length - 1]
  }

  private resolveBrowseCamera(doc: DirectorDocument): string | null {
    const cameras = nodesOfType(doc, 'camera')
    const browse = this.host.editor.filmBrowseCameraId
    if (browse && cameras.some((camera) => camera.id === browse)) return browse
    return cameras[0]?.id ?? null
  }

  private insertDraftClip(doc: DirectorDocument, draft: FilmAddDraft): void {
    const sequence = getActiveEditSequence(doc)
    if (!sequence) return
    const selected = this.host.editor.filmSelection
    const found = selected ? findEditClip(getEditorial(doc), selected.clipId) : null
    const index = found && found.sequence.id === sequence.id ? found.clipIndex + 1 : sequence.clips.length
    const result = insertEditClip(doc, {
      sequenceId: sequence.id,
      cameraNodeId: draft.cameraNodeId,
      sourceFrameStart: draft.sourceFrameStart,
      sourceFrameEnd: draft.sourceFrameEnd,
      index,
    })
    if (this.commitEditorial('添加分镜', result) && result.ok && result.createdId) {
      this.host.editor.setFilmAddDraft(null)
      this.host.editor.setFilmSelection({ kind: 'edit-clip', clipId: result.createdId })
      this.host.editor.setFilmBrowseCameraId(draft.cameraNodeId)
      this.previewActiveClip()
    }
  }

  private defaultDraft(doc: DirectorDocument): FilmAddDraft | null {
    const cameras = nodesOfType(doc, 'camera')
    const previous = this.clipBeforeInsert(doc)
    // 机位跟面板当前在看的那台；时间才接上一段末尾。
    const cameraNodeId = this.resolveBrowseCamera(doc)
      ?? previous?.cameraNodeId
      ?? this.host.editor.activeCameraId
      ?? cameras[0]?.id
    if (!cameraNodeId || !cameras.some((camera) => camera.id === cameraNodeId)) return null
    // 素材时间接着上一段末尾往下走：换机位是换角度，故事时间仍然连续；
    // 沿用上一段的入点只会把同一区间再剪一遍。
    const sourceFrame = previous
      ? previous.sourceFrameEnd + 1
      : doc.content.timeline.frameStart
    return {
      cameraNodeId,
      ...defaultInsertRange(doc, sourceFrame, doc.content.timeline.fps * 2),
    }
  }

  private commitEditorial(
    label: string,
    result: { ok: boolean; editorial?: DirectorDocument['content']['editorial'] },
  ): boolean {
    const live = this.host.docModel.toContract()
    if (!live || !result.ok || !result.editorial) return false
    const before = snapshotDocState(this.host.docModel)
    if (!before) return false
    live.content.editorial = result.editorial
    this.host.docModel.touch()
    this.host.pushDocSnapshot(label, before)
    return true
  }
}

function dragLabel(kind: FilmDragKind): string {
  if (kind === 'sequence-reorder') return '调整分镜顺序'
  if (kind.startsWith('source-trim') || kind.startsWith('sequence-trim')) return '裁剪分镜'
  return '平移分镜'
}

export function filmClipDuration(clip: Pick<EditSequenceClip, 'sourceFrameStart' | 'sourceFrameEnd'>): number {
  return getClipDurationFrames(clip)
}

export function canPlayFilm(doc: DirectorDocument, sequenceId: string): boolean {
  return playbackIssues(doc, sequenceId).length === 0
}
