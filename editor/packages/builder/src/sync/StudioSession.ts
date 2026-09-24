import { computed, makeObservable, observable, runInAction } from 'mobx'
import { previewClipMove } from '../document/clipMove'
import { rippleResizeClip } from '../document/clipRipple'
import { normalizeAspectRatio, widthFromAspectHeight } from '../contract/aspectRatio'
import type { DirectorDocument, DraftNode } from '../contract/types'
import { makeEmptyDraft } from '../contract/emptyDraft'
import { nodesOfType } from '../contract/parser'
import { hydrateSkyColor } from '../contract/skyColor'
import { CAMERA_PRESETS } from '../data/cameraLibrary'
import { collectUsedPoseIds, ensurePoseBones } from './ensurePoseBones'
import {
  cloneJson,
  DocSnapshotCommand,
  restoreDocState,
  snapshotDocState,
  SnapshotCommand,
  type DirectorDoc,
  type DocSnapshotState,
  type History,
} from '../document'
import { FCurveSet } from '../evaluate/curves/FCurveSet'
import {
  makeKeyframe,
  type Interpolation,
  type TrackProp,
  type UserKeys,
} from '../evaluate/curves/KeyframeTrack'
import type { CaptureFrameInput, DirectorEngine } from '../engine/DirectorEngine'
import { FilmPlaybackController } from '../engine/FilmPlaybackController'
import type {CharacterLibEntry, HostAdapter } from '../host/types'
import type {
  DuplicateSelectionInput,
  EnvironmentPatch,
  FilmAddDraft,
  FilmDragKind,
  FilmDragPreview,
  FilmSelection,
  KeyframeRef,
  LibraryTab,
  PendingKeyframe,
  Selection,
  GizmoMode,
  PathDrawStyle,
  SaveOptions,
  SaveState,
  WorkspaceMode,
} from '../stores/types'
import { buildNodeSelection, isLookAtPickTarget, isPathApplyPickTarget, isPathApplyTarget, isPathEditTarget, nodeIdsOf, unlockedNodeIds } from '../stores/nodeSelection'
import { clipRefsOf, keyframeRefsOf, makeKeyframeSelection, type ClipRef } from '../stores/types'
import type { EditorStore } from '../stores/EditorStore'
import type { StudioView } from '../stores/types'
import { downloadJson } from './downloadJson'
import { FilmWorkspace } from './filmWorkspace'
import * as library from './libraryActions'
import { isDerivedTransformPath, rederiveWalkPaths, timelinePathClips } from '../evaluate/path/deriveWalk'
import { duplicateNodes, transformDeltaFromTo, type TransformDelta } from './duplicateNodes'
import type { FCurve, FCurveKey } from '../evaluate/curves/FCurveSet'
import { cameraMotionOwnsKeyframes } from '../evaluate/camera/cameraMotionExclusive'
import { nodeHasAnimatedTransform } from '../evaluate/stagedTransform'
import {
  applyTransformEdit,
  changedKeyframeWrites,
  documentTransformBaseline,
  liveNodeTransformFromPatch,
  nodeHasUserXformKeys,
  pendingFieldsFromPatch,
  stagedTransformFromPatch,
  transformKeyframeWrites,
  type TransformEditPatch,
} from './transformEdit'
import { remapFrame } from '../evaluate/timecode'
import {
  pathArcLength,
  pathClipDurationFrames,
  pathControlCentroid,
  writePathPointWorld,
} from '../evaluate/path/samplePath'
import type { PathMotionClip } from '../contract/types'

function withPathClipRange(clip: PathMotionClip, frameStart: number, frameEnd: number): PathMotionClip {
  const coverage = (clip.pathEndPercent - clip.pathStartPercent) / 100
  const span = frameEnd - frameStart
  return {
    ...clip,
    frameStart,
    frameEnd,
    playback: {
      ...clip.playback,
      baseDurationFrames: coverage > 1e-6 ? Math.max(1, Math.round(span / coverage)) : span,
    },
  }
}

export class StudioSession implements StudioView {
  private interactionBefore: DocSnapshotState | null = null
  private cameraAimReleasePending = false

  queueCameraAimReleased = (): void => {
    this.cameraAimReleasePending = true
  }
  private clipResizeBefore: DocSnapshotState | null = null
  private clipResizeRevision = 0
  private clipMoveBefore: DocSnapshotState | null = null
  private clipMoveSelection: ClipRef[] = []
  private clipMoveRevision = 0
  private loadSeq = 0
  private pendingHostReload = false
  hydrating = false
  hostReadOnly = false
  private pendingUserWrites = new Set<Promise<unknown>>()
  private saveInFlight: Promise<string | null> | null = null
  private pendingSaveCaptureCover = false
  private engineCover: Promise<void> | null = null
  private lastSavedRevision = 0
  private poseEditBefore: DocSnapshotState | null = null
  private timelineRangeBefore: DirectorDocument | null = null
  readonly playback = new FilmPlaybackController()
  readonly film: FilmWorkspace

  constructor(
    readonly engine: DirectorEngine,
    readonly docModel: DirectorDoc,
    readonly editor: EditorStore,
    readonly history: History,
    readonly adapter: HostAdapter<DirectorDocument>,
    options?: { readOnly?: boolean },
  ) {
    this.hostReadOnly = options?.readOnly === true
    makeObservable<this, 'lastSavedRevision'>(this, {
      hostReadOnly: observable,
      writeLocked: computed,
      lastSavedRevision: observable,
    })
    this.film = new FilmWorkspace({
      engine,
      docModel,
      editor,
      history,
      playback: this.playback,
      pushDocSnapshot: (label, before) => this.pushDocSnapshot(label, before),
      setSceneFrame: (frame) => this.setFrame(frame),
      syncGizmoState: () => this.syncGizmoState(),
    })
    this.playback.subscribe((snapshot) => this.film.syncPlayback(snapshot))
  }

  get writeLocked(): boolean {
    return this.hostReadOnly
  }

  private isCameraNode(nodeId: string): boolean {
    return this.docModel.snapshot?.content.nodes.some((n) => n.id === nodeId && n.type === 'camera') ?? false
  }

  get clipMovePreview() {
    return this.editor.clipMovePreview
  }

  get clipResizePreview() {
    return this.editor.clipResizePreview
  }

  get draftId(): string {
    return this.editor.draftId
  }
  get doc(): DirectorDocument | null {
    return this.docModel.snapshot
  }
  get loadStatus(): string {
    return this.editor.loadStatus
  }
  get ready(): boolean {
    return this.editor.ready
  }
  get frame(): number {
    return this.engine.currentFrame
  }
  get playing(): boolean {
    return this.editor.playing
  }
  get activeCameraId(): string | null {
    return this.editor.activeCameraId
  }
  get selection(): Selection | null {
    return this.editor.selection
  }
  get userKeys(): UserKeys {
    return this.docModel.userKeys
  }
  get userKeysEnabled(): boolean {
    return this.editor.userKeysEnabled
  }
  get autoKeyframe(): boolean {
    return this.editor.autoKeyframe
  }
  get timelineSnap(): boolean {
    return this.editor.timelineSnap
  }
  get pendingKeyframe(): PendingKeyframe | null {
    return this.editor.pendingKeyframes[0] ?? null
  }
  get chainCameraMotion(): boolean {
    return this.editor.chainCameraMotion
  }
  get pxPerFrame(): number {
    return this.editor.pxPerFrame
  }
  get fcurves(): FCurveSet | null {
    return this.docModel.fcurves
  }
  get exporting(): boolean {
    return this.editor.exporting
  }
  get libraryOpen(): boolean {
    return this.editor.libraryOpen
  }
  get libraryTab(): LibraryTab {
    return this.editor.libraryTab
  }
  get libraryContentWidth(): number {
    return this.editor.libraryContentWidth
  }
  get inspectorOpen(): boolean {
    return this.editor.inspectorOpen
  }
  get inspectorContentWidth(): number {
    return this.editor.inspectorContentWidth
  }
  get timelineOpen(): boolean {
    return this.editor.timelineOpen
  }
  get timelineVisible(): boolean {
    return this.editor.timelineVisible
  }
  get timelinePlayHintVisible(): boolean {
    return this.editor.timelinePlayHintVisible
  }
  get timelinePlayHintUntil(): number {
    return this.editor.timelinePlayHintUntil
  }
  get timelineHeight(): number {
    return this.editor.timelineHeight
  }
  get viewportFullscreen(): boolean {
    return this.editor.viewportFullscreen
  }
  get followMode(): boolean {
    return this.editor.followMode
  }
  get poseEditingId(): string | null {
    return this.editor.poseEditingId
  }
  get cameraPilotId(): string | null {
    return this.editor.cameraPilotId
  }
  get pathEditingId(): string | null {
    return this.editor.pathEditingId
  }
  get pathEditPointIndex(): number | null {
    return this.editor.pathEditPointIndex
  }
  get lookAtPickingId(): string | null {
    return this.editor.lookAtPickingId
  }
  get pathApplyPickingId(): string | null {
    return this.editor.pathApplyPickingId
  }
  get gizmoMode(): GizmoMode {
    return this.editor.gizmoMode
  }
  get pathDrawMode(): boolean {
    return this.editor.pathDrawMode
  }
  get pathDrawStyle(): PathDrawStyle {
    return this.editor.pathDrawStyle
  }
  get pathDrawPoints(): [number, number, number][] {
    return this.editor.pathDrawPoints
  }
  get workspaceMode() {
    return this.editor.workspaceMode
  }
  get filmSelection() {
    return this.editor.filmSelection
  }
  get filmAddDraft() {
    return this.editor.filmAddDraft
  }
  get filmBrowseCameraId() {
    return this.editor.filmBrowseCameraId
  }
  get filmDragPreview() {
    return this.editor.filmDragPreview
  }
  get filmTimelineHeight() {
    return this.editor.filmTimelineHeight
  }
  get filmPxPerFrame() {
    return this.editor.filmPxPerFrame
  }
  get filmTrackAligned() {
    return this.editor.filmTrackAligned
  }
  get filmClock() {
    return this.editor.filmClock
  }
  get filmExportOpen() {
    return this.editor.filmExportOpen
  }
  get canUndo(): boolean {
    return this.history.canUndo
  }
  get interactionActive(): boolean {
    return this.history.interactionActive
  }
  get canRedo(): boolean {
    return this.history.canRedo
  }

  toggleLibrary = (): void => this.editor.toggleLibrary()
  setLibraryTab = (t: LibraryTab): void => this.editor.setLibraryTab(t)
  setLibraryContentWidth = (w: number): void => this.editor.setLibraryContentWidth(w)
  toggleInspector = (): void => this.editor.toggleInspector()
  setInspectorContentWidth = (w: number): void => this.editor.setInspectorContentWidth(w)
  toggleTimeline = (): void => this.editor.toggleTimeline()
  toggleTimelinePanel = (): void => this.editor.toggleTimelinePanel()
  openTimeline = (): void => this.editor.openTimeline()
  requestTimelinePlayHint = (): void => this.editor.requestTimelinePlayHint()
  dismissTimelinePlayHint = (): void => this.editor.dismissTimelinePlayHint()
  acceptTimelinePlayHint = (): void => this.editor.acceptTimelinePlayHint()
  setTimelineHeight = (h: number): void => this.editor.setTimelineHeight(h)
  toggleViewportFullscreen = (): void => this.editor.toggleViewportFullscreen()
  setNodeFlags = (nodeId: string, flags: { visible?: boolean; locked?: boolean }): string | null =>
    this.writeLocked ? 'write-locked' : library.setNodeFlags(this, nodeId, flags)
  updateEnvironment = (patch: EnvironmentPatch): void => {
    if (!this.writeLocked) library.updateEnvironment(this, patch)
  }
  setLoadStatus = (s: string): void => this.editor.setLoadStatus(s)
  setReady = (b: boolean): void => this.editor.setReady(b)
  setActiveCamera = (id: string): void => this.editor.setActiveCamera(id)
  select = (selection: Selection | null): void => {
    const pickingId = this.editor.lookAtPickingId
    if (pickingId) {
      if (selection?.kind === 'node') {
        const node = this.docModel.snapshot?.content.nodes.find((candidate) => candidate.id === selection.nodeId)
        if (isLookAtPickTarget(node, pickingId)) {
          this.editor.setLookAtPickingId(null)
          this.setCameraLookAtTarget(pickingId, selection.nodeId)
        }
      }
      return
    }
    const pathPickId = this.editor.pathApplyPickingId
    if (pathPickId) {
      if (selection?.kind === 'node') {
        const node = this.docModel.snapshot?.content.nodes.find((candidate) => candidate.id === selection.nodeId)
        if (isPathApplyPickTarget(node, pathPickId)) {
          const err = this.applyPathToTarget(pathPickId, selection.nodeId)
          if (!err) {
            this.editor.setPathApplyPickingId(null)
            this.syncGizmoState()
          }
        }
      }
      return
    }
    let next = selection
    if (next?.kind === 'node') {
      const nodes = this.docModel.snapshot?.content.nodes ?? []
      const ids = next.nodeIds?.length ? next.nodeIds : [next.nodeId]
      const allowed = ids.filter((id) => {
        const node = nodes.find((candidate) => candidate.id === id)
        return !isDerivedTransformPath(node)
      })
      if (allowed.length === 0) {
        this.editor.select(null)
        return
      }
      if (allowed.length !== ids.length) next = buildNodeSelection(allowed)
    }
    const current = next
    this.editor.select(current)
    if (this.editor.poseEditingId) {
      const ids = nodeIdsOf(current)
      if (ids.length !== 1 || ids[0] !== this.editor.poseEditingId) {
        this.editor.setPoseEditingId(null)
      }
    }
    if (this.editor.pathEditingId) {
      const ids = nodeIdsOf(current)
      if (ids.length !== 1 || ids[0] !== this.editor.pathEditingId) {
        this.editor.setPathEditingIdFlag(null)
      }
    }
    if (current?.kind === 'node') {
      const nodes = this.docModel.snapshot?.content.nodes ?? []
      const node = nodes.find((candidate) => candidate.id === current.nodeId)
      if (node?.type === 'camera') this.editor.setActiveCamera(node.id)
    } else if (current?.kind === 'clip' && current.clipType === 'camera') {
      const clip = this.docModel.snapshot?.content.timeline.animation.cameraMotionClips.find((candidate) => candidate.id === current.clipId)
      if (clip) this.editor.setActiveCamera(clip.target.nodeId)
    }
    this.syncGizmoState()
  }
  setPxPerFrame = (v: number): void => this.editor.setPxPerFrame(v)
  toggleUserKeys = (): void => this.editor.toggleUserKeys()
  toggleAutoKeyframe = (): void => this.editor.toggleAutoKeyframe()

  toggleTimelineSnap = (): void => this.editor.toggleTimelineSnap()
  toggleChainCameraMotion = (): void => this.editor.toggleChainCameraMotion()
  setExporting = (b: boolean): void => this.editor.setExporting(b)
  undo = (): void => {
    if (this.writeLocked) return
    // Transient camera edits must not continue overriding the restored target/pose.
    if (this.history.canUndo) this.cancelPendingKeyframe()
    this.history.undo()
    // undo/redo 走 applyContent 的 reaction 不刷路径可视化，和变更点一样手动同步。
    this.engine.syncPathNodes()
    this.film.handleDocumentChange()
  }
  redo = (): void => {
    if (this.writeLocked) return
    if (this.history.canRedo) this.cancelPendingKeyframe()
    this.history.redo()
    this.engine.syncPathNodes()
    this.film.handleDocumentChange()
  }

  setDoc = (doc: DirectorDocument, fcurves?: unknown): void => {
    const mine = !this.hydrating
    if (mine) this.hydrating = true
    try {
      const previous = this.docModel.fcurves
      this.docModel.replace(hydrateSkyColor(doc))
      if (fcurves !== undefined) {
        if (fcurves instanceof FCurveSet) {
          this.docModel.setFcurves(fcurves)
          this.engine.setFcurves(fcurves)
        } else {
          this.applyFcurvesRaw(fcurves)
        }
      } else if (previous) {
        this.docModel.setFcurves(previous)
        this.engine.setFcurves(previous)
      }
      this.history.clear()
    } finally {
      if (mine) this.hydrating = false
    }
  }

  /** 官方曲线 + 时间线 userKeys sidecar；parse 失败仍尝试灌覆写层。 */
  private applyFcurvesRaw(raw: unknown): FCurveSet | null {
    let parsed: FCurveSet | null = null
    try {
      parsed = raw ? FCurveSet.parse(raw) : null
    } catch (e) {
      console.warn('[fcurves] 加载失败，继续用派生路径', e)
    }
    this.docModel.setFcurves(parsed)
    this.engine.setFcurves(parsed)
    this.docModel.setUserKeys(FCurveSet.parseUserKeys(raw))
    return parsed
  }

  setFcurves = (f: FCurveSet | null): void => {
    this.docModel.setFcurves(f)
  }

  setFrame = (f: number): void => {
    if (this.editor.pendingKeyframes.length > 0) this.cancelPendingKeyframe()
    this.seekTo(f)
  }

  togglePlay = (): void => {
    if (this.editor.pendingKeyframes.length > 0) this.cancelPendingKeyframe()
    if (this.editor.workspaceMode === 'film') {
      this.film.togglePlay()
      return
    }
    this.editor.setPlaying(!this.editor.playing)
  }

  stepFrame = (delta: number): void => {
    if (this.editor.pendingKeyframes.length > 0) this.cancelPendingKeyframe()
    if (this.editor.workspaceMode === 'film') {
      this.film.stepFrame(delta)
      return
    }
    this.setFrame(Math.round(this.engine.currentFrame) + delta)
  }

  private seekTo(f: number): void {
    const tl = this.docModel.snapshot?.content.timeline
    const fs = tl?.frameStart ?? 0
    const fe = tl?.frameEnd ?? 0
    this.engine.seek(Math.min(Math.max(f, fs), fe))
  }

  setDraft = (id: string): void => {
    if (this.editor.exporting) return
    this.cameraAimReleasePending = false
    this.editor.setPlaying(false)
    this.engine.pause()
    this.engine.clearDrawPreview()
    this.engine.endFollow()
    this.engine.setOrbitEnabled(true)
    this.editor.resetForDraft(id)
    this.playback.reset()
    this.engine.endProgramPreview()
    this.docModel.replace(null)
    this.history.clear()
  }


  beginInteraction = (): void => {
    if (this.writeLocked) return
    this.interactionBefore = snapshotDocState(this.docModel)
    this.history.beginInteraction()
  }

  /**
   * 拖拽类交互收尾：期间的连续写入（userKeys / fcurves / doc content）全部压成
   * 一条三合一快照命令。调用前先做最终提交（commitNodeTransform / 相机 commit），
   * 此时 history 仍在 interaction 中，提交自身不会入栈。
   */
  endInteraction = (label: string): void => {
    const before = this.interactionBefore
    this.interactionBefore = null
    const after = snapshotDocState(this.docModel)
    const changed =
      before !== null && after !== null && JSON.stringify(before) !== JSON.stringify(after)
    this.history.endInteraction(
      changed && before && after
        ? new DocSnapshotCommand(label, this.docModel, before, after)
        : undefined,
    )
    if (this.cameraAimReleasePending) {
      this.cameraAimReleasePending = false
      this.editor.notifyCameraAimReleased()
    }
  }

  addKeyframe = (nodeId: string, prop: TrackProp, value: number[]): void => {
    this.addKeyframes(nodeId, [{ prop, value }])
  }

  addKeyframes = (nodeId: string, keys: { prop: TrackProp; value: number[] }[]): void => {
    if (this.writeLocked) return
    if (this.editor.pendingKeyframes.length > 0) {
      this.commitPendingKeyframe()
      return
    }
    this.writeAddedKeyframes(nodeId, keys)
  }

  /**
   * 多选打关键帧：每个节点按自身类型写变换通道（相机是 position/rotation/lookAt/fov，
   * 其余是 position/rotation/scale），整批压成一条 undo。锁定节点跳过。
   * 给了 props 就只写这些通道（时间轴单条子轨道的钻石），节点没有该通道时跳过。
   */
  addTransformKeyframes = (nodeIds: readonly string[], props?: readonly TrackProp[]): void => {
    if (this.writeLocked) return
    const nodes = this.docModel.snapshot?.content.nodes ?? []
    const targetIds = [...new Set(nodeIds)]
    const pending = this.editor.pendingKeyframes
    const entries: { nodeId: string; keys: { prop: TrackProp; value: number[] }[] }[] = []

    for (const id of targetIds) {
      const node = nodes.find((n) => n.id === id)
      if (!node || node.locked) continue
      const pendingItem = pending.find((p) => p.nodeId === id)
      let keys: { prop: TrackProp; value: number[] }[] = []
      if (pendingItem) {
        if (pendingItem.position) keys.push({ prop: 'position', value: pendingItem.position })
        if (pendingItem.rotation) keys.push({ prop: 'rotation', value: pendingItem.rotation })
        if (pendingItem.scale) keys.push({ prop: 'scale', value: pendingItem.scale })
        if (pendingItem.lookAt) keys.push({ prop: 'lookAt', value: pendingItem.lookAt })
        if (pendingItem.fov) keys.push({ prop: 'fov', value: pendingItem.fov })
      } else {
        keys = transformKeyframeWrites(node)
      }
      if (props) keys = keys.filter((k) => props.includes(k.prop))
      if (keys.length > 0) {
        entries.push({ nodeId: id, keys })
      }
    }

    for (const pendingItem of pending) {
      if (targetIds.includes(pendingItem.nodeId)) continue
      const keys: { prop: TrackProp; value: number[] }[] = []
      if (pendingItem.position) keys.push({ prop: 'position', value: pendingItem.position })
      if (pendingItem.rotation) keys.push({ prop: 'rotation', value: pendingItem.rotation })
      if (pendingItem.scale) keys.push({ prop: 'scale', value: pendingItem.scale })
      if (pendingItem.lookAt) keys.push({ prop: 'lookAt', value: pendingItem.lookAt })
      if (pendingItem.fov) keys.push({ prop: 'fov', value: pendingItem.fov })
      if (keys.length > 0) {
        entries.push({ nodeId: pendingItem.nodeId, keys })
      }
    }

    if (pending.length > 0) {
      this.editor.clearPendingKeyframes()
    }

    if (entries.length === 0) return
    this.writeKeyframeBatch(entries, {
      label: entries.length > 1 ? '批量添加关键帧' : '添加关键帧',
    })
  }

  private writeAddedKeyframes(
    nodeId: string,
    keys: { prop: TrackProp; value: number[] }[],
    opts?: { select?: boolean; mergeKey?: string; label?: string; useLiveSnapshot?: boolean },
  ): void {
    this.writeKeyframeBatch([{ nodeId, keys }], opts)
  }

  /** 一次 commit 写多个节点的关键帧：单节点时保持原有的选中行为，多节点时不改选中。 */
  private writeKeyframeBatch(
    entries: { nodeId: string; keys: { prop: TrackProp; value: number[] }[] }[],
    opts?: { select?: boolean; mergeKey?: string; label?: string; useLiveSnapshot?: boolean },
  ): void {
    if (this.writeLocked) return
    const targets = entries.filter(
      (e) => e.keys.length > 0 && !cameraMotionOwnsKeyframes(this.docModel.snapshot, e.nodeId),
    )
    if (targets.length === 0) return
    const next = cloneJson(this.docModel.userKeys)
    const frame = Math.round(this.engine.currentFrame)
    for (const { nodeId, keys } of targets) {
      const snap = opts?.useLiveSnapshot === false ? null : this.engine.getNodeSnapshot?.(nodeId) ?? null
      const liveOf = (prop: TrackProp, fallback: number[]): number[] => {
        if (!snap) return fallback
        if (prop === 'position' && snap.position.length >= 3) return [...snap.position]
        if (prop === 'rotation' && snap.rotation.length >= 3) return [...snap.rotation]
        if (prop === 'scale' && snap.scale.length >= 3) return [...snap.scale]
        if (prop === 'lookAt' && snap.lookAt && snap.lookAt.length >= 3) return [...snap.lookAt]
        if (prop === 'fov' && snap.fov != null) return [snap.fov]
        return fallback
      }
      for (const { prop, value } of keys) {
        const kf = makeKeyframe(frame, liveOf(prop, value))
        const track = [...(next[nodeId]?.[prop] ?? [])]
        const idx = track.findIndex((k) => k.frame === kf.frame)
        if (idx >= 0) track[idx] = { ...kf, id: track[idx].id, interpolation: track[idx].interpolation }
        else track.push(kf)
        track.sort((a, b) => a.frame - b.frame)
        next[nodeId] = { ...next[nodeId], [prop]: track }
      }
    }
    this.commitUserKeys(next, opts?.label ?? '添加关键帧', opts?.mergeKey)
    for (const { nodeId } of targets) this.engine.clearStagedTransforms?.(nodeId)
    if (opts?.select === false || targets.length > 1) return
    const { nodeId, keys } = targets[0]
    if (keys.length > 1) {
      this.editor.select({ kind: 'transformKeyframe', nodeId, frame })
      return
    }
    const added = keys.map(({ prop }) => {
      const id = next[nodeId]?.[prop]?.find((k) => k.frame === frame)?.id
      return id ? { nodeId, prop, keyId: id } : null
    }).filter((item): item is KeyframeRef => !!item)
    const selected = makeKeyframeSelection(added)
    if (selected) this.editor.select(selected)
  }

  private baselineTransformPatch(nodeId: string, patch: TransformEditPatch): Partial<TransformEditPatch> {
    const node = this.docModel.snapshot?.content.nodes.find((n) => n.id === nodeId)
    return documentTransformBaseline(
      node,
      this.docModel.userKeys,
      Math.round(this.engine.currentFrame),
      patch,
    )
  }

  private recordAutoKeyframeBatch(items: { nodeId: string; patch: TransformEditPatch }[]): boolean {
    if (this.editor.playing) this.editor.setPlaying(false)
    const entries: { nodeId: string; keys: { prop: TrackProp; value: number[] }[] }[] = []
    for (const item of items) {
      if (cameraMotionOwnsKeyframes(this.docModel.snapshot, item.nodeId)) continue
      const keys = changedKeyframeWrites(item.patch, this.baselineTransformPatch(item.nodeId, item.patch))
      if (keys.length > 0) {
        entries.push({ nodeId: item.nodeId, keys })
      }
    }
    if (entries.length === 0) return true
    const mergeKey = entries.length === 1 ? `auto-key:${entries[0].nodeId}` : 'auto-key:multi'
    this.writeKeyframeBatch(entries, {
      select: false,
      useLiveSnapshot: false,
      label: '自动关键帧',
      mergeKey,
    })
    return true
  }

  private recordAutoKeyframe(nodeId: string, patch: TransformEditPatch): boolean {
    return this.recordAutoKeyframeBatch([{ nodeId, patch }])
  }

  capturePendingTransform = (nodeId: string, patch: TransformEditPatch): boolean => {
    if (this.writeLocked) return false
    if (this.editor.autoKeyframe) return this.recordAutoKeyframe(nodeId, patch)
    if (!nodeHasUserXformKeys(this.docModel.userKeys, nodeId)) return false
    if (this.editor.playing) this.editor.setPlaying(false)
    this.editor.mergePendingKeyframe({
      nodeId,
      frame: Math.round(this.engine.currentFrame),
      ...pendingFieldsFromPatch(patch),
    })
    // pending 不进 evaluateFrame；必须同时写入 staged，否则其它节点
    // touch() 全场景求值会把该物体刷回旧关键帧。
    this.engine.setStagedTransform?.(nodeId, stagedTransformFromPatch(patch))
    return true
  }

  commitPendingKeyframe = (): void => {
    if (this.writeLocked) return
    const pending = this.editor.pendingKeyframes
    if (pending.length === 0) return
    const entries: { nodeId: string; keys: { prop: TrackProp; value: number[] }[] }[] = []
    for (const item of pending) {
      const keys: { prop: TrackProp; value: number[] }[] = []
      if (item.position) keys.push({ prop: 'position', value: item.position })
      if (item.rotation) keys.push({ prop: 'rotation', value: item.rotation })
      if (item.scale) keys.push({ prop: 'scale', value: item.scale })
      if (item.lookAt) keys.push({ prop: 'lookAt', value: item.lookAt })
      if (item.fov) keys.push({ prop: 'fov', value: item.fov })
      if (keys.length > 0) entries.push({ nodeId: item.nodeId, keys })
    }
    this.editor.clearPendingKeyframes()
    if (entries.length > 0) {
      this.writeKeyframeBatch(entries, {
        label: entries.length > 1 ? '批量添加关键帧' : '添加关键帧',
      })
    }
  }

  cancelPendingKeyframe = (): void => {
    if (this.editor.pendingKeyframes.length === 0) return
    const ids = [...new Set(this.editor.pendingKeyframes.map((item) => item.nodeId))]
    this.editor.clearPendingKeyframes()
    for (const id of ids) this.engine.clearStagedTransforms?.(id)
    this.engine.seek(this.engine.currentFrame)
  }

  moveKeyframe = (nodeId: string, prop: TrackProp, keyId: string, newFrame: number): void => {
    this.moveKeyframes([{ nodeId, prop, keyId, newFrame }])
  }

  moveKeyframes = (items: { nodeId: string; prop: TrackProp; keyId: string; newFrame: number }[]): void => {
    if (this.writeLocked) return
    if (items.length === 0) return
    items = items.filter((item) => !cameraMotionOwnsKeyframes(this.docModel.snapshot, item.nodeId))
    if (items.length === 0) return
    const next = cloneJson(this.docModel.userKeys)
    const tl = this.docModel.snapshot?.content.timeline
    const fs = tl?.frameStart ?? 0
    const fe = tl?.frameEnd ?? 0
    const resolved: { kf: { id: string; frame: number }; orig: number; token: string }[] = []
    for (const item of items) {
      const track = next[item.nodeId]?.[item.prop]
      const kf = track?.find((k) => k.id === item.keyId)
      if (!kf) continue
      resolved.push({
        kf,
        orig: kf.frame,
        token: `${item.nodeId}\0${item.prop}`,
      })
    }
    if (resolved.length === 0) return
    // 一批按同一时间增量刚体平移：碰到时间轴两端时整体卡住，相对间距不变。
    const minOrig = Math.min(...resolved.map((item) => item.orig))
    const maxOrig = Math.max(...resolved.map((item) => item.orig))
    const lead = items.find((item) => resolved.some((row) => row.kf.id === item.keyId))
    const leadOrig = resolved.find((row) => row.kf.id === lead?.keyId)?.orig ?? resolved[0].orig
    const delta = Math.min(
      Math.max(Math.round((lead?.newFrame ?? resolved[0].orig) - leadOrig), fs - minOrig),
      fe - maxOrig,
    )
    if (delta === 0) return
    const touched = new Set<string>()
    const movedIds = new Set<string>()
    for (const item of resolved) {
      item.kf.frame = item.orig + delta
      movedIds.add(item.kf.id)
      touched.add(item.token)
    }
    for (const token of touched) {
      const sep = token.indexOf('\0')
      const nodeId = token.slice(0, sep)
      const prop = token.slice(sep + 1) as TrackProp
      const track = next[nodeId]?.[prop] ?? []
      // 落到已占用的帧时必须是被拖的键胜出；track 仍按原帧号排序，
      // 单遍写入会让胜负取决于拖拽方向，所以先铺未移动的再用移动的覆盖。
      const byFrame = new Map<number, (typeof track)[number]>()
      for (const kf of track) if (!movedIds.has(kf.id)) byFrame.set(kf.frame, kf)
      for (const kf of track) if (movedIds.has(kf.id)) byFrame.set(kf.frame, kf)
      next[nodeId] = {
        ...next[nodeId],
        [prop]: [...byFrame.values()].sort((a, b) => a.frame - b.frame),
      }
    }
    const mergeKey = `keyframe-move:${[...movedIds].sort().join('+')}`
    this.commitUserKeys(next, '移动关键帧', mergeKey)
    this.pruneKeyframeSelection(next)
    const sel = this.editor.selection
    if (sel?.kind === 'transformKeyframe') {
      const isMoved = resolved.some(
        (r) => r.orig === sel.frame && items.some((it) => it.nodeId === sel.nodeId && it.keyId === r.kf.id),
      )
      if (isMoved) {
        this.editor.select({ kind: 'transformKeyframe', nodeId: sel.nodeId, frame: sel.frame + delta })
      }
    }
  }

  /** 合并掉的键 id 已不存在，留在 selection 里会让工具栏和删除操作点空。 */
  private pruneKeyframeSelection(userKeys: UserKeys): void {
    const sel = this.editor.selection
    if (sel?.kind !== 'keyframe') return
    const alive = new Set<string>()
    for (const tracks of Object.values(userKeys)) {
      if (!tracks) continue
      for (const track of Object.values(tracks)) {
        for (const kf of track ?? []) alive.add(kf.id)
      }
    }
    const refs = keyframeRefsOf(sel)
    const remain = refs.filter((ref) => alive.has(ref.keyId))
    if (remain.length === refs.length) return
    this.editor.select(makeKeyframeSelection(remain) ?? { kind: 'node', nodeId: sel.nodeId })
  }

  removeKeyframe = (nodeId: string, prop: TrackProp, keyId: string): void => {
    this.removeKeyframes([{ nodeId, prop, keyId }])
  }

  removeKeyframes = (refs: KeyframeRef[]): void => {
    if (this.writeLocked) return
    if (refs.length === 0) return
    refs = refs.filter((ref) => !cameraMotionOwnsKeyframes(this.docModel.snapshot, ref.nodeId))
    if (refs.length === 0) return
    const next = cloneJson(this.docModel.userKeys)
    const removed = new Set<string>()
    for (const ref of refs) {
      const track = next[ref.nodeId]?.[ref.prop]
      if (!track) continue
      next[ref.nodeId] = {
        ...next[ref.nodeId],
        [ref.prop]: track.filter((k) => k.id !== ref.keyId),
      }
      removed.add(ref.keyId)
    }
    if (removed.size === 0) return
    this.commitUserKeys(next, '删除关键帧')
    const sel = this.editor.selection
    if (sel?.kind !== 'keyframe') return
    const remain = keyframeRefsOf(sel).filter((item) => !removed.has(item.keyId))
    this.editor.select(makeKeyframeSelection(remain) ?? { kind: 'node', nodeId: sel.nodeId })
  }

  /**
   * 删除 fcurves（官方曲线层）某属性路径在指定帧的关键帧：所有分量同帧一起删。
   * 角色位移键删除后按剩余关键帧重建派生走位路径（与 commitNodeTransform 同规则）。
   */
  removeFcurveKeyframe = (nodeId: string, propPath: string, frame: number): void => {
    if (this.writeLocked) return
    const fc = this.docModel.fcurves
    if (!fc) return
    const before = snapshotDocState(this.docModel)
    if (!before) return
    if (fc.removeKeysAtFrame(nodeId, propPath, frame) === 0) return
    const live = this.docModel.toContract()
    if (live && propPath === 'transform.position') {
      rederiveWalkPaths(live, nodeId, fc, this.docModel.userKeys)
      this.engine.syncPathNodes()
    }
    this.docModel.setFcurves(fc)
    this.engine.setFcurves(fc)
    this.docModel.touch()
    this.pushDocSnapshot('删除关键帧', before)
  }

  /**
   * 删除「变换」组合关键帧：同一帧上变换子轨道的键
   * （人物位移/旋转/缩放，机位再加看点/FOV；userKeys 与 fcurves 两层）一起删。
   * 角色位移键被删时重建派生走位路径，对应的派生 path/clip 随之清理。
   */
  removeTransformKeysAtFrame = (nodeId: string, frame: number): void => {
    if (this.writeLocked) return
    if (cameraMotionOwnsKeyframes(this.docModel.snapshot, nodeId)) return
    const before = snapshotDocState(this.docModel)
    if (!before) return
    const prevUserKeys = this.docModel.userKeys
    let changed = false
    let positionRemoved = false
    // userKeys 层
    const uk = this.docModel.userKeys[nodeId]
    let userKeys = this.docModel.userKeys
    if (uk) {
      const rest = { ...uk }
      for (const prop of ['position', 'rotation', 'scale', 'lookAt', 'fov'] as const) {
        const track = rest[prop]
        if (!track) continue
        const next = track.filter((k) => k.frame !== frame)
        if (next.length === track.length) continue
        changed = true
        if (prop === 'position') positionRemoved = true
        if (next.length) rest[prop] = next
        else delete rest[prop]
      }
      if (changed) {
        userKeys = { ...userKeys }
        if (Object.keys(rest).length) userKeys[nodeId] = rest
        else delete userKeys[nodeId]
      }
    }
    // fcurves 层
    const fc = this.docModel.fcurves
    if (fc) {
      for (const [prop, path] of [
        ['position', 'transform.position'],
        ['rotation', 'transform.rotation'],
        ['scale', 'transform.scale'],
        ['lookAt', 'camera.lookAt'],
        ['fov', 'camera.fov'],
      ] as const) {
        const removed = fc.removeKeysAtFrame(nodeId, path, frame)
        if (removed > 0) {
          changed = true
          if (prop === 'position') positionRemoved = true
        }
      }
    }
    if (!changed) return
    const live = this.docModel.toContract()
    if (live && positionRemoved) {
      rederiveWalkPaths(live, nodeId, fc ?? FCurveSet.empty(), userKeys)
      this.engine.syncPathNodes()
    }
    // 删键落座：静态 transform 回到剩余最早键（或删空前最早键）的位置
    if (userKeys !== prevUserKeys) this.reseatBaseAfterKeyDelete(prevUserKeys, userKeys)
    if (userKeys !== this.docModel.userKeys) this.docModel.setUserKeys(userKeys)
    if (fc) {
      this.docModel.setFcurves(fc)
      this.engine.setFcurves(fc)
    }
    this.docModel.touch()
    this.pushDocSnapshot('删除变换关键帧', before)
    // 选中态清理：组合选中或子轨道选中键刚好被删时回退到节点
    const sel = this.editor.selection
    if (sel?.kind === 'transformKeyframe' && sel.nodeId === nodeId && sel.frame === frame) {
      this.editor.select({ kind: 'node', nodeId })
    } else if (
      sel?.kind === 'keyframe' &&
      sel.nodeId === nodeId &&
      !(this.docModel.userKeys[nodeId]?.[sel.prop] ?? []).some((k) => k.id === sel.keyId)
    ) {
      this.editor.select({ kind: 'node', nodeId })
    }
  }

  setKeyframeInterp = (nodeId: string, prop: TrackProp, keyId: string, interp: Interpolation): void => {
    this.setKeyframesInterp([{ nodeId, prop, keyId }], interp)
  }

  setKeyframesInterp = (refs: KeyframeRef[], interp: Interpolation): void => {
    if (this.writeLocked) return
    const next = cloneJson(this.docModel.userKeys)
    let changed = false
    for (const { nodeId, prop, keyId } of refs) {
      if (cameraMotionOwnsKeyframes(this.docModel.snapshot, nodeId)) continue
      const key = next[nodeId]?.[prop]?.find((k) => k.id === keyId)
      if (!key || key.interpolation === interp) continue
      key.interpolation = interp
      changed = true
    }
    if (changed) this.commitUserKeys(next, '关键帧插值')
  }

  setTransformKeysInterpAtFrame = (nodeId: string, frame: number, interp: Interpolation): void => {
    if (this.writeLocked) return
    if (cameraMotionOwnsKeyframes(this.docModel.snapshot, nodeId)) return
    const uk = this.docModel.userKeys[nodeId]
    if (!uk) return
    let changed = false
    const rest = { ...uk }
    for (const prop of ['position', 'rotation', 'scale', 'lookAt', 'fov'] as const) {
      const track = rest[prop]
      if (!track) continue
      const next = track.map((k) => (k.frame === frame ? { ...k, interpolation: interp } : k))
      if (next.some((k, idx) => k !== track[idx])) {
        changed = true
        rest[prop] = next
      }
    }
    if (!changed) return
    const nextUserKeys = { ...this.docModel.userKeys, [nodeId]: rest }
    this.commitUserKeys(nextUserKeys, '关键帧插值')
  }

  setKeyframeValue = (nodeId: string, prop: TrackProp, keyId: string, value: number[]): void => {
    if (this.writeLocked) return
    const next = cloneJson(this.docModel.userKeys)
    next[nodeId] = {
      ...next[nodeId],
      [prop]: (next[nodeId]?.[prop] ?? []).map((k) =>
        k.id === keyId ? { ...k, value: [...value] } : k,
      ),
    }
    this.commitUserKeys(next, '编辑关键帧')
  }

  upsertKeyframeAtFrame = (nodeId: string, prop: TrackProp, value: number[]): void => {
    if (this.writeLocked) return
    if (this.isCameraNode(nodeId) && value.length >= 3) {
      if (prop === 'position') {
        library.writeCameraWorldPos(this, nodeId, { x: value[0], y: value[1], z: value[2] }, false)
        return
      }
      if (prop === 'rotation') {
        library.writeCameraRotation(this, nodeId, { x: value[0], y: value[1], z: value[2] }, false)
        return
      }
    }
    const next = cloneJson(this.docModel.userKeys)
    const frame = Math.round(this.engine.currentFrame)
    const track = [...(next[nodeId]?.[prop] ?? [])]
    const hit = track.find((k) => Math.abs(k.frame - frame) <= 0.5)
    if (hit) hit.value = [...value]
    else {
      track.push(makeKeyframe(frame, value))
      track.sort((a, b) => a.frame - b.frame)
    }
    next[nodeId] = { ...next[nodeId], [prop]: track }
    this.commitUserKeys(next, '写入关键帧')
  }

  applyCameraPreset = (presetId: string): string | null => this.writeLocked
    ? 'write-locked'
    : library.applyCameraPreset(this, presetId)
  setCameraSubjectDistance = (distance: number, cameraId?: string): string | null =>
    this.writeLocked ? 'write-locked' : library.setCameraSubjectDistance(this, distance, cameraId)
  clearCameraSubject = (cameraId?: string): string | null => this.writeLocked
    ? 'write-locked'
    : library.clearCameraSubject(this, cameraId)
  setCameraFollow = (follow: boolean, cameraId?: string, subjectId?: string): string | null =>
    this.writeLocked ? 'write-locked' : library.setCameraFollow(this, follow, cameraId, subjectId)
  setCameraLookAtTarget = (cameraId: string, nodeId: string | null): string | null =>
    this.writeLocked ? 'write-locked' : library.setCameraLookAtTarget(this, cameraId, nodeId)
  placeNodeOnGround = (nodeId: string): string | null => this.writeLocked
    ? 'write-locked'
    : library.placeNodeOnGround(this, nodeId)
  placeNodeOnSupport = (nodeId: string, supportId: string): string | null =>
    this.writeLocked ? 'write-locked' : library.placeNodeOnSupport(this, nodeId, supportId)
  writeNodeTransform = (
    nodeId: string,
    patch: { position?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number }; scale?: { x: number; y: number; z: number } },
  ): string | null => this.writeLocked ? 'write-locked' : library.writeNodeTransform(this, nodeId, patch)
  setCharacterAppearance = (
    nodeId: string,
    patch: { color?: string; showLabel?: boolean },
  ): string | null => this.writeLocked ? 'write-locked' : library.setCharacterAppearance(this, nodeId, patch)
  setObjectAppearance = (
    nodeId: string,
    patch: { color?: string; showLabel?: boolean },
  ): string | null => this.writeLocked ? 'write-locked' : library.setObjectAppearance(this, nodeId, patch)
  applyFollowingCameraWorldPos = (
    cameraId: string,
    worldPos: { x: number; y: number; z: number },
    commit: boolean,
  ): string | null => this.writeLocked ? 'write-locked' : library.writeCameraWorldPos(this, cameraId, worldPos, commit)
  writeCameraWorldPos = (
    cameraId: string,
    worldPos: { x: number; y: number; z: number },
    commit: boolean,
  ): string | null => this.writeLocked ? 'write-locked' : library.writeCameraWorldPos(this, cameraId, worldPos, commit)
  writeCameraLookAt = (
    cameraId: string,
    lookAt: { x: number; y: number; z: number },
    commit: boolean,
  ): string | null => this.writeLocked ? 'write-locked' : library.writeCameraLookAt(this, cameraId, lookAt, commit)
  writeCameraRotation = (
    cameraId: string,
    rotDeg: { x: number; y: number; z: number },
    commit: boolean,
  ): string | null => {
    if (this.writeLocked) return 'write-locked'
    // Include target detachment and any automatic keyframes in the same undo operation.
    const ownInteraction = commit && !this.history.interactionActive
    if (ownInteraction) this.beginInteraction()
    try {
      return library.writeCameraRotation(this, cameraId, rotDeg, commit)
    } finally {
      if (ownInteraction) this.endInteraction('旋转相机')
    }
  }
  get cameraAimReleaseVersion(): number {
    return this.editor.cameraAimReleaseVersion
  }
  get cameraMotionDragNoticeVersion(): number {
    return this.editor.cameraMotionDragNoticeVersion
  }
  notifyCameraMotionDragBlocked = (): void => {
    this.editor.notifyCameraMotionDragBlocked()
  }
  setCameraFov = (fov: number, cameraId?: string): string | null => this.writeLocked
    ? 'write-locked'
    : library.setCameraFov(this, fov, cameraId)
  renameNode = (nodeId: string, name: string): string | null => this.writeLocked
    ? 'write-locked'
    : library.renameNode(this, nodeId, name)
  applyCameraMotion = (presetId: string): string | null => this.writeLocked
    ? 'write-locked'
    : library.applyCameraMotion(this, presetId)
  updateCameraMotionConfig = (clipId: string, patch: Record<string, number | string>): string | null =>
    this.writeLocked ? 'write-locked' : library.updateCameraMotionConfig(this, clipId, patch)
  resizeCameraMotionClip = (
    clipId: string,
    edge: 'start' | 'end',
    frame: number,
  ): string | null => this.writeLocked
    ? 'write-locked'
    : library.resizeCameraMotionClip(this, clipId, edge, frame)

  resizePathMotionClip = (
    clipId: string,
    edge: 'start' | 'end',
    frame: number,
  ): string | null => {
    if (this.writeLocked) return 'write-locked'
    const live = this.docModel.toContract()
    if (!live) return 'no-doc'
    const tl = live.content.timeline
    const old = tl.animation.pathMotionClips.find((c) => c.id === clipId)
    if (!old) return 'clip-not-found'
    const ordered = timelinePathClips(tl.animation.pathMotionClips, old.target.nodeId)
      .sort((a, b) => a.frameStart - b.frameStart)
    const oldIndex = ordered.findIndex((c) => c.id === clipId)
    const previousEnd = oldIndex > 0 ? ordered[oldIndex - 1].frameEnd : tl.frameStart
    const hasNext = oldIndex >= 0 && oldIndex < ordered.length - 1
    const nextStart = hasNext ? ordered[oldIndex + 1].frameStart : tl.frameEnd
    const target = Math.round(frame)
    const frameStart = edge === 'start'
      ? Math.min(Math.max(target, previousEnd), old.frameEnd - 1)
      : old.frameStart
    const frameEnd = edge === 'end'
      ? Math.max(Math.min(target, nextStart), old.frameStart + 1)
      : old.frameEnd
    if (frameStart === old.frameStart && frameEnd === old.frameEnd) return null
    const before = snapshotDocState(this.docModel)
    if (!before) return 'no-doc'
    tl.animation.pathMotionClips = tl.animation.pathMotionClips.map((c) =>
      c.id === clipId ? withPathClipRange(c, frameStart, frameEnd) : c,
    )
    this.docModel.touch()
    this.pushDocSnapshot('调整路径走位范围', before, `path-clip-range:${clipId}`)
    return null
  }

  updateMotionClipConfig = (clipId: string, patch: Record<string, number | string | boolean>): void => {
    if (this.writeLocked) return
    const live = this.docModel.toContract()
    if (!live) return
    const idx = live.content.timeline.animation.motionClips.findIndex((c) => c.id === clipId)
    if (idx < 0) return
    const before = snapshotDocState(this.docModel)
    if (!before) return
    const old = live.content.timeline.animation.motionClips[idx]
    const sameTarget = live.content.timeline.animation.motionClips
      .filter((c) => c.id !== clipId && c.target.nodeId === old.target.nodeId)
      .sort((a, b) => a.frameStart - b.frameStart)
    const previousCandidates = sameTarget.filter((c) => c.frameEnd <= old.frameStart)
    const previous = previousCandidates[previousCandidates.length - 1]
    const next = sameTarget.find((c) => c.frameStart >= old.frameEnd)
    const previousEnd = previous?.frameEnd ?? live.content.timeline.frameStart
    const nextStart = next?.frameStart ?? live.content.timeline.frameEnd
    let frameStart = typeof patch.frameStart === 'number'
      ? Math.round(Math.max(live.content.timeline.frameStart, Math.min(patch.frameStart, old.frameEnd - 1)))
      : old.frameStart
    let frameEnd = typeof patch.frameEnd === 'number'
      ? Math.round(Math.min(live.content.timeline.frameEnd, Math.max(patch.frameEnd, frameStart + 1)))
      : old.frameEnd
    frameStart = Math.max(frameStart, previousEnd)
    frameEnd = Math.min(frameEnd, nextStart)
    if (frameEnd <= frameStart) {
      frameStart = old.frameStart
      frameEnd = old.frameEnd
    }
    const playback = {
      ...old.playback,
      ...(typeof patch.speed === 'number' ? { speed: Math.max(0.01, patch.speed) } : {}),
      ...(typeof patch.loop === 'boolean' ? { loop: patch.loop } : {}),
      ...(typeof patch.loopMode === 'string' ? { loopMode: patch.loopMode } : {}),
    }
    const motion = {
      ...old.motion,
      ...(typeof patch.sourceStart === 'number' ? { time: Math.max(0, Math.min(patch.sourceStart, old.sourceDuration)) } : {}),
      ...(typeof patch.inPlace === 'boolean' ? { inPlace: patch.inPlace } : {}),
    }
    live.content.timeline.animation.motionClips[idx] = { ...old, frameStart, frameEnd, playback, motion }
    if (JSON.stringify(before.doc.content) === JSON.stringify(live.content)) return
    this.docModel.touch()
    this.pushDocSnapshot('编辑动作设置', before, `clip-config:${clipId}`)
  }
  addCameraFromPreset = (presetId: string, name?: string): string | null => this.writeLocked
    ? 'write-locked'
    : library.addCameraFromPreset(this, presetId, name)
  addCharacter = (entry: CharacterLibEntry): Promise<string | null> => this.writeLocked
    ? Promise.resolve('write-locked')
    : this.trackUserWrite(library.addCharacter(this, entry))
  addMotionClipFromLibrary = (fbxKey: string, name: string): Promise<string | null> => this.writeLocked
    ? Promise.resolve('write-locked')
    : this.trackUserWrite(library.addMotionClipFromLibrary(this, fbxKey, name))
  addPropFromLibrary = (name: string, fileKey: string): Promise<string | null> => this.writeLocked
    ? Promise.resolve('write-locked')
    : this.trackUserWrite(library.addPropFromLibrary(this, name, fileKey))
  addPrimitive = (
    name: string,
    kind: string,
    parameters: Record<string, number | string | boolean>,
    transform?: Partial<{
      position: { x: number; y: number; z: number }
      rotation: { x: number; y: number; z: number }
    }>,
  ): string | null => this.writeLocked
    ? 'write-locked'
    : library.addPrimitive(this, name, kind, parameters, transform)
  setPoseValue = (nodeId: string, key: string, value: number): void => {
    if (!this.writeLocked) library.setPoseValue(this, nodeId, key, value)
  }
  setPoseJoints = (nodeId: string, joints: Record<string, { x: number; y: number; z: number }>): void => {
    if (!this.writeLocked) library.setPoseJoints(this, nodeId, joints)
  }
  beginPoseEdit = (): void => {
    if (this.writeLocked) return
    this.poseEditBefore = snapshotDocState(this.docModel)
    this.history.beginInteraction()
  }
  endPoseEdit = (commit: boolean): void => {
    const before = this.poseEditBefore
    this.poseEditBefore = null
    this.history.endInteraction()
    if (commit && before) this.pushDocSnapshot('姿势', before)
    else if (!commit && before) restoreDocState(this.docModel, before)
  }
  resetPose = (nodeId: string): void => {
    if (this.writeLocked) return
    void this.trackUserWrite(this.ensurePoseThenReset(nodeId))
  }
  applyPosePreset = (nodeId: string, presetId: string): string | null => {
    if (this.writeLocked) return 'write-locked'
    void this.trackUserWrite(this.ensurePoseThenApply(nodeId, presetId))
    return null
  }

  private poseApplySeq = 0

  private async ensurePoseThenApply(nodeId: string, presetId: string): Promise<void> {
    const seq = ++this.poseApplySeq
    await ensurePoseBones(this.adapter, [presetId], this.engine.poseBank)
    if (seq !== this.poseApplySeq) return
    library.applyPosePreset(this, nodeId, presetId)
    this.seekTo(this.engine.currentFrame)
    this.engine.invalidate()
  }

  private async ensurePoseThenReset(nodeId: string): Promise<void> {
    const seq = ++this.poseApplySeq
    const fallback = this.engine.poseBank.defaultId() ?? 't-pose'
    await ensurePoseBones(this.adapter, [fallback], this.engine.poseBank)
    if (seq !== this.poseApplySeq) return
    library.resetPose(this, nodeId)
    this.seekTo(this.engine.currentFrame)
    this.engine.invalidate()
  }

  private trackUserWrite<T>(write: Promise<T>): Promise<T> {
    this.pendingUserWrites.add(write)
    void write.then(
      () => this.pendingUserWrites.delete(write),
      () => this.pendingUserWrites.delete(write),
    )
    return write
  }

  async flushPendingUserWrites(): Promise<void> {
    while (this.pendingUserWrites.size > 0) {
      await Promise.allSettled([...this.pendingUserWrites])
    }
  }

  get canSave(): boolean {
    return typeof this.adapter.saveDocumentState === 'function'
      || typeof this.adapter.saveDocument === 'function'
  }

  get dirty(): boolean {
    return this.docModel.revision !== this.lastSavedRevision
  }

  get saveState(): SaveState {
    return this.editor.saveState
  }

  get saveError(): string | null {
    return this.editor.saveError
  }

  get saveErrorDetail(): string | null {
    return this.editor.saveErrorDetail
  }

  exportDraft = (): boolean => {
    const doc = this.docModel.snapshot
    if (!doc) return false
    const base = this.editor.draftId || 'draft'
    downloadJson(doc, `${base}-edited.json`)
    downloadJson(FCurveSet.persist(this.docModel.fcurves, this.userKeys), `${base}-fcurves.json`)
    return true
  }

  save = (opts?: SaveOptions): Promise<string | null> => {
    if (this.writeLocked) return Promise.resolve(null)
    this.pendingSaveCaptureCover ||= opts?.captureCover !== false
    if (this.saveInFlight) return this.saveInFlight
    const pending = this.drainSaveQueue()
    this.saveInFlight = pending
    void pending.finally(() => {
      if (this.saveInFlight === pending) this.saveInFlight = null
    })
    return pending
  }

  private async drainSaveQueue(): Promise<string | null> {
    for (;;) {
      const err = await this.runSaveAttempt()
      if (err) return err
      if (this.docModel.revision !== this.lastSavedRevision) continue

      const captureCover = this.pendingSaveCaptureCover
      this.pendingSaveCaptureCover = false
      if (captureCover) await this.captureThumbnailSafe()
      // 截封面期间也可能继续编辑；关闭流程必须等这些修改真正落盘。
      if (this.docModel.revision !== this.lastSavedRevision) continue
      this.editor.setSaveState('saved')
      return null
    }
  }

  private async runSaveAttempt(): Promise<string | null> {
    const source = this.docModel.snapshot
    // 早退也必须落错误态：只返回 key 而不写 saveState，UI 会停在「已保存」但实际没写出。
    if (!source) {
      this.editor.setSaveState('error', 'save.errorNoDocument')
      return 'save.errorNoDocument'
    }
    if (!this.canSave) {
      this.editor.setSaveState('error', 'save.errorHostReadOnly')
      return 'save.errorHostReadOnly'
    }
    if (!this.dirty && this.editor.saveState !== 'error') {
      return null
    }
    // 文档与曲线必须来自同一 revision；不要在第一次网络 await 后再读取实时状态。
    const revision = this.docModel.revision
    const doc = cloneJson(source)
    const fcurves = FCurveSet.persist(this.docModel.fcurves, this.userKeys)
    this.editor.setSaveState('saving')
    try {
      if (this.adapter.saveDocumentState) {
        await this.adapter.saveDocumentState(this.editor.draftId, doc, fcurves)
      } else {
        await this.adapter.saveDocument!(this.editor.draftId, doc)
        await this.adapter.saveFCurves?.(this.editor.draftId, fcurves)
      }
      this.markSavedRevision(revision)
      return null
    } catch (e) {
      // saveError 只放 i18n key，原始异常文本走 detail：消费端统一 t()，塞 raw 文本会翻译不到。
      const message = e instanceof Error ? e.message : String(e)
      this.editor.setSaveState('error', 'save.failed', message)
      return message
    }
  }

  private async captureThumbnailSafe(): Promise<void> {
    if (!this.adapter.saveThumbnail) return
    const run = (async () => {
      try {
        await this.captureThumbnail()
      } catch (e) {
        console.warn('[save] thumbnail failed', e)
      }
    })()
    this.engineCover = run
    try {
      await run
    } finally {
      if (this.engineCover === run) this.engineCover = null
    }
  }

  private coverFrameInput(): CaptureFrameInput | null {
    const doc = this.docModel.snapshot
    if (!doc) return null
    const cameraId = this.editor.activeCameraId || doc.content.activeShotCameraNodeId
    if (!cameraId) return null
    const height = 216
    return {
      cameraId,
      label: 'cover',
      width: widthFromAspectHeight(height, this.engine.resolvedAspect()),
      height,
      frame: this.engine.currentFrame,
      userKeys: this.userKeys,
      userKeysEnabled: this.editor.userKeysEnabled,
      chainCameraMotion: this.editor.chainCameraMotion,
    }
  }

  private async captureThumbnail(): Promise<void> {
    if (!this.adapter.saveThumbnail) return
    const input = this.coverFrameInput()
    if (!input) return
    await this.engine.captureFrame({
      ...input,
      onExport: async (blob) => {
        await this.adapter.saveThumbnail?.(this.editor.draftId, blob)
      },
    })
  }

  /**
   * 关闭用的保存。没有未落盘的修改时 `done` 为 null，调用方不用等。
   * 有修改时，返回前封面已渲染完（引擎可以销毁）；文档保存和封面上传在 `done` 里继续。
   */
  beginCloseSave = async (): Promise<{ done: Promise<string | null> | null }> => {
    // 写锁期间保存会被跳过。这时不截封面，避免封面和没保存的内容对不上。
    if (this.writeLocked) return { done: null }
    const mustPersist = this.dirty || this.saveInFlight !== null || this.editor.saveState === 'error'
    if (!mustPersist) return { done: null }

    // 关闭后引擎会被销毁：还没开始的截图不再截，已经在截的等它结束再返回。
    this.pendingSaveCaptureCover = false
    if (this.engineCover) await this.engineCover
    const cover = await this.renderCoverSafe()
    const saved = this.save({ captureCover: false })
    const draftId = this.editor.draftId
    const done = saved.then(async (err) => {
      // 文档没写进去时不上传封面，否则节点封面会和实际保存的内容对不上。
      if (err || !cover) return err
      try {
        await this.adapter.saveThumbnail?.(draftId, cover)
      } catch (e) {
        console.warn('[save] thumbnail failed', e)
      }
      return null
    })
    return { done }
  }

  private async renderCoverSafe(): Promise<Blob | null> {
    if (!this.adapter.saveThumbnail) return null
    const input = this.coverFrameInput()
    if (!input) return null
    try {
      return await this.engine.previewFrame(input)
    } catch (e) {
      console.warn('[save] thumbnail failed', e)
      return null
    }
  }

  async reloadFromHost(_entityIds?: string[]): Promise<void> {
    if (this.hydrating) {
      this.pendingHostReload = true
      return
    }
    const seq = ++this.loadSeq
    const keptSelection = this.editor.selection
    const keptFrame = this.engine.currentFrame
    const keptCamera = this.editor.activeCameraId
    this.hydrating = true
    try {
      const nextDoc = await this.adapter.loadDocument(this.editor.draftId)
      await ensurePoseBones(this.adapter, collectUsedPoseIds(nextDoc), this.engine.poseBank)
      if (seq !== this.loadSeq) return
      let raw: unknown = null
      try {
        raw = (await this.adapter.loadFCurves?.(this.editor.draftId)) ?? null
      } catch (e) {
        console.warn('[fcurves] 加载失败，继续用派生路径', e)
      }
      if (seq !== this.loadSeq) return
      // loadDocument 不会清图，必须先 reset 再 setDoc/load，避免节点 reaction 往旧图加角色。
      this.engine.reset()
      this.setDoc(nextDoc, raw)
      await this.engine.load(nextDoc)
      if (seq !== this.loadSeq) return
      this.applyFcurvesRaw(raw)
      const nodeIds = new Set(nextDoc.content.nodes.map((node) => node.id))
      const cameraStillThere = keptCamera && nodeIds.has(keptCamera)
      this.editor.setActiveCamera(
        cameraStillThere
          ? keptCamera
          : (nextDoc.content.activeShotCameraNodeId || nodesOfType(nextDoc, 'camera')[0]?.id || ''),
      )
      this.engine.setEvalContext({
        userKeys: this.docModel.userKeys,
        userKeysEnabled: this.editor.userKeysEnabled,
        chainCameraMotion: this.editor.chainCameraMotion,
        activeCameraId: this.editor.activeCameraId,
      })
      if (keptSelection?.kind === 'node' && !nodeIds.has(keptSelection.nodeId)) {
        this.editor.select(null)
      } else {
        this.editor.select(keptSelection)
      }
      this.seekTo(keptFrame)
      this.markSavedRevision(this.docModel.revision)
      this.editor.setReady(true)
    } finally {
      if (seq === this.loadSeq) {
        this.hydrating = false
        this.flushPendingHostReload()
      }
    }
  }

  async loadDraft(draftId: string): Promise<void> {
    const seq = ++this.loadSeq
    this.hydrating = true
    try {
      this.editor.setLoadStatus('加载草稿…')
      this.engine.reset()
      const nextDoc = await this.adapter.loadDocument(draftId)
      await ensurePoseBones(this.adapter, collectUsedPoseIds(nextDoc), this.engine.poseBank)
      if (seq !== this.loadSeq) return
      this.setDoc(nextDoc, null)
      const cams = nodesOfType(nextDoc, 'camera')
      this.editor.setActiveCamera(nextDoc.content.activeShotCameraNodeId || cams[0]?.id || '')
      const fcurvesPromise = (async (): Promise<unknown> => {
            try {
              return (await this.adapter.loadFCurves?.(draftId)) ?? null
            } catch (e) {
              console.warn('[fcurves] 加载失败，继续用派生路径', e)
              return null
            }
          })()
      await this.engine.load(nextDoc, (msg) => {
        if (seq === this.loadSeq) this.editor.setLoadStatus(msg)
      })
      if (seq !== this.loadSeq) return
      const raw = await fcurvesPromise
      if (seq !== this.loadSeq) return
      this.applyFcurvesRaw(raw)
      this.engine.setEvalContext({
        userKeys: this.docModel.userKeys,
        userKeysEnabled: this.editor.userKeysEnabled,
        chainCameraMotion: this.editor.chainCameraMotion,
        activeCameraId: this.editor.activeCameraId,
      })
      this.seekTo(nextDoc.content.timeline.frameStart)
      this.markSavedRevision(this.docModel.revision)
      this.editor.setSaveState('idle')
      this.editor.setReady(true)
      this.editor.setLoadStatus('就绪')
    } finally {
      if (seq === this.loadSeq) {
        this.hydrating = false
        this.flushPendingHostReload()
      }
    }
  }

  private flushPendingHostReload(): void {
    if (!this.pendingHostReload) return
    this.pendingHostReload = false
    void this.reloadFromHost()
  }

  private markSavedRevision(revision: number): void {
    runInAction(() => {
      this.lastSavedRevision = revision
    })
  }

  private commitUserKeys(next: UserKeys, label: string, mergeKey?: string): void {
    if (this.writeLocked) return
    if (this.history.interactionActive) {
      // interaction 内不入栈；endInteraction 用三合一 before/after 压成一条命令，
      // 派生路径的 content 变更一并被快照覆盖。
      const prev = this.docModel.userKeys
      this.docModel.setUserKeys(next)
      this.rederiveForUserKeysDiff(prev, next)
      this.reseatBaseAfterKeyDelete(prev, next)
      return
    }
    const before = snapshotDocState(this.docModel)
    if (!before) return
    const prev = this.docModel.userKeys
    this.docModel.setUserKeys(next)
    this.rederiveForUserKeysDiff(prev, next)
    this.reseatBaseAfterKeyDelete(prev, next)
    this.docModel.touch()
    this.pushDocSnapshot(label, before, mergeKey)
  }

  /**
   * userKeys 的 position 轨道发生变化的节点 → 按有效键（userKeys 优先，
   * 否则官方 fcurves）重建派生走位路径；undo/redo 由外层三合一快照覆盖。
   */
  private rederiveForUserKeysDiff(prev: UserKeys, next: UserKeys): void {
    const live = this.docModel.toContract()
    if (!live) return
    const ids = new Set([...Object.keys(prev), ...Object.keys(next)])
    let any = false
    for (const id of ids) {
      const a = prev[id]?.position ?? null
      const b = next[id]?.position ?? null
      if (JSON.stringify(a) === JSON.stringify(b)) continue
      rederiveWalkPaths(live, id, this.docModel.fcurves ?? FCurveSet.empty(), next)
      any = true
    }
    if (any) {
      this.engine.syncPathNodes()
      this.docModel.touch()
    }
  }

  /**
   * 删键落座：某条 userKeys 轨道变短（有键被删）时，把节点静态 transform
   * 对应属性落座到「剩余键的最早帧值」；键删光时回到「被删前最早键的值」
   * ——即删除关键帧后节点回到关键帧开始位置，而不是停留在被删的结束位置。
   * 相机 / path 节点不适用（相机有自己的覆写层语义）。
   */
  private reseatBaseAfterKeyDelete(prev: UserKeys, next: UserKeys): void {
    const live = this.docModel.toContract()
    if (!live) return
    const ids = new Set([...Object.keys(prev), ...Object.keys(next)])
    let any = false
    for (const id of ids) {
      const node = live.content.nodes.find((n) => n.id === id)
      if (!node || node.type === 'camera' || node.type === 'path') continue
      for (const prop of ['position', 'rotation', 'scale'] as const) {
        const a = prev[id]?.[prop]
        const b = next[id]?.[prop]
        if (!a || (b?.length ?? 0) >= a.length) continue
        const src = b?.length ? b : a
        const first = [...src].sort((x, y) => x.frame - y.frame)[0]
        node.transform[prop] = {
          x: first.value[0] ?? 0,
          y: first.value[1] ?? 0,
          z: first.value[2] ?? (prop === 'scale' ? 1 : 0),
        }
        any = true
      }
    }
    if (any) this.docModel.touch()
  }

  /**
   * 已应用的文档变更入历史：before 由调用方在变更前用 snapshotDocState 抓取
   * （content + userKeys + fcurves 三合一），after 在这里取当前状态。
   */
  pushDocSnapshot(label: string, before: DocSnapshotState, mergeKey?: string): void {
    const after = snapshotDocState(this.docModel)
    if (!after) return
    this.history.pushApplied(new DocSnapshotCommand(label, this.docModel, before, after, mergeKey))
  }

  commitAddedNode(node: DraftNode, label: string): string | null {
    return this.commitAddedNodes([node], label)
  }

  commitAddedNodes(nodes: DraftNode[], label: string): string | null {
    if (this.writeLocked) return 'write-locked'
    const live = this.docModel.toContract()
    if (!live || nodes.length === 0) return 'no-doc'
    const before = snapshotDocState(this.docModel)
    if (!before) return 'no-doc'
    live.content.nodes.push(...nodes)
    this.docModel.touch()
    this.pushDocSnapshot(label, before)
    const last = nodes[nodes.length - 1]
    this.editor.select({
      kind: 'node',
      nodeId: last.id,
      nodeIds: nodes.map((node) => node.id),
    })
    if (last.type === 'camera') this.editor.setActiveCamera(last.id)
    return null
  }

  beginTimelineRangeEdit = (): void => {
    if (this.writeLocked) return
    const live = this.docModel.toContract()
    if (!live || this.timelineRangeBefore) return
    this.timelineRangeBefore = cloneJson(live)
    this.history.beginInteraction()
  }

  endTimelineRangeEdit = (): void => {
    const before = this.timelineRangeBefore
    this.timelineRangeBefore = null
    const live = this.docModel.toContract()
    const rangeChanged = !!before && !!live && (
      before.content.timeline.frameStart !== live.content.timeline.frameStart
      || before.content.timeline.frameEnd !== live.content.timeline.frameEnd
    )
    const fpsChanged = !!before && !!live && before.content.timeline.fps !== live.content.timeline.fps
    const title = fpsChanged ? '更改帧率' : '更改时间范围'
    this.history.endInteraction(
      (rangeChanged || fpsChanged) && live
        ? new SnapshotCommand(
            title,
            () => this.docModel.applyContent(cloneJson(live)),
            () => this.docModel.applyContent(before),
          )
        : undefined,
    )
  }

  setTimelineRange = (frameStart: number, frameEnd: number): void => {
    if (this.writeLocked) return
    const live = this.docModel.toContract()
    if (!live) return
    const tl = live.content.timeline
    if (!Number.isFinite(frameStart) || !Number.isFinite(frameEnd)) return
    let start = Math.round(frameStart)
    let end = Math.round(frameEnd)
    const occupied = occupiedTimelineBounds(live, this.docModel.userKeys)
    if (occupied) {
      start = Math.min(start, occupied.min)
    }
    // The playback end is user-owned; shortening it must not trim clip/key data.
    start = Math.max(0, start)
    end = Math.max(end, start + 1)
    if (start === tl.frameStart && end === tl.frameEnd) return
    const interacting = this.history.interactionActive
    const before = interacting ? null : snapshotDocState(this.docModel)
    tl.frameStart = start
    tl.frameEnd = end
    this.docModel.touch()
    if (before) this.pushDocSnapshot('更改时间范围', before)
    this.seekTo(this.engine.currentFrame)
    this.engine.invalidate()
  }

  setTimelineFps = (fps: number): void => {
    if (this.writeLocked) return
    const live = this.docModel.toContract()
    if (!live) return
    if (!Number.isFinite(fps)) return
    const next = Math.min(30, Math.max(20, Math.round(fps)))
    const tl = live.content.timeline
    if (next === tl.fps) return
    const interacting = this.history.interactionActive
    const before = interacting ? null : snapshotDocState(this.docModel)
    const origin = this.timelineRangeBefore ?? live
    const fromFps = origin.content.timeline.fps
    const playhead = this.engine.currentFrame
    const oldFps = tl.fps
    tl.fps = next
    tl.frameStart = Math.max(0, remapFrame(origin.content.timeline.frameStart, fromFps, next))
    tl.frameEnd = Math.max(tl.frameStart + 1, remapFrame(origin.content.timeline.frameEnd, fromFps, next))
    this.docModel.touch()
    if (before) this.pushDocSnapshot('更改帧率', before)
    this.seekTo(remapFrame(playhead, oldFps, next))
    this.engine.invalidate()
  }

  setAspectRatio = (value: string): void => {
    if (this.writeLocked) return
    const live = this.docModel.toContract()
    if (!live) return
    const next = normalizeAspectRatio(value)
    if (live.content.aspectRatio === next) return
    const before = snapshotDocState(this.docModel)
    if (!before) return
    live.content.aspectRatio = next
    this.docModel.touch()
    this.pushDocSnapshot('更改画幅', before)
    this.engine.invalidate()
  }

  setFollowMode = (v: boolean): void => {
    if (this.editor.workspaceMode === 'film') return
    if (v && this.editor.cameraPilotId) this.finishCameraPilot()
    this.editor.setFollowModeFlag(v)
    if (v) {
      this.editor.setPoseEditingId(null)
      this.editor.setLookAtPickingId(null)
      this.editor.setPathEditingIdFlag(null)
      this.engine.beginFollow()
    } else this.engine.endFollow()
    this.syncGizmoState()
  }

  setCameraPilot = (id: string | null): void => {
    if (this.editor.workspaceMode === 'film') return
    if (id === this.editor.cameraPilotId) return
    if (this.editor.cameraPilotId) this.finishCameraPilot()
    if (id) this.startCameraPilot(id)
  }

  private startCameraPilot(id: string): void {
    if (this.writeLocked) return
    const node = this.docModel.snapshot?.content.nodes.find((candidate) => candidate.id === id)
    if (!node || node.type !== 'camera' || node.locked || node.visible === false || !node.camera) return
    if (this.editor.followMode) {
      this.editor.setFollowModeFlag(false)
      this.engine.endFollow()
    }
    this.editor.setPoseEditingId(null)
    this.editor.setLookAtPickingId(null)
    this.editor.setPathEditingIdFlag(null)
    if (this.editor.pathDrawMode) this.setPathDrawMode(false)
    if (!this.engine.beginCameraPilot(id)) return
    this.editor.setActiveCamera(id)
    this.editor.setCameraPilotId(id)
    this.editor.select({ kind: 'node', nodeId: id, nodeIds: [id] })
    this.syncGizmoState()
  }

  private finishCameraPilot(): void {
    const id = this.editor.cameraPilotId
    if (!id) return
    const flown = this.engine.endCameraPilot()
    this.editor.setCameraPilotId(null)
    const node = this.docModel.snapshot?.content.nodes.find((candidate) => candidate.id === id && candidate.type === 'camera')
    if (flown && node?.camera) {
      const liveLook = node.camera.lookAt
      const dist = Math.hypot(liveLook.x - node.transform.position.x, liveLook.y - node.transform.position.y, liveLook.z - node.transform.position.z) || 2
      library.commitCameraPilotPose(this, id, flown.position, {
        x: flown.position.x + flown.forward.x * dist,
        y: flown.position.y + flown.forward.y * dist,
        z: flown.position.z + flown.forward.z * dist,
      })
    }
    if (node) this.editor.select({ kind: 'node', nodeId: id, nodeIds: [id] })
    this.syncGizmoState()
  }

  setPoseEditingId = (id: string | null): void => {
    if (id && this.writeLocked) return
    if (id && this.editor.cameraPilotId) this.finishCameraPilot()
    if (id) {
      const node = this.docModel.snapshot?.content.nodes.find((candidate) => candidate.id === id)
      if (!node || node.type !== 'character' || node.locked || node.visible === false) return
      this.editor.setLookAtPickingId(null)
      this.editor.setPathEditingIdFlag(null)
    }
    this.editor.setPoseEditingId(id)
    this.syncGizmoState()
    if (id) this.engine.focusNode(id)
  }

  setPathEditingId = (id: string | null): void => {
    if (id && this.writeLocked) return
    if (id) {
      const node = this.docModel.snapshot?.content.nodes.find((candidate) => candidate.id === id)
      if (!isPathEditTarget(node) || node.locked || node.visible === false) return
      this.editor.setLookAtPickingId(null)
      this.editor.setPoseEditingId(null)
      if (this.editor.pathDrawMode) this.setPathDrawMode(false)
      this.editor.select({ kind: 'node', nodeId: id, nodeIds: [id] })
      this.editor.setPathEditingIdFlag(id)
      this.editor.setPathEditPointIndex(0)
    } else {
      const pathId = this.editor.pathEditingId
      this.editor.setPathEditingIdFlag(null)
      const node = this.docModel.snapshot?.content.nodes.find((candidate) => candidate.id === pathId)
      if (isPathEditTarget(node)) {
        this.editor.select({ kind: 'node', nodeId: node.id, nodeIds: [node.id] })
      }
    }
    this.syncGizmoState()
  }

  setPathEditPointIndex = (index: number | null): void => {
    const pathId = this.editor.pathEditingId
    if (!pathId) return
    if (index != null) {
      const node = this.docModel.snapshot?.content.nodes.find((candidate) => candidate.id === pathId)
      const count = node?.path?.points.length ?? 0
      if (index < 0 || index >= count) return
    }
    this.editor.setPathEditPointIndex(index)
    this.syncGizmoState()
  }

  commitPathPoint = (
    pathId: string,
    index: number,
    world: { x: number; y: number; z: number },
  ): string | null => {
    if (this.writeLocked) return 'write-locked'
    const live = this.docModel.toContract()
    if (!live) return 'no-doc'
    const node = live.content.nodes.find((candidate) => candidate.id === pathId)
    if (!isPathEditTarget(node) || node.locked) return 'path-not-editable'
    const before = snapshotDocState(this.docModel)
    if (!before) return 'no-doc'
    if (!writePathPointWorld(node, index, world)) return 'path-point-missing'
    this.docModel.touch()
    this.engine.refreshPathNode?.(pathId)
    this.pushDocSnapshot('编辑轨迹锚点', before, `path-point:${pathId}`)
    return null
  }

  /**
   * 整条路径的 gizmo 提交：代理位姿是「控制点质心 + node.transform.position」，
   * 写回文档前要把质心减掉，全部控制点随 transform 协同变换。
   */
  commitPathTransform = (
    pathId: string,
    gizmo: {
      position?: { x: number; y: number; z: number }
      rotation?: { x: number; y: number; z: number }
      scale?: { x: number; y: number; z: number }
    },
  ): string | null => {
    if (this.writeLocked) return 'write-locked'
    const live = this.docModel.toContract()
    if (!live) return 'no-doc'
    const node = live.content.nodes.find((candidate) => candidate.id === pathId)
    if (!isPathEditTarget(node) || node.locked) return 'path-not-editable'
    const center = pathControlCentroid(node)
    return this.writeNodeTransform(pathId, {
      position: gizmo.position
        ? {
            x: gizmo.position.x - center.x,
            y: gizmo.position.y - center.y,
            z: gizmo.position.z - center.z,
          }
        : undefined,
      rotation: gizmo.rotation,
      scale: gizmo.scale,
    })
  }

  beginLookAtPick = (cameraId: string): void => {
    if (this.writeLocked) return
    const cam = this.docModel.snapshot?.content.nodes.find((n) => n.id === cameraId && n.type === 'camera')
    if (!cam) return
    this.editor.setPoseEditingId(null)
    this.editor.setPathEditingIdFlag(null)
    this.editor.setPathApplyPickingId(null)
    this.editor.setLookAtPickingId(cameraId)
    this.syncGizmoState()
  }

  beginPathApplyPick = (pathId: string): void => {
    if (this.writeLocked) return
    const node = this.docModel.snapshot?.content.nodes.find((n) => n.id === pathId)
    if (!isPathEditTarget(node) || node.locked) return
    if ((node.path?.points.length ?? 0) < 2) return
    this.editor.setPoseEditingId(null)
    this.editor.setPathEditingIdFlag(null)
    this.editor.setLookAtPickingId(null)
    this.editor.setPathApplyPickingId(pathId)
    this.syncGizmoState()
  }

  cancelPathApplyPick = (): void => {
    if (!this.editor.pathApplyPickingId) return
    this.editor.setPathApplyPickingId(null)
    this.syncGizmoState()
  }

  cancelLookAtPick = (): void => {
    if (!this.editor.lookAtPickingId) return
    this.editor.setLookAtPickingId(null)
    this.syncGizmoState()
  }

  resetEditorView = (): void => {
    if (this.editor.workspaceMode === 'film') return
    if (this.editor.cameraPilotId) return
    if (this.editor.followMode) {
      this.editor.setFollowModeFlag(false)
      this.engine.endFollow()
      this.syncGizmoState()
    }
    this.engine.resetEditorView()
  }

  focusSelection = (): void => {
    const sel = this.editor.selection
    if (sel?.kind !== 'node') return
    const ids = sel.nodeIds?.length ? sel.nodeIds : [sel.nodeId]
    this.engine.focusNodes(ids)
  }

  cloneSelection = (
    transforms?: Record<string, {
      position?: { x: number; y: number; z: number }
      rotation?: { x: number; y: number; z: number }
      scale?: { x: number; y: number; z: number }
    }>,
  ): void => {
    if (!transforms) {
      this.duplicateSelection({ kind: 'offset', delta: {} })
      return
    }
    const live = this.docModel.toContract()
    if (!live) return
    this.duplicateSelection({
      kind: 'gizmo',
      items: Object.entries(transforms).flatMap(([id, to]) => {
        const source = live.content.nodes.find((node) => node.id === id)
        if (!source) return []
        return [{
          id,
          from: source.transform,
          to: {
            position: to.position ?? source.transform.position,
            rotation: to.rotation ?? source.transform.rotation,
            scale: to.scale ?? source.transform.scale,
          },
        }]
      }),
    })
  }

  duplicateSelection = (input: DuplicateSelectionInput): void => {
    if (this.writeLocked) return
    const sel = this.editor.selection?.kind === 'node' ? this.editor.selection : null
    const live = this.docModel.toContract()
    if (!sel || !live) return
    const selectedIds = sel.nodeIds?.length ? sel.nodeIds : [sel.nodeId]
    const perNodeDeltas = input.kind === 'gizmo'
      ? Object.fromEntries(input.items.map((item) => [
        item.id,
        item.from
          ? transformDeltaFromTo(item.from, item.to)
          : transformDeltaFromTo(
            live.content.nodes.find((node) => node.id === item.id)?.transform ?? item.to,
            item.to,
          ),
      ]))
      : undefined
    const result = duplicateNodes({
      document: live,
      userKeys: this.docModel.userKeys,
      selectedIds,
      delta: input.kind === 'offset' ? input.delta : undefined,
      perNodeDeltas,
    })
    if (result.newNodeIds.length === 0) return
    const before = snapshotDocState(this.docModel)
    if (!before) return
    live.content.nodes = result.document.content.nodes
    live.content.timeline.animation = result.document.content.timeline.animation
    this.docModel.setUserKeys(result.userKeys)
    const fc = this.docModel.fcurves ?? FCurveSet.empty()
    const deltaByDest = new Map<string, TransformDelta>()
    for (const [fromId, toId] of result.idMap) {
      deltaByDest.set(toId, perNodeDeltas?.[fromId] ?? (input.kind === 'offset' ? input.delta : {}))
    }
    for (const plan of result.fcurveCopies) {
      const delta = deltaByDest.get(plan.toId) ?? {}
      fc.copyNode(plan.fromId, plan.toId, (key, curve) => applyFcurveDelta(key, curve, delta))
    }
    for (const id of result.rederiveIds) {
      rederiveWalkPaths(live, id, fc, result.userKeys)
    }
    this.docModel.setFcurves(fc)
    this.engine.setFcurves(fc)
    this.docModel.touch()
    this.pushDocSnapshot('复制对象', before)
    if (result.topLevelNewIds.length > 0) {
      const last = result.topLevelNewIds[result.topLevelNewIds.length - 1]
      this.editor.select({
        kind: 'node',
        nodeId: last,
        nodeIds: result.topLevelNewIds,
      })
    }
    this.syncGizmoState()
  }

  setGizmoMode = (m: GizmoMode): void => {
    if (this.editor.workspaceMode === 'film') return
    this.editor.setGizmoMode(m)
    this.syncGizmoState()
  }

  setPathDrawMode = (v: boolean): void => {
    if (v && this.writeLocked) return
    if (!v) this.engine.clearDrawPreview()
    if (v) {
      this.editor.setPoseEditingId(null)
      this.editor.setLookAtPickingId(null)
      this.editor.setPathEditingIdFlag(null)
    }
    this.editor.setPathDrawModeFlag(v)
    this.engine.setLeftPointerReserved(v)
    this.syncGizmoState()
  }

  setPathDrawStyle = (s: PathDrawStyle): void => {
    this.engine.clearDrawPreview()
    this.editor.setPathDrawStyleFlag(s)
  }

  addPathDrawPoint = (p: [number, number, number]): void => {
    if (this.writeLocked) return
    if (!this.editor.pathDrawMode) return
    const pts: [number, number, number][] = [...this.editor.pathDrawPoints, p]
    this.editor.setPathDrawPoints(pts)
    this.engine.updateDrawPreview(pts)
  }

  clearPathDrawPoints = (): void => {
    this.engine.clearDrawPreview()
    this.editor.setPathDrawPoints([])
  }

  finishPathDraw = (): void => {
    if (this.writeLocked) return
    const { pathDrawMode, pathDrawPoints, pathDrawStyle } = this.editor
    const live = this.docModel.toContract()
    if (!pathDrawMode || !live) return
    const pts = pathDrawPoints.filter(
      (p, i) =>
        i === 0 ||
        Math.hypot(
          p[0] - pathDrawPoints[i - 1][0],
          p[1] - pathDrawPoints[i - 1][1],
          p[2] - pathDrawPoints[i - 1][2],
        ) > 1e-4,
    )
    if (pts.length < 2) {
      this.setPathDrawMode(false)
      return
    }
    const stamp = Date.now()
    const id = `path_${stamp}`
    const pathCount = live.content.nodes.filter(
      (n) => n.type === 'path' && (n.path?.source === 'draw' || n.path?.source === 'click'),
    ).length
    const node: DraftNode = {
      id,
      type: 'path',
      name: `轨迹${pathCount + 1}`,
      visible: true,
      locked: false,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      path: {
        source: pathDrawStyle,
        parameterization: 'arc-length',
        curve: 'catmullRom',
        points: pts.map((p, i) => ({
          id: `path_point_${stamp.toString(36)}_${i}`,
          position: { x: +p[0].toFixed(3), y: +p[1].toFixed(3), z: +p[2].toFixed(3) },
        })),
        closed: false,
        groundSnap: true,
        smoothing: 0.5,
      },
    }
    const characterId = selectedCharacterId(live, this.editor.selection)
    this.commitAddedNode(node, '绘制轨迹')
    this.engine.addPathNode(node)
    this.setPathDrawMode(false)
    if (characterId) this.applyPathToTarget(id, characterId)
  }

  deleteSelection = (): void => {
    if (this.writeLocked) return
    if (this.editor.workspaceMode === 'film') {
      const clipId = this.editor.filmSelection?.clipId
      if (clipId) this.film.deleteFilmClip(clipId)
      return
    }
    const sel = this.editor.selection
    if (!sel) return
    if (sel.kind === 'keyframe') {
      this.removeKeyframes(keyframeRefsOf(sel))
      return
    }
    if (sel.kind === 'transformKeyframe') {
      this.removeTransformKeysAtFrame(sel.nodeId, sel.frame)
      return
    }
    if (sel.kind === 'clip' || sel.kind === 'timelineBox') {
      const before = snapshotDocState(this.docModel)
      if (!before) return
      const clips = [...clipRefsOf(sel)]
      const keys = [...keyframeRefsOf(sel)]
      if (clips.length === 1 && keys.length === 0) {
        this.deleteClip(clips[0].clipType, clips[0].clipId)
        return
      }
      this.history.beginInteraction()
      try {
        for (const ref of clips) this.deleteClip(ref.clipType, ref.clipId)
        if (keys.length) this.removeKeyframes(keys)
        this.editor.select(null)
      } finally {
        this.history.endInteraction()
      }
      this.pushDocSnapshot('删除选中片段与关键帧', before)
      return
    }
    this.deleteNodes(nodeIdsOf(sel))
  }

  deleteNode = (id: string): void => {
    if (this.writeLocked) return
    this.deleteNodes([id])
  }

  private deleteNodes(requestedIds: readonly string[]): void {
    if (this.writeLocked) return
    const live = this.docModel.toContract()
    if (!live) return
    const ids = collectDeletableNodeIds(
      live.content.nodes,
      live.content.timeline.animation.pathMotionClips,
      requestedIds,
    )
    if (ids.size === 0) return
    const before = snapshotDocState(this.docModel)
    if (!before) return
    const anim = live.content.timeline.animation
    anim.cameraMotionClips = anim.cameraMotionClips.filter((c) => !ids.has(c.target.nodeId))
    anim.motionClips = anim.motionClips.filter((c) => !ids.has(c.target.nodeId))
    anim.pathMotionClips = anim.pathMotionClips.filter(
      (c) => !ids.has(c.target.nodeId) && !ids.has(c.pathNodeId),
    )
    live.content.nodes = live.content.nodes.filter((n) => !ids.has(n.id))
    for (const n of live.content.nodes) {
      if (n.children) n.children = n.children.filter((cid) => !ids.has(cid))
    }
    if (ids.has(live.content.activeShotCameraNodeId)) {
      live.content.activeShotCameraNodeId =
        live.content.nodes.find((n) => n.type === 'camera')?.id ?? ''
    }
    for (const rid of ids) this.engine.removeNode(rid)
    const nextUserKeys = { ...this.docModel.userKeys }
    let ukChanged = false
    for (const rid of ids) {
      if (nextUserKeys[rid]) {
        delete nextUserKeys[rid]
        ukChanged = true
      }
    }
    const fc = this.docModel.fcurves
    if (fc) {
      for (const rid of ids) fc.removeNode(rid)
    }
    let nextActive = this.editor.activeCameraId
    if (nextActive && ids.has(nextActive)) {
      nextActive = live.content.nodes.find((n) => n.type === 'camera')?.id ?? ''
    }
    const nextFollow =
      this.editor.followMode && this.editor.activeCameraId && ids.has(this.editor.activeCameraId)
        ? false
        : this.editor.followMode
    if (this.editor.followMode && !nextFollow) this.engine.endFollow()
    if (this.editor.cameraPilotId && ids.has(this.editor.cameraPilotId)) {
      this.engine.endCameraPilot()
      this.editor.setCameraPilotId(null)
    }
    const sel = this.editor.selection
    const clipGone =
      sel?.kind === 'clip' &&
      !anim.cameraMotionClips.some((c) => c.id === sel.clipId) &&
      !anim.motionClips.some((c) => c.id === sel.clipId) &&
      !anim.pathMotionClips.some((c) => c.id === sel.clipId)
    this.docModel.touch()
    // userKeys / fcurves 的清理必须先于 pushDocSnapshot，after 快照才能带上删掉的轨道。
    if (ukChanged) this.docModel.setUserKeys(nextUserKeys)
    this.pushDocSnapshot('删除节点', before)
    this.editor.setActiveCamera(nextActive)
    this.editor.setFollowModeFlag(nextFollow)
    if (sel?.kind === 'node') {
      this.editor.select(buildNodeSelection(nodeIdsOf(sel).filter((id) => !ids.has(id))))
    } else if (
      (sel?.kind === 'keyframe' && ids.has(sel.nodeId)) ||
      (sel?.kind === 'transformKeyframe' && ids.has(sel.nodeId)) ||
      clipGone
    ) {
      this.editor.select(null)
    }
    this.syncGizmoState()
  }

  deleteClip = (clipType: 'camera' | 'motion' | 'path', clipId: string): void => {
    if (this.writeLocked) return
    const live = this.docModel.toContract()
    if (!live) return
    const before = snapshotDocState(this.docModel)
    if (!before) return
    const anim = live.content.timeline.animation
    const targetNodeId =
      clipType === 'camera'
        ? anim.cameraMotionClips.find((c) => c.id === clipId)?.target.nodeId
        : clipType === 'motion'
          ? anim.motionClips.find((c) => c.id === clipId)?.target.nodeId
          : anim.pathMotionClips.find((c) => c.id === clipId)?.target.nodeId
    if (clipType === 'camera') {
      const next = anim.cameraMotionClips.filter((c) => c.id !== clipId)
      if (next.length === anim.cameraMotionClips.length) return
      anim.cameraMotionClips = next
    } else if (clipType === 'motion') {
      const next = anim.motionClips.filter((c) => c.id !== clipId)
      if (next.length === anim.motionClips.length) return
      anim.motionClips = next
    } else {
      const clip = anim.pathMotionClips.find((c) => c.id === clipId)
      const next = anim.pathMotionClips.filter((c) => c.id !== clipId)
      if (next.length === anim.pathMotionClips.length) return
      anim.pathMotionClips = next
      if (
        clip?.lockedReason === 'derived-from-keyframes' &&
        !next.some((c) => c.pathNodeId === clip.pathNodeId)
      ) {
        live.content.nodes = live.content.nodes.filter((n) => n.id !== clip.pathNodeId)
        this.engine.removeNode(clip.pathNodeId)
      }
    }
    this.docModel.touch()
    this.pushDocSnapshot('删除片段', before)
    const sel = this.editor.selection
    if (sel?.kind === 'clip' && sel.clipId === clipId) {
      this.editor.select(targetNodeId ? { kind: 'node', nodeId: targetNodeId } : null)
    }
  }

  beginClipResize = (): void => {
    if (this.writeLocked) return
    this.clipResizeBefore = snapshotDocState(this.docModel)
    this.clipResizeRevision = this.docModel.revision
    this.editor.setClipResizePreview(null)
    this.editor.setClipMovePreview(null)
  }

  resizeClip = (
    clipType: 'camera' | 'motion' | 'path',
    clipId: string,
    edge: 'start' | 'end',
    frame: number,
  ): void => {
    if (this.writeLocked) return
    const base = this.clipResizeBefore
    if (!base || this.docModel.revision !== this.clipResizeRevision) return
    const tl = base.doc.content.timeline
    const anim = tl.animation

    // Camera motion: NLE ripple — moving an edge pushes the affected side as a rigid block.
    if (clipType === 'camera') {
      const old = anim.cameraMotionClips.find((c) => c.id === clipId)
      if (!old) return
      const track = anim.cameraMotionClips.filter((c) => c.target.nodeId === old.target.nodeId)
      const layout = rippleResizeClip(track, clipId, edge, frame, tl.frameStart, tl.frameEnd)
      if (!layout) return
      this.editor.setClipResizePreview({
        clipType,
        clipId,
        frameStart: layout.frameStart,
        frameEnd: layout.frameEnd,
        positions: layout.positions,
      })
      return
    }

    const target = Math.round(Math.min(Math.max(frame, tl.frameStart), tl.frameEnd))
    let old: { frameStart: number; frameEnd: number; target: { nodeId: string } } | undefined
    if (clipType === 'path') {
      old = anim.pathMotionClips.find((c) => c.id === clipId)
    } else {
      old = anim.motionClips.find((c) => c.id === clipId)
    }
    if (!old) return
    const nodeId = old.target.nodeId
    const ordered = (
      clipType === 'path'
        ? timelinePathClips(anim.pathMotionClips, nodeId)
        : anim.motionClips.filter((c) => c.target.nodeId === nodeId)
    ).sort((a, b) => a.frameStart - b.frameStart)
    const oldIndex = ordered.findIndex((c) => c.id === clipId)
    const previousEnd = oldIndex > 0 ? ordered[oldIndex - 1].frameEnd : tl.frameStart
    const nextStart = oldIndex >= 0 && oldIndex < ordered.length - 1 ? ordered[oldIndex + 1].frameStart : tl.frameEnd
    const frameStart = edge === 'start'
      ? Math.min(Math.max(target, previousEnd), old.frameEnd - 1)
      : old.frameStart
    const frameEnd = edge === 'end'
      ? Math.max(Math.min(target, nextStart), old.frameStart + 1)
      : old.frameEnd
    this.editor.setClipResizePreview({ clipType, clipId, frameStart, frameEnd })
  }

  cancelClipResize = (): void => {
    this.clipResizeBefore = null
    this.editor.setClipResizePreview(null)
  }

  endClipResize = (): void => {
    if (this.writeLocked) {
      this.cancelClipResize()
      return
    }
    const before = this.clipResizeBefore
    const preview = this.editor.clipResizePreview
    const live = this.docModel.toContract()
    if (!before || !preview || !live || this.docModel.revision !== this.clipResizeRevision) {
      this.cancelClipResize()
      return
    }
    const next = cloneJson(live)
    const animation = next.content.timeline.animation
    if (preview.clipType === 'camera') {
      animation.cameraMotionClips = animation.cameraMotionClips.map((c) => {
        const pos = preview.positions?.[c.id]
        if (pos) return { ...c, frameStart: pos.frameStart, frameEnd: pos.frameEnd }
        if (c.id === preview.clipId) {
          return { ...c, frameStart: preview.frameStart, frameEnd: preview.frameEnd }
        }
        return c
      })
    } else if (preview.clipType === 'path') {
      animation.pathMotionClips = animation.pathMotionClips.map((c) => {
        if (c.id !== preview.clipId) return c
        return withPathClipRange(c, preview.frameStart, preview.frameEnd)
      })
    } else {
      const source = before.doc.content.timeline.animation.motionClips.find((c) => c.id === preview.clipId)
      animation.motionClips = animation.motionClips.map((c) => {
        if (c.id !== preview.clipId) return c
        if (preview.frameStart === c.frameStart || !source) {
          return { ...c, frameStart: preview.frameStart, frameEnd: preview.frameEnd }
        }
        const shift = ((preview.frameStart - source.frameStart) / next.content.timeline.fps) * (c.playback.speed ?? 1)
        const time = Math.max(0, Math.min(source.motion.time + shift, source.sourceDuration))
        return { ...c, frameStart: preview.frameStart, frameEnd: preview.frameEnd, motion: { ...c.motion, time } }
      })
    }
    runInAction(() => {
      this.cancelClipResize()
      if (JSON.stringify(before.doc.content) === JSON.stringify(next.content)) return
      this.docModel.applyContent(next)
      this.pushDocSnapshot('调整片段', before)
    })
  }

  beginClipMove = (): void => {
    if (this.writeLocked) return
    this.clipMoveBefore = snapshotDocState(this.docModel)
    this.clipMoveSelection = [...clipRefsOf(this.editor.selection)]
    this.clipMoveRevision = this.docModel.revision
    this.editor.setClipMovePreview(null)
    this.editor.setClipResizePreview(null)
  }

  moveClip = (clipType: 'camera' | 'motion' | 'path', clipId: string, frame: number): void => {
    if (this.writeLocked) return
    const base = this.clipMoveBefore
    if (!base) return
    if (this.docModel.revision !== this.clipMoveRevision) {
      this.cancelClipMove()
      return
    }
    const animation = base.doc.content.timeline.animation
    const source = clipType === 'camera' ? animation.cameraMotionClips
      : clipType === 'motion' ? animation.motionClips : animation.pathMotionClips
    const clip = source.find((c) => c.id === clipId)
    if (!clip) return
    if (this.clipMoveSelection.length > 1) {
      if (!Number.isFinite(frame)) return
      const collections = { camera: animation.cameraMotionClips, motion: animation.motionClips, path: animation.pathMotionClips }
      const selected = this.clipMoveSelection.flatMap((ref) => {
        const item = collections[ref.clipType].find((c) => c.id === ref.clipId)
        return item ? [{ ref, item }] : []
      })
      let minDelta = -Infinity
      let maxDelta = Infinity
      for (const { ref, item } of selected) {
        minDelta = Math.max(minDelta, base.doc.content.timeline.frameStart - item.frameStart)
        for (const other of collections[ref.clipType]) {
          if (other.target.nodeId !== item.target.nodeId || selected.some((s) => s.ref.clipType === ref.clipType && s.item.id === other.id)) continue
          if (other.frameEnd <= item.frameStart) minDelta = Math.max(minDelta, other.frameEnd - item.frameStart)
          else if (other.frameStart >= item.frameEnd) maxDelta = Math.min(maxDelta, other.frameStart - item.frameEnd)
          else { minDelta = Math.max(minDelta, 0); maxDelta = Math.min(maxDelta, 0) }
        }
      }
      const delta = Math.max(minDelta, Math.min(maxDelta, Math.round(frame) - clip.frameStart))
      const positions = Object.fromEntries(selected.map(({ item }) => [item.id, { frameStart: item.frameStart + delta, frameEnd: item.frameEnd + delta }]))
      this.editor.setClipMovePreview({ clipType, clipId, clips: selected.map(({ ref }) => ref), positions,
        pointerFrame: clip.frameStart + delta,
        frameEnd: Math.max(base.doc.content.timeline.frameEnd, ...Object.values(positions).map((p) => p.frameEnd)),
      })
      return
    }
    const track = clipType === 'path'
      ? timelinePathClips(animation.pathMotionClips, clip.target.nodeId)
      : source.filter((c) => c.target.nodeId === clip.target.nodeId)
    const layout = previewClipMove(
      track,
      clipId, frame, base.doc.content.timeline.frameStart, 6 / this.editor.pxPerFrame,
    )
    if (layout) this.editor.setClipMovePreview({ ...layout, clipType, clipId })
  }

  cancelClipMove = (): void => {
    this.clipMoveBefore = null
    this.clipMoveSelection = []
    this.editor.setClipMovePreview(null)
  }

  endClipMove = (): void => {
    if (this.writeLocked) {
      this.cancelClipMove()
      return
    }
    const before = this.clipMoveBefore
    const preview = this.editor.clipMovePreview
    const live = this.docModel.toContract()
    if (!before || !preview || !live || this.docModel.revision !== this.clipMoveRevision) {
      this.cancelClipMove()
      return
    }
    const key = preview.clipType === 'camera' ? 'cameraMotionClips'
      : preview.clipType === 'motion' ? 'motionClips' : 'pathMotionClips'
    const next = cloneJson(live)
    const animation = next.content.timeline.animation
    const apply = <T extends { id: string; frameStart: number; frameEnd: number }>(clips: T[]): T[] =>
      clips.map((c) => preview.positions[c.id] ? { ...c, ...preview.positions[c.id] } : c)
    if (preview.clips) {
      animation.cameraMotionClips = apply(animation.cameraMotionClips)
      animation.motionClips = apply(animation.motionClips)
      animation.pathMotionClips = apply(animation.pathMotionClips)
    }
    else if (key === 'cameraMotionClips') animation.cameraMotionClips = apply(animation.cameraMotionClips)
    else if (key === 'motionClips') animation.motionClips = apply(animation.motionClips)
    else animation.pathMotionClips = apply(animation.pathMotionClips)
    runInAction(() => {
      this.cancelClipMove()
      if (JSON.stringify(before.doc.content) === JSON.stringify(next.content)) return
      this.docModel.applyContent(next)
      this.pushDocSnapshot('移动片段', before)
    })
  }

  deletePathNode = (id: string): void => {
    const n = this.docModel.snapshot?.content.nodes.find((x) => x.id === id)
    if (!n || n.type !== 'path') return
    this.deleteNode(id)
  }

  applyPathToTarget = (pathNodeId: string, targetId: string): string | null => {
    if (this.writeLocked) return 'write-locked'
    const live = this.docModel.toContract()
    if (!live) return 'no-doc'
    const pathNode = live.content.nodes.find((n) => n.id === pathNodeId && n.type === 'path')
    if (!pathNode?.path || pathNode.path.points.length < 2) return '路径不存在或点数不足'
    const target = live.content.nodes.find((n) => n.id === targetId && isPathApplyTarget(n))
    if (!target) return '目标必须是角色、机位、道具或基础形状节点'
    const tl = live.content.timeline
    const baseDurationFrames = pathClipDurationFrames(pathNode, tl.fps)
    const frameStart = Math.min(Math.max(Math.round(this.engine.currentFrame), tl.frameStart), tl.frameEnd - 1)
    const frameEnd = Math.min(frameStart + baseDurationFrames, tl.frameEnd)
    const span = frameEnd - frameStart
    if (span <= 0) return '当前帧已到时间线末尾，无法生成走位片段'
    const before = snapshotDocState(this.docModel)
    if (!before) return 'no-doc'
    const clip: PathMotionClip = {
      id: `path_motion_clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      target: { type: 'node', nodeId: target.id },
      pathNodeId,
      pathName: pathNode.name,
      frameStart,
      frameEnd,
      pathStartPercent: 0,
      // Timeline limits shorten the duration, not the spatial coverage.
      pathEndPercent: 100,
      direction: 'forward',
      facing: target.type === 'camera' ? 'none' : 'path-tangent',
      playback: {
        version: 1,
        speed: 1,
        loop: false,
        loopMode: 'ping-pong',
        baseDurationFrames: span,
      },
      pathLength: pathArcLength(pathNode),
      status: 'active',
      source: 'semantic',
      locked: false,
    }
    tl.animation.pathMotionClips = [...tl.animation.pathMotionClips, clip]
    this.docModel.touch()
    this.pushDocSnapshot('应用轨迹', before)
    this.editor.select({ kind: 'clip', clipType: 'path', clipId: clip.id })
    return null
  }

  commitCharacterDrag = (nodeId: string, frame: number, pos: [number, number, number]): void => {
    if (this.writeLocked) return
    const live = this.docModel.toContract()
    if (!live) return
    const node = live.content.nodes.find((n) => n.id === nodeId)
    if (!node || node.type !== 'character') return
    if (this.capturePendingTransform(nodeId, { position: pos })) {
      this.engine.applyLiveNodeTransform(nodeId, liveNodeTransformFromPatch({ position: pos }))
      return
    }
    const before = snapshotDocState(this.docModel)
    if (!before) return
    if (!this.applyDragEdit(live, nodeId, frame, { position: pos })) return
    this.docModel.touch()
    this.pushDocSnapshot('提交走位', before)
  }

  /**
   * 拖拽/位移提交的统一落盘：更新当前帧已有 userKey 或写静态 transform，
   * 官方 fcurves 层不动；position 键被更新时重建派生走位路径。
   */
  private applyDragEdit(
    live: DirectorDocument,
    nodeId: string,
    frame: number,
    patch: TransformEditPatch,
  ): boolean {
    if (nodeHasAnimatedTransform(this.docModel.userKeys, this.docModel.fcurves, nodeId)) {
      const staged = {
        position: patch.position
          ? { x: patch.position[0], y: patch.position[1], z: patch.position[2] }
          : undefined,
        rotation: patch.rotation
          ? { x: patch.rotation[0], y: patch.rotation[1], z: patch.rotation[2] }
          : undefined,
        scale: patch.scale
          ? { x: patch.scale[0], y: patch.scale[1], z: patch.scale[2] }
          : undefined,
      }
      this.engine.setStagedTransform(nodeId, staged)
      this.engine.applyLiveNodeTransform(nodeId, staged)
      return true
    }
    const result = applyTransformEdit(live, this.docModel.userKeys, nodeId, frame, patch)
    if (!result.changed) return false
    if (result.userKeys !== this.docModel.userKeys) this.docModel.setUserKeys(result.userKeys)
    if (result.posKeyUpdated) {
      rederiveWalkPaths(live, nodeId, this.docModel.fcurves ?? FCurveSet.empty(), result.userKeys)
      this.engine.syncPathNodes()
    }
    return true
  }

  commitNodeTransform = (
    nodeId: string,
    frame: number,
    t: { position?: number[]; rotation?: number[]; scale?: number[] },
  ): void => {
    this.commitNodeTransforms(frame, [{ nodeId, ...t }])
  }

  commitNodeTransforms = (
    frame: number,
    items: { nodeId: string; position?: number[]; rotation?: number[]; scale?: number[] }[],
  ): void => {
    if (this.writeLocked) return
    const live = this.docModel.toContract()
    if (!live || items.length === 0) return
    const before = snapshotDocState(this.docModel)
    if (!before) return
    let persisted = false

    if (this.editor.autoKeyframe) {
      const autoItems: { nodeId: string; patch: TransformEditPatch }[] = []
      for (const item of items) {
        const node = live.content.nodes.find((n) => n.id === item.nodeId)
        if (!node || node.locked) continue
        const patch: TransformEditPatch = {
          position: item.position,
          rotation: item.rotation,
          scale: item.scale,
        }
        autoItems.push({ nodeId: item.nodeId, patch })
        this.engine.applyLiveNodeTransform?.(item.nodeId, liveNodeTransformFromPatch(patch))
      }
      if (autoItems.length > 0) {
        this.recordAutoKeyframeBatch(autoItems)
        persisted = true
      }
    } else {
      for (const item of items) {
        const node = live.content.nodes.find((n) => n.id === item.nodeId)
        if (!node || node.locked) continue
        const patch: TransformEditPatch = {
          position: item.position,
          rotation: item.rotation,
          scale: item.scale,
        }
        if (node.type === 'camera') {
          const revision = this.docModel.revision
          if (item.position && item.position.length >= 3) {
            library.writeCameraWorldPos(this, item.nodeId, { x: item.position[0], y: item.position[1], z: item.position[2] }, false)
          }
          if (item.rotation && item.rotation.length >= 3) {
            library.writeCameraRotation(this, item.nodeId, { x: item.rotation[0], y: item.rotation[1], z: item.rotation[2] }, false)
          }
          if (this.docModel.revision !== revision) persisted = true
          continue
        }
        if (this.capturePendingTransform(item.nodeId, patch)) {
          this.engine.applyLiveNodeTransform(item.nodeId, liveNodeTransformFromPatch(patch))
          continue
        }
        if (this.applyDragEdit(live, item.nodeId, frame, patch)) persisted = true
      }
    }

    if (!persisted) return
    this.docModel.touch()
    this.pushDocSnapshot(items.length > 1 ? '提交多选变换' : '提交变换', before)
  }

  setWorkspaceMode = (mode: WorkspaceMode): void => {
    if (mode === 'film' && this.editor.cameraPilotId) this.finishCameraPilot()
    this.film.setWorkspaceMode(mode)
  }
  setFilmSelection = (selection: FilmSelection | null): void => this.film.setFilmSelection(selection)
  setFilmBrowseCamera = (cameraNodeId: string): void => {
    if (this.writeLocked && (this.editor.filmSelection || this.editor.filmAddDraft)) return
    this.film.setFilmBrowseCamera(cameraNodeId)
  }
  beginFilmAddDraft = (afterClipId?: string | null): void => {
    if (!this.writeLocked) this.film.beginFilmAddDraft(afterClipId)
  }
  updateFilmAddDraft = (patch: Partial<FilmAddDraft>): void => {
    if (!this.writeLocked) this.film.updateFilmAddDraft(patch)
  }
  commitFilmAddDraft = (): void => {
    if (!this.writeLocked) this.film.commitFilmAddDraft()
  }
  cancelFilmAddDraft = (): void => this.film.cancelFilmAddDraft()
  beginFilmDrag = (kind: FilmDragKind, clipId: string): void => {
    if (!this.writeLocked) this.film.beginFilmDrag(kind, clipId)
  }
  previewFilmDrag = (preview: FilmDragPreview): void => {
    if (!this.writeLocked) this.film.previewFilmDrag(preview)
  }
  commitFilmDrag = (): void => {
    if (!this.writeLocked) this.film.commitFilmDrag()
  }
  cancelFilmDrag = (): void => this.film.cancelFilmDrag()
  setFilmTimelineHeight = (h: number): void => this.editor.setFilmTimelineHeight(h)
  setFilmPxPerFrame = (v: number): void => this.editor.setFilmPxPerFrame(v)
  alignFilmTrackToSource = (width: number, sourceFrames: number, persist?: boolean): void => {
    this.editor.alignFilmTrackToSource(width, sourceFrames, persist)
  }
  setFilmExportOpen = (open: boolean): void => {
    if (this.editor.filmDragPreview) return
    this.editor.setFilmExportOpen(open)
  }
  createFilmSequence = (name?: string): void => {
    if (!this.writeLocked) this.film.createFilmSequence(name)
  }
  renameFilmSequence = (sequenceId: string, name: string | null): void => {
    if (!this.writeLocked) this.film.renameFilmSequence(sequenceId, name)
  }
  duplicateFilmSequence = (sequenceId: string): void => {
    if (!this.writeLocked) this.film.duplicateFilmSequence(sequenceId)
  }
  deleteFilmSequence = (sequenceId: string): void => {
    if (!this.writeLocked) this.film.deleteFilmSequence(sequenceId)
  }
  activateFilmSequence = (sequenceId: string): void => {
    if (!this.writeLocked) this.film.activateFilmSequence(sequenceId)
  }
  duplicateFilmClip = (clipId: string): void => {
    if (!this.writeLocked) this.film.duplicateFilmClip(clipId)
  }
  deleteFilmClip = (clipId: string): void => {
    if (!this.writeLocked) this.film.deleteFilmClip(clipId)
  }
  updateFilmClip = (
    clipId: string,
    patch: Partial<{ cameraNodeId: string; sourceFrameStart: number; sourceFrameEnd: number }>,
  ): void => {
    if (!this.writeLocked) this.film.updateFilmClip(clipId, patch)
  }
  seekFilmSequence = (frame: number): void => this.film.seekFilmSequence(frame)
  seekFilmSource = (frame: number): void => this.film.seekFilmSource(frame)
  playFilmSequence = (): void => this.film.playFilmSequence()
  playFilmSource = (): void => this.film.playFilmSource()
  pauseFilm = (): void => this.film.pauseFilm()
  fitFilmSequence = (): void => {
    this.editor.setFilmPxPerFrame(4)
  }

  syncGizmoState(): void {
    if (this.editor.workspaceMode === 'film') {
      this.engine.syncGizmo(null, this.editor.gizmoMode, true)
      this.engine.syncPathSelection(null, [])
      return
    }
    if (this.editor.poseEditingId) {
      const node = this.docModel.snapshot?.content.nodes.find((item) => item.id === this.editor.poseEditingId)
      if (!node || node.type !== 'character') this.editor.setPoseEditingId(null)
    }
    if (this.editor.pathEditingId) {
      const node = this.docModel.snapshot?.content.nodes.find((item) => item.id === this.editor.pathEditingId)
      if (!isPathEditTarget(node) || node.locked || node.visible === false) {
        this.editor.setPathEditingIdFlag(null)
      } else {
        const count = node.path?.points.length ?? 0
        const index = this.editor.pathEditPointIndex
        if (index == null || index < 0 || index >= count) {
          this.editor.setPathEditPointIndex(count > 0 ? 0 : null)
        }
      }
    }
    if (this.editor.lookAtPickingId) {
      const cam = this.docModel.snapshot?.content.nodes.find((item) => item.id === this.editor.lookAtPickingId)
      if (!cam || cam.type !== 'camera') this.editor.setLookAtPickingId(null)
    }
    if (this.editor.pathApplyPickingId) {
      const path = this.docModel.snapshot?.content.nodes.find((item) => item.id === this.editor.pathApplyPickingId)
      if (!path || path.type !== 'path') this.editor.setPathApplyPickingId(null)
    }
    const incoming = this.editor.selection
    if (incoming?.kind === 'node') {
      const picked = this.docModel.snapshot?.content.nodes.find((item) => item.id === incoming.nodeId)
      if (isDerivedTransformPath(picked)) {
        const owner = (this.docModel.snapshot?.content.timeline.animation.pathMotionClips ?? []).find(
          (clip) => clip.pathNodeId === incoming.nodeId,
        )?.target.nodeId
        this.editor.select(owner ? { kind: 'node', nodeId: owner } : null)
      }
    }
    const sel = this.editor.selection
    const selectedIds = sel?.kind === 'node' ? nodeIdsOf(sel) : []
    const editableIds = unlockedNodeIds(this.docModel.snapshot?.content.nodes ?? [], selectedIds)
      .filter((id) => this.docModel.snapshot?.content.nodes.find((node) => node.id === id)?.visible !== false)
    const nodeId = editableIds[editableIds.length - 1] ?? null
    const pathEditing = Boolean(this.editor.pathEditingId)
    const suspended = this.writeLocked
      || this.editor.followMode
      || this.editor.pathDrawMode
      || Boolean(this.editor.poseEditingId)
      || Boolean(this.editor.lookAtPickingId)
      || Boolean(this.editor.pathApplyPickingId)
      || Boolean(this.editor.cameraPilotId)
    this.engine.setPoseEditingId(this.editor.poseEditingId)
    this.engine.setPathEditing?.(this.editor.pathEditingId, this.editor.pathEditPointIndex)
    this.engine.syncGizmo(
      nodeId,
      this.editor.gizmoMode,
      suspended && !pathEditing,
      editableIds.length > 0 ? editableIds : undefined,
    )
    let highlight: string | null = nodeId
    let visiblePathIds: string[] = []
    const snap = this.docModel.snapshot
    const pathClips = snap?.content.timeline.animation.pathMotionClips ?? []
    // 运镜导轨：选中机位/运镜片段时用运镜采样线，并隐藏该机位关键帧派生折线
    let motionGuideCameraId: string | null = null
    if (nodeId && snap) {
      const selectedNode = snap.content.nodes.find((item) => item.id === nodeId)
      if (selectedNode?.type === 'camera' && cameraMotionOwnsKeyframes(snap, nodeId)) {
        motionGuideCameraId = nodeId
      }
    }
    if (!motionGuideCameraId && sel?.kind === 'clip' && sel.clipType === 'camera' && snap) {
      const camClip = snap.content.timeline.animation.cameraMotionClips.find((c) => c.id === sel.clipId)
      const camId = camClip?.target.nodeId ?? null
      if (camId && cameraMotionOwnsKeyframes(snap, camId)) motionGuideCameraId = camId
    }
    if (nodeId) {
      const hideDerived = Boolean(motionGuideCameraId && motionGuideCameraId === nodeId)
      visiblePathIds = pathClips
        .filter((clip) => clip.target.type === 'node' && clip.target.nodeId === nodeId)
        .filter((clip) => !hideDerived || clip.lockedReason !== 'derived-from-keyframes')
        .map((clip) => clip.pathNodeId)
    }
    if (!highlight && sel?.kind === 'clip' && sel.clipType === 'path') {
      const clip = pathClips.find((c) => c.id === sel.clipId)
      highlight = clip?.pathNodeId ?? null
      if (clip?.target.type === 'node') {
        const ownerId = clip.target.nodeId
        const hideDerived = cameraMotionOwnsKeyframes(snap, ownerId)
        visiblePathIds = pathClips
          .filter((candidate) => candidate.target.type === 'node' && candidate.target.nodeId === ownerId)
          .filter((candidate) => !hideDerived || candidate.lockedReason !== 'derived-from-keyframes')
          .map((candidate) => candidate.pathNodeId)
      }
    }
    this.engine.syncPathSelection(highlight, visiblePathIds)
    this.engine.syncCameraMotionGuide(motionGuideCameraId, this.editor.chainCameraMotion === true)
  }

}

function selectedCharacterId(doc: DirectorDocument, selection: Selection | null): string | null {
  if (!selection) return null
  let nodeId: string | null = null
  if (selection.kind === 'timelineBox' && selection.keys[0]) {
    nodeId = selection.keys[0].nodeId
  } else if (selection.kind === 'clip' || (selection.kind === 'timelineBox' && selection.clips[0])) {
    const ref = selection.kind === 'clip'
      ? { clipType: selection.clipType, clipId: selection.clipId }
      : selection.clips[0]
    const animation = doc.content.timeline.animation
    const clips =
      ref.clipType === 'camera'
        ? animation.cameraMotionClips
        : ref.clipType === 'motion'
          ? animation.motionClips
          : animation.pathMotionClips
    nodeId = clips.find((clip) => clip.id === ref.clipId)?.target.nodeId ?? null
  } else if (
    selection.kind === 'node'
    || selection.kind === 'keyframe'
    || selection.kind === 'transformKeyframe'
  ) {
    nodeId = selection.nodeId
  }
  if (!nodeId) return null
  const node = doc.content.nodes.find((item) => item.id === nodeId)
  if (!node) return null
  return node.type === 'character' || node.type === 'prop' || node.type === 'primitive'
    ? nodeId
    : null
}

function collectDeletableNodeIds(
  nodes: readonly DraftNode[],
  pathMotionClips: readonly PathMotionClip[],
  requestedIds: readonly string[],
): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ids = new Set<string>()
  for (const id of requestedIds) {
    const node = byId.get(id)
    if (!node || node.locked) continue
    ids.add(id)
    if (node.type === 'group') {
      for (const child of nodes) {
        if (child.parentId === id || (node.children ?? []).includes(child.id)) ids.add(child.id)
      }
    }
    if (node.type === 'character' || node.type === 'camera') {
      for (const clip of pathMotionClips) {
        if (clip.target.nodeId === id && clip.lockedReason === 'derived-from-keyframes') {
          ids.add(clip.pathNodeId)
        }
      }
    }
  }
  return ids
}

function occupiedTimelineBounds(doc: DirectorDocument, userKeys: UserKeys): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  const anim = doc.content.timeline.animation
  for (const clip of [...anim.motionClips, ...anim.cameraMotionClips, ...anim.pathMotionClips]) {
    min = Math.min(min, clip.frameStart)
    max = Math.max(max, clip.frameEnd)
  }
  for (const tracks of Object.values(userKeys)) {
    if (!tracks) continue
    for (const keyframes of Object.values(tracks)) {
      for (const kf of keyframes ?? []) {
        min = Math.min(min, kf.frame)
        max = Math.max(max, kf.frame)
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return { min, max }
}

function applyFcurveDelta(key: FCurveKey, curve: FCurve, delta: TransformDelta): FCurveKey {
  const next = {
    ...key,
    inHandle: key.inHandle ? { ...key.inHandle } : null,
    outHandle: key.outHandle ? { ...key.outHandle } : null,
  }
  if (curve.propPath === 'transform.position' || curve.propPath === 'camera.lookAt') {
    const add = delta.position?.[curve.index] ?? 0
    next.value += add
    if (next.inHandle) next.inHandle.y += add
    if (next.outHandle) next.outHandle.y += add
    return next
  }
  if (curve.propPath === 'transform.rotation') {
    const add = delta.rotation?.[curve.index] ?? 0
    next.value += add
    if (next.inHandle) next.inHandle.y += add
    if (next.outHandle) next.outHandle.y += add
    return next
  }
  if (curve.propPath === 'transform.scale') {
    const mul = delta.scale?.[curve.index]
    const factor = mul === undefined || mul === 0 ? 1 : mul
    next.value *= factor
    if (next.inHandle) next.inHandle.y *= factor
    if (next.outHandle) next.outHandle.y *= factor
  }
  return next
}
